import type { KnotworkTransport, SemanticCapabilitySnapshot } from '../transport/contracts'
import type { ActionEnvelope, ActionResult, DispatchResult } from './types'

function isActionAllowed(actionType: string, capabilities: SemanticCapabilitySnapshot): string | null {
  if (!capabilities.actions[actionType]) return `action ${actionType} is not permitted`
  return null
}

function summarize(results: ActionResult[]): DispatchResult['batch_status'] {
  if (results.length === 0) return 'rejected'
  if (results.every((item) => item.status === 'applied' || item.status === 'skipped')) return 'applied'
  if (results.every((item) => item.status === 'rejected')) return 'rejected'
  if (results.some((item) => item.status === 'failed')) return 'failed'
  return 'partially_applied'
}

export async function dispatchEnvelope(
  transport: KnotworkTransport,
  envelope: ActionEnvelope,
  capabilities: SemanticCapabilitySnapshot,
  options: {
    contractId: string
    contractChecksum: string
    fallbackRunId?: string | null
    fallbackSourceChannelId?: string | null
    fallbackTriggerMessageId?: string | null
  },
): Promise<DispatchResult> {
  const results: ActionResult[] = []
  for (const action of envelope.actions) {
    const notAllowed = isActionAllowed(action.type, capabilities)
    if (notAllowed) {
      results.push({ action_id: action.action_id, status: 'rejected', reason: notAllowed })
      continue
    }
    try {
      const result = await transport.executeMcpAction({
        contractId: options.contractId,
        contractChecksum: options.contractChecksum,
        action,
        fallbackRunId: options.fallbackRunId ?? null,
        fallbackSourceChannelId: options.fallbackSourceChannelId ?? null,
        fallbackTriggerMessageId: options.fallbackTriggerMessageId ?? null,
      })
      results.push({
        action_id: result.action_id,
        status: result.status as ActionResult['status'],
        reason: result.reason,
        effect_ref: result.effect_ref ?? undefined,
      })
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
