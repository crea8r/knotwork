import type { MCPContractManifest, TaskTrigger, WorkPacket } from '../types'
import type { SemanticCapabilitySnapshot } from '../transport/contracts'

export type ActionProtocolVersion = 'knotwork.action/v1'

export type ActionItem = {
  action_id: string
  type: string
  target: Record<string, unknown>
  payload: Record<string, unknown>
}

export type ActionEnvelope = {
  protocol_version: ActionProtocolVersion
  kind: 'action_batch'
  idempotency_key: string
  source: {
    agent_id: string
    session_key: string
    task_id: string
  }
  context: {
    workspace_id: string | null
    trigger: TaskTrigger
  }
  intent?: {
    summary?: string
    confidence?: number
  }
  actions: ActionItem[]
  completion: {
    task_status: 'completed' | 'failed'
    archive_trigger_delivery?: boolean
  }
}

export type ActionResult = {
  action_id: string
  status: 'applied' | 'rejected' | 'failed' | 'skipped'
  reason?: string
  effect_ref?: {
    kind: string
    id: string
  }
}

export type DispatchResult = {
  batch_status: 'applied' | 'partially_applied' | 'rejected' | 'failed'
  action_results: ActionResult[]
  next_task_status: 'completed' | 'failed'
}

export type SemanticTask = {
  taskId: string
  channelId?: string
  sessionName?: string
  runId?: string | null
  trigger: TaskTrigger
}

export type SemanticPreparedInput = {
  task: SemanticTask
  capabilities: SemanticCapabilitySnapshot
  workPacket: WorkPacket & { mcp_contract: MCPContractManifest }
}

export type TaskPhaseReadRequest = {
  type: 'read_request'
  reasoning?: string
  action: string
  target: Record<string, unknown>
  payload: Record<string, unknown>
}

export type TaskPhaseResult = {
  type: 'result'
  reasoning?: string
  result: string
  confidence?: number
}

export type TaskPhaseFailure = {
  type: 'fail'
  reasoning?: string
  error: string
}

export type TaskPhaseOutput = TaskPhaseReadRequest | TaskPhaseResult | TaskPhaseFailure
