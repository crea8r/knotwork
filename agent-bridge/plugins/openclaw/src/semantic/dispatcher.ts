import type { KnotworkTransport, SemanticCapabilitySnapshot } from '../transport/contracts'
import { applyGraphDelta } from './graph-delta'
import type { ActionEnvelope, ActionItem, ActionResult, DispatchResult } from './types'

function isActionAllowed(action: ActionItem, capabilities: SemanticCapabilitySnapshot): string | null {
  if (!capabilities.actions[action.type]) return `action ${action.type} is not permitted`
  if (action.type === 'channel.post_message') {
    if (!capabilities.channels.postAllowed.includes(action.target.channel_id)) {
      return `channel ${action.target.channel_id} is not allowed for posting`
    }
  }
  return null
}

function summarize(results: ActionResult[]): DispatchResult['batch_status'] {
  if (results.length === 0) return 'rejected'
  if (results.every((item) => item.status === 'applied' || item.status === 'skipped')) return 'applied'
  if (results.every((item) => item.status === 'rejected')) return 'rejected'
  if (results.some((item) => item.status === 'failed')) return 'failed'
  return 'partially_applied'
}

function assertNever(value: never): never {
  throw new Error(`unsupported action type: ${String((value as { type?: unknown }).type ?? 'unknown')}`)
}

async function dispatchOne(
  transport: KnotworkTransport,
  action: ActionItem,
  defaultAuthorName: string,
  currentGraphDefinition: Record<string, unknown> | null,
  fallbackRunId?: string | null,
  fallbackSourceChannelId?: string | null,
): Promise<{ result: ActionResult; nextGraphDefinition?: Record<string, unknown> | null }> {
  if (action.type === 'channel.post_message') {
    const posted = await transport.postChannelMessage({
      channelId: action.target.channel_id,
      content: action.payload.content,
      authorName: action.payload.author_name ?? defaultAuthorName,
      runId: action.payload.run_id ?? fallbackRunId ?? null,
    })
    return {
      result: {
        action_id: action.action_id,
        status: 'applied',
        effect_ref: { kind: 'channel_message', id: posted.messageId },
      },
    }
  }
  if (action.type === 'escalation.resolve') {
    const resolved = await transport.resolveEscalation({
      escalationId: action.target.escalation_id,
      resolution: action.payload.resolution,
      actorName: defaultAuthorName,
      guidance: action.payload.guidance,
      overrideOutput: action.payload.override_output ?? null,
      nextBranch: action.payload.next_branch ?? null,
      answers: action.payload.answers ?? null,
      channelId: action.payload.channel_id ?? null,
    })
    return {
      result: {
        action_id: action.action_id,
        status: 'applied',
        reason: `resolved escalation ${resolved.escalationId}`,
      },
    }
  }
  if (action.type === 'knowledge.propose_change') {
    const proposal = await transport.proposeKnowledgeChange({
      path: action.target.path,
      proposedContent: action.payload.proposed_content,
      reason: action.payload.reason,
      runId: action.payload.run_id,
      nodeId: action.payload.node_id,
      agentRef: action.payload.agent_ref ?? null,
      sourceChannelId: action.payload.source_channel_id ?? fallbackSourceChannelId ?? null,
      actionType: action.payload.action_type,
      targetType: action.payload.target_type,
      payload: action.payload.payload ?? {},
    })
    return {
      result: {
        action_id: action.action_id,
        status: 'applied',
        reason: `created knowledge change ${proposal.proposalId}`,
      },
    }
  }
  if (action.type === 'graph.update_root_draft') {
    const draft = await transport.updateGraphRootDraft({
      graphId: action.target.graph_id,
      definition: action.payload.definition,
      note: action.payload.note ?? null,
    })
    return {
      result: {
        action_id: action.action_id,
        status: 'applied',
        reason: `updated graph root draft ${draft.graphId}`,
      },
      nextGraphDefinition: action.payload.definition,
    }
  }
  if (action.type === 'graph.apply_delta') {
    const nextDefinition = applyGraphDelta(currentGraphDefinition, action.payload.delta)
    const draft = await transport.updateGraphRootDraft({
      graphId: action.target.graph_id,
      definition: nextDefinition,
      note: action.payload.note ?? null,
    })
    return {
      result: {
        action_id: action.action_id,
        status: 'applied',
        reason: `applied graph delta to ${draft.graphId}`,
      },
      nextGraphDefinition: nextDefinition,
    }
  }
  if (action.type === 'control.noop') {
    return { result: { action_id: action.action_id, status: 'applied', reason: action.payload.reason } }
  }
  if (action.type === 'control.fail') {
    return { result: { action_id: action.action_id, status: 'failed', reason: action.payload.reason } }
  }
  return assertNever(action)
}

export async function dispatchEnvelope(
  transport: KnotworkTransport,
  envelope: ActionEnvelope,
  capabilities: SemanticCapabilitySnapshot,
  options: {
    defaultAuthorName: string
    currentGraphDefinition?: Record<string, unknown> | null
    fallbackRunId?: string | null
    fallbackSourceChannelId?: string | null
  },
): Promise<DispatchResult> {
  const results: ActionResult[] = []
  let currentGraphDefinition = options.currentGraphDefinition ?? null
  for (const action of envelope.actions) {
    const notAllowed = isActionAllowed(action, capabilities)
    if (notAllowed) {
      results.push({ action_id: action.action_id, status: 'rejected', reason: notAllowed })
      continue
    }
    try {
      const dispatched = await dispatchOne(
        transport,
        action,
        options.defaultAuthorName,
        currentGraphDefinition,
        options.fallbackRunId,
        options.fallbackSourceChannelId,
      )
      results.push(dispatched.result)
      if (dispatched.nextGraphDefinition !== undefined) {
        currentGraphDefinition = dispatched.nextGraphDefinition
      }
    } catch (error) {
      results.push({
        action_id: action.action_id,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const batchStatus = summarize(results)
  return {
    batch_status: batchStatus,
    action_results: results,
    next_task_status: batchStatus === 'failed' || envelope.completion.task_status === 'failed' ? 'failed' : 'completed',
  }
}
