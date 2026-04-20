import type { KnotworkTransport, ThinkingRuntime } from '../transport/contracts'
import { SemanticDebugTrace } from './debug-trace'
import { dispatchEnvelope } from './dispatcher'
import { parseActionEnvelope, parseTaskPhaseOutput } from './parser'
import {
  buildActionPhaseSystemPrompt,
  buildActionPhaseUserPrompt,
  buildTaskPhaseSystemPrompt,
  buildTaskPhaseUserPrompt,
} from './prompt-builder'
import type {
  ActionEnvelope,
  DispatchResult,
  SemanticPreparedInput,
  SemanticTask,
  TaskPhaseResult,
} from './types'
import type { MCPContractManifest, WorkPacket } from '../types'
import { triggerChannelId, triggerMessageId } from '../types'

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

  private formatterSessionName(_task: SemanticTask): string {
    return 'knotwork:formatter'
  }

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

  private failEnvelope(input: {
    task: SemanticTask
    capabilities: { workspaceId: string }
    packet: WorkPacket & { mcp_contract: MCPContractManifest }
    reason: string
  }): ActionEnvelope {
    const { task, capabilities, packet, reason } = input
    return {
      protocol_version: 'knotwork.action/v1',
      kind: 'action_batch',
      idempotency_key: `fail:${task.taskId}`,
      source: {
        agent_id: packet.agent.participant_id ?? 'unknown',
        session_key: packet.continuation_key.id ?? task.sessionName ?? task.taskId,
        task_id: task.taskId,
      },
      context: {
        workspace_id: capabilities.workspaceId,
        trigger: task.trigger,
      },
      intent: { summary: reason },
      actions: [{
        action_id: 'action-1',
        type: 'control.fail',
        target: {},
        payload: { reason },
      }],
      completion: {
        task_status: 'failed',
        archive_trigger_delivery: true,
      },
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
          fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? triggerChannelId(task.trigger) ?? null,
          fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
            ?? preparedWorkPacket.message_response_policy?.trigger_message_id
            ?? triggerMessageId(task.trigger)
            ?? null,
        })
        await debugTrace.writeSection('Dispatch', dispatch)
        return { envelope, dispatch }
      }
      let taskPhaseResult: TaskPhaseResult | null = null
      for (let iteration = 1; iteration <= 6; iteration += 1) {
        const prepared: SemanticPreparedInput = { task, capabilities, workPacket: preparedWorkPacket }
        const systemPrompt = buildTaskPhaseSystemPrompt(prepared)
        const userPrompt = buildTaskPhaseUserPrompt(prepared)
        const thought = await this.thinkingRuntime.think({
          taskId: task.taskId,
          channelId: task.channelId,
          sessionName: task.sessionName,
          systemPrompt,
          userPrompt,
        })
        await debugTrace.writeDelivery({
          iteration: `Task Phase ${iteration}`,
          message: userPrompt,
          extraSystemPrompt: thought.deliveredSystemPrompt,
        })
        await debugTrace.writeSection(`Task Phase System Prompt ${iteration}`, thought.deliveredSystemPrompt ?? '', 'md')
        await debugTrace.writeSection(`Task Phase User Prompt ${iteration}`, userPrompt, 'md')
        await debugTrace.writeReply({
          iteration: `Task Phase ${iteration}`,
          reply: thought.rawOutput,
        })
        await debugTrace.writeSection(`Task Phase Output ${iteration}`, thought.rawOutput, 'text')
        const phaseOutput = parseTaskPhaseOutput(thought.rawOutput, preparedWorkPacket)
        await debugTrace.writeSection(`Task Phase Parsed ${iteration}`, phaseOutput)
        if (phaseOutput.type === 'read_request') {
          const result = await this.transport.executeMcpAction({
            contractId: workPacket.mcp_contract.id,
            contractChecksum: preparedWorkPacket.mcp_contract.checksum,
            action: {
              action_id: 'action-1',
              type: phaseOutput.action,
              target: phaseOutput.target,
              payload: phaseOutput.payload,
            },
            fallbackRunId: preparedWorkPacket.refs.run_id ?? task.runId ?? null,
            fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? triggerChannelId(task.trigger) ?? null,
            fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
              ?? preparedWorkPacket.message_response_policy?.trigger_message_id
              ?? triggerMessageId(task.trigger)
              ?? null,
          })
          await debugTrace.writeSection(`Task Phase Read Result ${iteration}`, result)
          if (result.status !== 'applied') {
            throw new Error(result.reason || `failed to load context via ${phaseOutput.action}`)
          }
          if (result.context_section) {
            preparedWorkPacket = this.mergeContext(preparedWorkPacket, result.context_section, result.output)
          }
          await debugTrace.writeSection(`Prepared Packet After Task Read ${iteration}`, preparedWorkPacket)
          continue
        }
        if (phaseOutput.type === 'fail') {
          const envelope = this.failEnvelope({
            task,
            capabilities,
            packet: preparedWorkPacket,
            reason: phaseOutput.error,
          })
          const dispatch = await dispatchEnvelope(this.transport, envelope, capabilities, {
            contractId: preparedWorkPacket.mcp_contract.id,
            contractChecksum: preparedWorkPacket.mcp_contract.checksum,
            fallbackRunId: preparedWorkPacket.refs.run_id ?? task.runId ?? null,
            fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? triggerChannelId(task.trigger) ?? null,
            fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
              ?? preparedWorkPacket.message_response_policy?.trigger_message_id
              ?? triggerMessageId(task.trigger)
              ?? null,
          })
          await debugTrace.writeSection('Dispatch', dispatch)
          return { envelope, dispatch }
        }
        taskPhaseResult = phaseOutput
        break
      }
      if (!taskPhaseResult) {
        throw new Error('semantic session exceeded context-read limit')
      }

      let lastFormatError: string | null = null
      for (let iteration = 1; iteration <= 3; iteration += 1) {
        const prepared: SemanticPreparedInput = { task, capabilities, workPacket: preparedWorkPacket }
        const systemPrompt = buildActionPhaseSystemPrompt(prepared)
        const userPrompt = buildActionPhaseUserPrompt(prepared, taskPhaseResult, lastFormatError)
        const thought = await this.thinkingRuntime.think({
          taskId: `${task.taskId}:action:${iteration}`,
          channelId: task.channelId,
          sessionName: this.formatterSessionName(task),
          systemPrompt,
          userPrompt,
        })
        await debugTrace.writeDelivery({
          iteration: `Action Phase ${iteration}`,
          message: userPrompt,
          extraSystemPrompt: thought.deliveredSystemPrompt,
        })
        await debugTrace.writeSection(`Action Phase System Prompt ${iteration}`, thought.deliveredSystemPrompt ?? '', 'md')
        await debugTrace.writeSection(`Action Phase User Prompt ${iteration}`, userPrompt, 'md')
        await debugTrace.writeReply({
          iteration: `Action Phase ${iteration}`,
          reply: thought.rawOutput,
        })
        await debugTrace.writeSection(`Action Phase Output ${iteration}`, thought.rawOutput, 'text')
        try {
          const envelope = parseActionEnvelope(thought.rawOutput, preparedWorkPacket)
          await debugTrace.writeSection(`Action Phase Envelope ${iteration}`, envelope)
          const kinds = this.actionKinds(preparedWorkPacket)
          const readActions = envelope.actions.filter((action) => kinds.get(action.type) === 'read')
          if (readActions.length > 0) {
            if (readActions.length !== envelope.actions.length) {
              throw new Error('read and write actions cannot be mixed in the same action phase batch')
            }
            for (const action of readActions) {
              const result = await this.transport.executeMcpAction({
                contractId: preparedWorkPacket.mcp_contract.id,
                contractChecksum: preparedWorkPacket.mcp_contract.checksum,
                action,
                fallbackRunId: preparedWorkPacket.refs.run_id ?? task.runId ?? null,
                fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? triggerChannelId(task.trigger) ?? null,
                fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
                  ?? preparedWorkPacket.message_response_policy?.trigger_message_id
                  ?? triggerMessageId(task.trigger)
                  ?? null,
              })
              await debugTrace.writeSection(`Action Phase Read Result ${iteration}:${action.action_id}`, result)
              if (result.status !== 'applied') {
                throw new Error(result.reason || `failed to load context via ${action.type}`)
              }
              if (result.context_section) {
                preparedWorkPacket = this.mergeContext(preparedWorkPacket, result.context_section, result.output)
              }
            }
            await debugTrace.writeSection(`Prepared Packet After Action Read ${iteration}`, preparedWorkPacket)
            continue
          }
          const dispatch = await dispatchEnvelope(this.transport, envelope, capabilities, {
            contractId: preparedWorkPacket.mcp_contract.id,
            contractChecksum: preparedWorkPacket.mcp_contract.checksum,
            fallbackRunId: preparedWorkPacket.refs.run_id ?? task.runId ?? null,
            fallbackSourceChannelId: preparedWorkPacket.refs.channel_id ?? task.channelId ?? triggerChannelId(task.trigger) ?? null,
            fallbackTriggerMessageId: preparedWorkPacket.trigger_message?.id
              ?? preparedWorkPacket.message_response_policy?.trigger_message_id
              ?? triggerMessageId(task.trigger)
              ?? null,
          })
          await debugTrace.writeSection('Dispatch', dispatch)
          return { envelope, dispatch }
        } catch (error) {
          lastFormatError = error instanceof Error ? error.message : String(error)
          await debugTrace.writeSection(`Action Phase Error ${iteration}`, lastFormatError, 'text')
        }
      }
      throw new Error(`semantic action formatting failed after retries: ${lastFormatError || 'unknown error'}`)
    } catch (error) {
      await debugTrace.writeError(error)
      throw error
    }
  }
}
