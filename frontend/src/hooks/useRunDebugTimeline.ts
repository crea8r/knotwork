import { useMemo } from 'react'
import type { RunNodeState, RunWorklogEntry } from '@/types'
import { isHeartbeatProgress } from '@/pages/runDetail/runDetailTypes'

export type DebugTimelineRow = {
  id: string
  ts: number
  iso: string | null
  kind: 'in' | 'out' | 'progress'
  nodeName: string
  label: string
  content: string
  heartbeatCount?: number
}

export function useRunDebugTimeline(
  nodeStates: RunNodeState[],
  nodeNameMap: Record<string, string>,
  worklog: RunWorklogEntry[],
): DebugTimelineRow[] {
  return useMemo(() => {
    const rows: DebugTimelineRow[] = []

    for (const ns of nodeStates) {
      const inp = (ns.input ?? {}) as Record<string, unknown>
      const out = (ns.output ?? {}) as Record<string, unknown>
      const nodeName = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
      const startedIso = ns.started_at ?? null
      const completedIso = ns.completed_at ?? ns.started_at ?? null
      const startedTs = startedIso ? new Date(startedIso).getTime() : 0
      const completedTs = completedIso ? new Date(completedIso).getTime() : startedTs
      const systemPrompt = typeof inp.system_prompt === 'string' ? inp.system_prompt.trim() : ''
      const userPrompt = typeof inp.user_prompt === 'string' ? inp.user_prompt.trim() : ''
      const humanGuidance = typeof inp.human_guidance === 'string' ? inp.human_guidance.trim() : ''
      const outputText = typeof out.text === 'string' ? out.text.trim() : ''

      if (systemPrompt) rows.push({ id: `${ns.id}-in-system`, ts: startedTs, iso: startedIso, kind: 'in', nodeName, label: 'System prompt', content: systemPrompt })
      if (userPrompt) rows.push({ id: `${ns.id}-in-user`, ts: startedTs, iso: startedIso, kind: 'in', nodeName, label: 'Message', content: userPrompt })
      if (humanGuidance) rows.push({ id: `${ns.id}-in-guidance`, ts: startedTs, iso: startedIso, kind: 'in', nodeName, label: 'Human guidance', content: humanGuidance })
      if (outputText) {
        rows.push({ id: `${ns.id}-out-output`, ts: completedTs, iso: completedIso, kind: 'out', nodeName, label: 'Output', content: outputText })
      } else if (ns.status === 'failed' && ns.error) {
        rows.push({ id: `${ns.id}-out-error`, ts: completedTs, iso: completedIso, kind: 'out', nodeName, label: 'Error', content: ns.error })
      }
    }

    for (const entry of worklog) {
      if (entry.entry_type !== 'progress' && entry.entry_type !== 'action') continue
      const ts = new Date(entry.created_at).getTime()
      rows.push({
        id: `worklog-${entry.id}`,
        ts,
        iso: entry.created_at,
        kind: 'progress',
        nodeName: nodeNameMap[entry.node_id] ?? entry.node_id,
        label: entry.entry_type,
        content: entry.content,
      })
    }

    rows.sort((a, b) => (a.ts - b.ts) || a.id.localeCompare(b.id))

    const merged: DebugTimelineRow[] = []
    for (const row of rows) {
      const last = merged[merged.length - 1]
      const heartbeat = row.kind === 'progress' && isHeartbeatProgress(row.content)
      if (heartbeat && last && last.kind === 'progress' && isHeartbeatProgress(last.content)) {
        last.heartbeatCount = (last.heartbeatCount ?? 1) + 1
        last.content = row.content
        last.iso = row.iso
        last.ts = row.ts
        continue
      }
      merged.push({ ...row, heartbeatCount: heartbeat ? 1 : undefined })
    }
    return merged
  }, [nodeStates, nodeNameMap, worklog])
}
