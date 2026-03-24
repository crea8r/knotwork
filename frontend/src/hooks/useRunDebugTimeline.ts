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
  visitIndex?: number
  maxVisits?: number
  branchTarget?: string
  branchLabel?: string
  loopBack?: boolean
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
      const visitIndex = typeof inp.visit_index === 'number' ? inp.visit_index : undefined
      const maxVisits = typeof inp.max_visits === 'number' ? inp.max_visits : undefined

      if (systemPrompt) rows.push({ id: `${ns.id}-in-system`, ts: startedTs, iso: startedIso, kind: 'in', nodeName, label: 'System prompt', content: systemPrompt, visitIndex, maxVisits })
      if (userPrompt) rows.push({ id: `${ns.id}-in-user`, ts: startedTs, iso: startedIso, kind: 'in', nodeName, label: 'Message', content: userPrompt, visitIndex, maxVisits })
      if (humanGuidance) rows.push({ id: `${ns.id}-in-guidance`, ts: startedTs, iso: startedIso, kind: 'in', nodeName, label: 'Human guidance', content: humanGuidance, visitIndex, maxVisits })
      if (outputText) {
        rows.push({
          id: `${ns.id}-out-output`,
          ts: completedTs,
          iso: completedIso,
          kind: 'out',
          nodeName,
          label: 'Output',
          content: outputText,
          visitIndex,
          maxVisits,
        })
      } else if (ns.status === 'failed' && ns.error) {
        rows.push({
          id: `${ns.id}-out-error`,
          ts: completedTs,
          iso: completedIso,
          kind: 'out',
          nodeName,
          label: 'Error',
          content: ns.error,
          visitIndex,
          maxVisits,
        })
      }
    }

    for (const entry of worklog) {
      if (entry.entry_type !== 'progress' && entry.entry_type !== 'action') continue
      const ts = new Date(entry.created_at).getTime()
      const meta = entry.metadata_ ?? {}
      const visitIndex = typeof meta.visit_index === 'number' ? meta.visit_index : undefined
      const maxVisits = typeof meta.max_visits === 'number' ? meta.max_visits : undefined
      const branchTarget = typeof meta.next_branch === 'string' ? meta.next_branch : undefined
      const branchLabel = typeof meta.branch_label === 'string' ? meta.branch_label : undefined
      const loopBack = meta.loop_back === true
      rows.push({
        id: `worklog-${entry.id}`,
        ts,
        iso: entry.created_at,
        kind: 'progress',
        nodeName: nodeNameMap[entry.node_id] ?? entry.node_id,
        label: entry.entry_type === 'action' ? 'Action' : entry.entry_type,
        content: entry.content,
        visitIndex,
        maxVisits,
        branchTarget,
        branchLabel,
        loopBack,
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
