import type { TaskTrigger } from '../types'
import type { SemanticCapabilitySnapshot, SemanticThinkingContext } from '../transport/contracts'

export type ActionProtocolVersion = 'knotwork.action/v1'

export type ActionBase<TType extends string, TTarget, TPayload> = {
  action_id: string
  type: TType
  target: TTarget
  payload: TPayload
}

export type ChannelPostMessageAction = ActionBase<
  'channel.post_message',
  { channel_id: string },
  {
    content: string
    author_name?: string
    run_id?: string | null
  }
>

export type ControlNoopAction = ActionBase<
  'control.noop',
  Record<string, never>,
  { reason: string }
>

export type ControlFailAction = ActionBase<
  'control.fail',
  Record<string, never>,
  { reason: string }
>

export type EscalationResolveAction = ActionBase<
  'escalation.resolve',
  { escalation_id: string },
  {
    resolution: 'accept_output' | 'override_output' | 'request_revision' | 'abort_run'
    guidance?: string
    override_output?: Record<string, unknown> | null
    next_branch?: string | null
    answers?: string[] | null
    channel_id?: string | null
  }
>

export type KnowledgeProposeChangeAction = ActionBase<
  'knowledge.propose_change',
  { path: string },
  {
    proposed_content: string
    reason: string
    run_id?: string
    node_id?: string
    agent_ref?: string | null
    source_channel_id?: string | null
    action_type?: string
    target_type?: string
    payload?: Record<string, unknown>
  }
>

export type ActionItem =
  | ChannelPostMessageAction
  | EscalationResolveAction
  | KnowledgeProposeChangeAction
  | ControlNoopAction
  | ControlFailAction

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
    kind: 'channel_message'
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
  systemPrompt?: string
  legacyUserPrompt?: string
  runId?: string | null
  trigger: TaskTrigger
}

export type SemanticPreparedInput = {
  task: SemanticTask
  capabilities: SemanticCapabilitySnapshot
  context: SemanticThinkingContext
}
