import { useMemo } from 'react'
import type { Run, RunNodeState, Escalation, ChannelMessage } from '@/types'
import {
  type ChatItem,
  friendlyProgressText,
  humanizeInput,
  resolutionMessage,
} from '@/pages/runDetail/runDetailTypes'

interface Params {
  run: Run | undefined
  runMessages: ChannelMessage[]
  nodeStates: RunNodeState[]
  nodeNameMap: Record<string, string>
  nodeSpeakerMap: { nameMap: Map<string, string>; agentIdMap: Map<string, string> }
  runEscalations: Escalation[]
  awaitingAgentAfterReply: boolean
  lockedEscalationId: string | null
  openEscalation: Escalation | null
  thinkingText: string
  thinkingPhrases: string[]
  latestProgress: { id: string; text: string } | null
}

export function useRunChatItems(params: Params): ChatItem[] {
  const {
    run, runMessages, nodeStates, nodeNameMap, nodeSpeakerMap,
    runEscalations, awaitingAgentAfterReply, lockedEscalationId,
    openEscalation, thinkingText, thinkingPhrases, latestProgress,
  } = params

  return useMemo(() => {
    const items: ChatItem[] = []
    if (!run) return items

    const escalationsByNodeState = new Map<string, Escalation[]>()
    for (const esc of runEscalations) {
      const key = esc.run_node_state_id
      const arr = escalationsByNodeState.get(key) ?? []
      arr.push(esc)
      escalationsByNodeState.set(key, arr)
    }
    const nodeStateById = new Map(nodeStates.map((ns) => [ns.id, ns]))

    const noBlockingEscalation = !openEscalation || openEscalation.id === lockedEscalationId
    const isEffectivelyActive = run.status === 'running' || (run.status === 'paused' && noBlockingEscalation)

    function buildLoadingItem(): ChatItem {
      const afterReply = awaitingAgentAfterReply || lockedEscalationId !== null
      const liveText = run!.status === 'running' && latestProgress
        ? friendlyProgressText(latestProgress.id, latestProgress.text, thinkingPhrases)
        : afterReply
          ? `Your response was sent. ${thinkingText}`
          : thinkingText
      return {
        id: `run-live-${run!.id}`,
        role: 'system',
        kind: 'loading',
        speaker: 'Knotwork',
        text: liveText,
        raw: { status: run!.status },
        ts: null,
      }
    }

    // Channel messages path (preferred when available)
    if (runMessages.length > 0) {
      for (const m of runMessages) {
        const role = m.role === 'assistant' || m.role === 'user' ? m.role : 'system' as const
        const meta = m.metadata_ as Record<string, unknown>
        const kind = typeof meta.kind === 'string' ? meta.kind : ''
        if (kind === 'agent_progress' || kind === 'escalation_question') continue
        items.push({
          id: m.id, role, kind: 'message',
          speaker: m.author_name || (m.author_type === 'human' ? 'You' : m.author_type === 'agent' ? 'Agent' : 'Knotwork'),
          nodeId: m.node_id ?? undefined,
          nodeName: m.node_id ? (nodeNameMap[m.node_id] ?? m.node_id) : undefined,
          text: m.content, markdown: role === 'assistant', raw: m.metadata_ ?? {}, ts: m.created_at,
        })
      }
      for (const ns of nodeStates) {
        if (ns.status !== 'completed') continue
        if ((escalationsByNodeState.get(ns.id) ?? []).length > 0) continue
        const speaker = nodeSpeakerMap.nameMap.get(ns.node_id) ?? (ns.agent_ref || 'Agent')
        const nodeName = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
        items.push({
          id: `decision-confident-${ns.id}`, role: 'system', kind: 'decision_confident',
          speaker: 'Knotwork', nodeId: ns.node_id, nodeName,
          text: `${speaker} is confident with the answer and will move on to the next step.`,
          raw: { node_state_id: ns.id, decision: 'confident' }, ts: ns.completed_at,
        })
      }
      for (const esc of runEscalations) {
        const nodeName = nodeNameMap[esc.node_id] ?? esc.node_id
        const relatedNs = esc.run_node_state_id ? nodeStateById.get(esc.run_node_state_id) : undefined
        const nsOutput = relatedNs?.output as Record<string, unknown> | null | undefined
        const preText = typeof nsOutput?.text === 'string' && nsOutput.text.trim() ? nsOutput.text.trim() : undefined
        items.push({
          id: `decision-escalate-${esc.id}`, role: 'system', kind: 'decision_escalate',
          speaker: 'Knotwork', nodeId: esc.node_id, nodeName,
          text: 'Escalation requires human decision.', preText, raw: esc.context, escalation: esc, ts: esc.created_at,
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

    // Fallback: build from node states + escalations
    items.push({
      id: `run-input-${run.id}`, role: 'user', speaker: 'You',
      text: `Started run with:\n${humanizeInput(run.input)}`, raw: run.input, ts: run.created_at,
    })
    for (const ns of nodeStates) {
      const nodeName = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
      const speaker = nodeSpeakerMap.nameMap.get(ns.node_id) ?? (ns.agent_ref || 'Agent')
      const speakerAgentId = nodeSpeakerMap.agentIdMap.get(ns.node_id)
      const relatedEscalations = (escalationsByNodeState.get(ns.id) ?? [])
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      for (const relatedEsc of relatedEscalations) {
        const ctx = relatedEsc.context as Record<string, unknown>
        const q = typeof ctx.question === 'string' ? ctx.question : (typeof ctx.prompt === 'string' ? ctx.prompt : null)
        if (q) {
          const opts = Array.isArray(ctx.options) ? ctx.options.map(String) : []
          const readable = opts.length ? `${q}\n\nOptions:\n${opts.map((x) => `- ${x}`).join('\n')}` : q
          items.push({ id: `esc-q-${relatedEsc.id}`, role: 'assistant', speaker, speakerAgentId, nodeId: ns.node_id, nodeName, text: readable, raw: relatedEsc.context, ts: relatedEsc.created_at })
        }
        const response = resolutionMessage(relatedEsc)
        if (response) items.push({ id: `esc-a-${relatedEsc.id}`, role: 'user', speaker: 'You', nodeId: ns.node_id, nodeName, text: response, raw: relatedEsc.resolution_data, ts: relatedEsc.resolved_at })
      }
      const out = ns.output as Record<string, unknown> | null
      if (ns.status !== 'paused' && out && typeof out.text === 'string' && out.text.trim()) {
        items.push({ id: `node-out-${ns.id}`, role: 'assistant', speaker, speakerAgentId, nodeId: ns.node_id, nodeName, text: out.text, markdown: true, raw: ns.output, ts: ns.completed_at })
      }
      if (ns.status === 'failed' && ns.error) {
        items.push({ id: `node-err-${ns.id}`, role: 'system', speaker: 'Knotwork', nodeId: ns.node_id, nodeName, text: `Node failed: ${ns.error}`, raw: { error: ns.error }, ts: ns.completed_at })
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
  }, [run, runMessages, nodeStates, nodeNameMap, nodeSpeakerMap, runEscalations, awaitingAgentAfterReply, lockedEscalationId, openEscalation, thinkingText, thinkingPhrases, latestProgress])
}
