import { useMemo } from 'react'
import type { Run, RunNodeState, ChannelMessage } from '@data-models'
import {
  type ChatItem,
  type RequestPayload,
  type RequestTargetRole,
  friendlyProgressText,
} from '@modules/workflows/frontend/pages/runDetail/runDetailTypes'

interface Params {
  run: Run | undefined
  runMessages: ChannelMessage[]
  nodeStates: RunNodeState[]
  nodeNameMap: Record<string, string>
  nodeSpeakerMap: { nameMap: Map<string, string>; agentIdMap: Map<string, string> }
  awaitingAgentAfterReply: boolean
  lockedRequestMessageId: string | null
  openRequestMessageId: string | null
  thinkingText: string
  thinkingPhrases: string[]
  latestProgress: { id: string; text: string } | null
}

function normalizeRequestPayload(raw: unknown): RequestPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const responseSchema = src.response_schema && typeof src.response_schema === 'object'
    ? src.response_schema as Record<string, unknown>
    : undefined
  return {
    type: typeof src.type === 'string' ? src.type : undefined,
    status: typeof src.status === 'string' ? src.status : undefined,
    questions: Array.isArray(src.questions) ? src.questions.map(String) : undefined,
    context_markdown: typeof src.context_markdown === 'string' ? src.context_markdown : undefined,
    assigned_to: Array.isArray(src.assigned_to) ? src.assigned_to.map(String) : undefined,
    options: Array.isArray(src.options) ? src.options.map(String) : undefined,
    escalation_id: typeof src.escalation_id === 'string' ? src.escalation_id : undefined,
    timeout_at: typeof src.timeout_at === 'string' ? src.timeout_at : undefined,
    response_schema: responseSchema ? {
      resolution_options: Array.isArray(responseSchema.resolution_options) ? responseSchema.resolution_options.map(String) : undefined,
      supports_guidance: typeof responseSchema.supports_guidance === 'boolean' ? responseSchema.supports_guidance : undefined,
      supports_answers: typeof responseSchema.supports_answers === 'boolean' ? responseSchema.supports_answers : undefined,
      supports_override_output: typeof responseSchema.supports_override_output === 'boolean' ? responseSchema.supports_override_output : undefined,
      supports_next_branch: typeof responseSchema.supports_next_branch === 'boolean' ? responseSchema.supports_next_branch : undefined,
    } : undefined,
  }
}

export function useRunChatItems(params: Params): ChatItem[] {
  const {
    run, runMessages, nodeStates, nodeNameMap, nodeSpeakerMap,
    awaitingAgentAfterReply, lockedRequestMessageId, openRequestMessageId,
    thinkingText, thinkingPhrases, latestProgress,
  } = params

  return useMemo(() => {
    const items: ChatItem[] = []
    if (!run) return items
    const activeRun = run
    const completedNodeIds = new Set(
      nodeStates
        .filter((nodeState) => nodeState.status === 'completed')
        .map((nodeState) => nodeState.node_id),
    )
    const requestCreatedAtByEscalationId = new Map<string, number>()
    const resolvedEscalationIds = new Set<string>()
    for (const message of runMessages) {
      const meta = message.metadata_ as Record<string, unknown>
      if (meta.kind === 'request') {
        const request = normalizeRequestPayload(meta.request)
        const escalationId = request?.escalation_id
        if (escalationId) requestCreatedAtByEscalationId.set(escalationId, new Date(message.created_at).getTime())
      }
      if (meta.kind !== 'escalation_resolution') continue
      const escalationId = typeof meta.escalation_id === 'string' ? meta.escalation_id : null
      if (escalationId) resolvedEscalationIds.add(escalationId)
    }

    const noBlockingRequest = !openRequestMessageId || openRequestMessageId === lockedRequestMessageId
    const isEffectivelyActive = activeRun.status === 'running' || (activeRun.status === 'paused' && noBlockingRequest)

    function buildLoadingItem(): ChatItem {
      const afterReply = awaitingAgentAfterReply || lockedRequestMessageId !== null
      const liveText = activeRun.status === 'running' && latestProgress
        ? friendlyProgressText(latestProgress.id, latestProgress.text, thinkingPhrases)
        : afterReply
          ? `Your response was sent. ${thinkingText}`
          : thinkingText
      return {
        id: `run-live-${activeRun.id}`,
        role: 'system',
        kind: 'loading',
        speaker: 'Knotwork',
        text: liveText,
        raw: { status: activeRun.status },
        ts: null,
      }
    }

    if (runMessages.length > 0) {
      const requestNodeIds = new Set<string>()
      for (const m of runMessages) {
        const role = m.role === 'assistant' || m.role === 'user' ? m.role : 'system' as const
        const meta = m.metadata_ as Record<string, unknown>
        const kind = typeof meta.kind === 'string' ? meta.kind : ''
        if (kind === 'agent_progress' || kind === 'escalation_question') continue
        if (kind === 'request') {
          const flow = meta.flow && typeof meta.flow === 'object'
            ? meta.flow as Record<string, unknown>
            : undefined
          const request = normalizeRequestPayload(meta.request)
          const escalationId = request?.escalation_id
          const derivedStatus = escalationId && resolvedEscalationIds.has(escalationId)
            ? 'answered'
            : request?.status
          if (derivedStatus === 'open' && m.node_id && completedNodeIds.has(m.node_id)) continue
          const targetRole: RequestTargetRole =
            flow?.to_role === 'supervisor'
              ? 'supervisor'
              : flow?.to_role === 'participant'
                ? 'participant'
                : 'operator'
          const normalizedRequest = request
            ? {
                ...request,
                status: derivedStatus,
                target_role: targetRole,
              }
            : request
          if (m.node_id) requestNodeIds.add(m.node_id)
          items.push({
            id: m.id,
            role,
            kind: 'request',
            speaker: m.author_name || 'Workflow Orchestrator',
            nodeId: m.node_id ?? undefined,
            nodeName: m.node_id ? (nodeNameMap[m.node_id] ?? m.node_id) : undefined,
            text: normalizedRequest?.questions?.[0] || m.content,
            preText: normalizedRequest?.context_markdown,
            markdown: true,
            raw: m.metadata_ ?? {},
            ts: m.created_at,
            requestMessageId: m.id,
            request: normalizedRequest,
          })
          continue
        }
        const escalationId = typeof meta.escalation_id === 'string' ? meta.escalation_id : null
        const answerDurationMs = escalationId && requestCreatedAtByEscalationId.has(escalationId)
          ? Math.max(0, new Date(m.created_at).getTime() - (requestCreatedAtByEscalationId.get(escalationId) ?? 0))
          : null
        items.push({
          id: m.id,
          role,
          kind: 'message',
          speaker: m.author_name || (m.author_type === 'human' ? 'You' : m.author_type === 'agent' ? 'Agent' : 'Knotwork'),
          nodeId: m.node_id ?? undefined,
          nodeName: m.node_id ? (nodeNameMap[m.node_id] ?? m.node_id) : undefined,
          text: m.content,
          markdown: role === 'assistant',
          raw: m.metadata_ ?? {},
          ts: m.created_at,
          answerDurationMs,
        })
      }
      for (const ns of nodeStates) {
        if (ns.status !== 'completed' || requestNodeIds.has(ns.node_id)) continue
        const speaker = nodeSpeakerMap.nameMap.get(ns.node_id) ?? (ns.agent_ref || 'Agent')
        const nodeName = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
        items.push({
          id: `decision-confident-${ns.id}`,
          role: 'system',
          kind: 'decision_confident',
          speaker: 'Knotwork',
          nodeId: ns.node_id,
          nodeName,
          text: `${speaker} is confident with the answer and will move on to the next step.`,
          raw: { node_state_id: ns.id, decision: 'confident' },
          ts: ns.completed_at,
        })
      }
      items.sort((a, b) => {
        const ta = a.ts ? new Date(a.ts).getTime() : Number.MAX_SAFE_INTEGER
        const tb = b.ts ? new Date(b.ts).getTime() : Number.MAX_SAFE_INTEGER
        if (ta !== tb) return ta - tb
        return a.id.localeCompare(b.id)
      })
      if (isEffectivelyActive) items.push(buildLoadingItem())
      return items
    }

    for (const ns of nodeStates) {
      const nodeName = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
      const speaker = nodeSpeakerMap.nameMap.get(ns.node_id) ?? (ns.agent_ref || 'Agent')
      const speakerAgentId = nodeSpeakerMap.agentIdMap.get(ns.node_id)
      const out = ns.output as Record<string, unknown> | null
      if (ns.status !== 'paused' && out && typeof out.text === 'string' && out.text.trim()) {
        items.push({
          id: `node-out-${ns.id}`,
          role: 'assistant',
          speaker,
          speakerAgentId,
          nodeId: ns.node_id,
          nodeName,
          text: out.text,
          markdown: true,
          raw: ns.output,
          ts: ns.completed_at,
        })
      }
      if (ns.status === 'failed' && ns.error) {
        items.push({
          id: `node-err-${ns.id}`,
          role: 'system',
          speaker: 'Knotwork',
          nodeId: ns.node_id,
          nodeName,
          text: `Node failed: ${ns.error}`,
          raw: { error: ns.error },
          ts: ns.completed_at,
        })
      }
    }
    items.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : Number.MAX_SAFE_INTEGER
      const tb = b.ts ? new Date(b.ts).getTime() : Number.MAX_SAFE_INTEGER
      if (ta !== tb) return ta - tb
      return a.id.localeCompare(b.id)
    })
    if (isEffectivelyActive) items.push(buildLoadingItem())
    return items
  }, [run, runMessages, nodeStates, nodeNameMap, nodeSpeakerMap, awaitingAgentAfterReply, lockedRequestMessageId, openRequestMessageId, thinkingText, thinkingPhrases, latestProgress])
}
