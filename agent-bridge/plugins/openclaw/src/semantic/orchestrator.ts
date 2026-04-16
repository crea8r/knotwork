import type { KnotworkTransport, ThinkingRuntime } from '../transport/contracts'
import { SemanticDebugTrace } from './debug-trace'
import { dispatchEnvelope } from './dispatcher'
import { parseActionEnvelope } from './parser'
import { buildSemanticSystemPrompt, buildSemanticUserPrompt } from './prompt-builder'
import type { ActionEnvelope, DispatchResult, SemanticPreparedInput, SemanticTask } from './types'
import type { MCPContractManifest, WorkPacket } from '../types'

export type SemanticOrchestratorResult = {
  envelope: ActionEnvelope
  dispatch: DispatchResult
}

export type SemanticOrchestratorOptions = {
  defaultAuthorName: string
  debugEnabled?: boolean
  debugDir?: string
}

export class SemanticOrchestrator {
  constructor(
    private readonly thinkingRuntime: ThinkingRuntime,
    private readonly transport: KnotworkTransport,
  ) {}

  private actionKinds(packet: WorkPacket & { mcp_contract: MCPContractManifest }): Map<string, 'read' | 'write' | 'control'> {
    return new Map(
      packet.mcp_contract.actions.map((action) => [action.name, action.kind]),
    )
  }

  private mergeContext(packet: WorkPacket & { mcp_contract: MCPContractManifest }, section: string, output: unknown): WorkPacket & { mcp_contract: MCPContractManifest } {
    return {
      ...packet,
      [section]: output as never,
    }
  }

  async run(task: SemanticTask, options: SemanticOrchestratorOptions): Promise<SemanticOrchestratorResult> {
    const debugTrace = new SemanticDebugTrace({
      enabled: Boolean(options.debugEnabled),
      rootDir: options.debugDir,
      taskId: task.taskId,
      sessionName: task.sessionName,
    })
    try {
      await debugTrace.writeSection('Task', task)
      const workPacket = await this.transport.getWorkPacket({
        taskId: task.taskId,
        trigger: task.trigger,
        sessionName: task.sessionName,
      })
      await debugTrace.writeSection('Work Packet', workPacket)
      const contract = await this.transport.getMcpContract(workPacket.mcp_contract.id, workPacket.mcp_contract.checksum)
      if (contract.checksum !== workPacket.mcp_contract.checksum) {
        throw new Error(`contract checksum mismatch for ${workPacket.mcp_contract.id}`)
      }
      await debugTrace.writeMarkdownSection('MCP Contract Markdown', contract.markdown)
      let preparedWorkPacket: WorkPacket & { mcp_contract: MCPContractManifest } = {
        ...workPacket,
        mcp_contract: contract,
      }
      const capabilities = await this.transport.getCapabilitySnapshot({
        trigger: task.trigger,
        allowedActions: contract.allowed_actions,
      })
      await debugTrace.writeSection('Capabilities', capabilities)
      if (preparedWorkPacket.message_response_policy?.decision === 'must_noop') {
        const envelope: ActionEnvelope = {
          protocol_version: 'knotwork.action/v1',
          kind: 'action_batch',
          idempotency_key: `noop:${task.taskId}`,
          source: {
            agent_id: preparedWorkPacket.agent.participant_id ?? 'unknown',
            session_key: preparedWorkPacket.continuation_key.id ?? task.sessionName ?? task.taskId,
            task_id: task.taskId,
          },
          context: {
            workspace_id: capabilities.workspaceId,
            trigger: task.trigger,
          },
          intent: {
            summary: preparedWorkPacket.message_response_policy.reason,
            confidence: 1,
          },
          actions: [{
            action_id: 'action-1',
            type: 'control.noop',
            target: {},
            payload: { reason: preparedWorkPacket.message_response_policy.reason },
          }],
          completion: {
            task_status: 'completed',
            archive_trigger_delivery: true,
          },
        }
        await debugTrace.writeSection('Envelope', envelope)
        const dispatch = await dispatchEnvelope(this.transport, envelope, capabilities, {
          contractId: workPacket.mcp_contract.id,
          contractChecksum: preparedWorkPacket.mcp_contract.checksum,
          fallbackRunId: preparedWorkPacket.refs.run_id ?? task.runId ?? null,
          fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? task.trigger.channel_id ?? null,
          fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
            ?? preparedWorkPacket.message_response_policy?.trigger_message_id
            ?? task.trigger.message_id
            ?? null,
        })
        await debugTrace.writeSection('Dispatch', dispatch)
        return { envelope, dispatch }
      }
      for (let iteration = 1; iteration <= 6; iteration += 1) {
        const prepared: SemanticPreparedInput = { task, capabilities, workPacket: preparedWorkPacket }
        const systemPrompt = buildSemanticSystemPrompt(prepared)
        const userPrompt = buildSemanticUserPrompt(prepared)
        await debugTrace.writeSection(`System Prompt ${iteration}`, systemPrompt, 'md')
        await debugTrace.writeSection(`User Prompt ${iteration}`, userPrompt, 'md')
        const thought = await this.thinkingRuntime.think({
          taskId: task.taskId,
          channelId: task.channelId,
          sessionName: task.sessionName,
          systemPrompt,
          userPrompt,
        })
        await debugTrace.writeSection(`Model Output ${iteration}`, thought.rawOutput, 'text')
        const envelope = parseActionEnvelope(thought.rawOutput, preparedWorkPacket)
        await debugTrace.writeSection(`Envelope ${iteration}`, envelope)
        const kinds = this.actionKinds(preparedWorkPacket)
        const readActions = envelope.actions.filter((action) => kinds.get(action.type) === 'read')
        if (readActions.length > 0) {
          if (readActions.length !== envelope.actions.length) {
            throw new Error('read and write actions cannot be mixed in the same batch')
          }
          for (const action of readActions) {
            const result = await this.transport.executeMcpAction({
              contractId: workPacket.mcp_contract.id,
              contractChecksum: preparedWorkPacket.mcp_contract.checksum,
              action,
              fallbackRunId: preparedWorkPacket.refs.run_id ?? task.runId ?? null,
              fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? task.trigger.channel_id ?? null,
              fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
                ?? preparedWorkPacket.message_response_policy?.trigger_message_id
                ?? task.trigger.message_id
                ?? null,
            })
            await debugTrace.writeSection(`Read Result ${iteration}:${action.action_id}`, result)
            if (result.status !== 'applied') {
              throw new Error(result.reason || `failed to load context via ${action.type}`)
            }
            if (result.context_section) {
              preparedWorkPacket = this.mergeContext(preparedWorkPacket, result.context_section, result.output)
            }
          }
          await debugTrace.writeSection(`Prepared Packet ${iteration} After Read`, preparedWorkPacket)
          continue
        }
        const dispatch = await dispatchEnvelope(this.transport, envelope, capabilities, {
          contractId: preparedWorkPacket.mcp_contract.id,
          contractChecksum: preparedWorkPacket.mcp_contract.checksum,
          fallbackRunId: preparedWorkPacket.refs.run_id ?? task.runId ?? null,
          fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? task.trigger.channel_id ?? null,
          fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
            ?? preparedWorkPacket.message_response_policy?.trigger_message_id
            ?? task.trigger.message_id
            ?? null,
        })
        await debugTrace.writeSection('Dispatch', dispatch)
        return { envelope, dispatch }
      }
      throw new Error('semantic session exceeded context-read limit')
    } catch (error) {
      await debugTrace.writeError(error)
      throw error
    }
  }
}
