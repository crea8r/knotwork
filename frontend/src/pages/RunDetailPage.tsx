import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRun, useRunNodes } from '@/api/runs'
import { useSubmitRating } from '@/api/ratings'
import { useGraph } from '@/api/graphs'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import type { NodeStatus, RunNodeState } from '@/types'
import { useAuthStore } from '@/store/auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused — awaiting review',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'text-gray-500',
  running: 'text-blue-600',
  paused: 'text-amber-600',
  completed: 'text-green-600',
  failed: 'text-red-600',
  stopped: 'text-gray-400',
}

const TERMINAL = new Set(['completed', 'failed', 'stopped'])

function StarRating({
  workspaceId,
  runId,
  nodeState,
}: {
  workspaceId: string
  runId: string
  nodeState: RunNodeState
}) {
  const [hovered, setHovered] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const submit = useSubmitRating(workspaceId, runId, nodeState.id)
  if (nodeState.status !== 'completed') return null
  if (submitted) return <span className="text-xs text-green-600">Rated</span>
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          className={`text-base leading-none ${s <= hovered ? 'text-amber-400' : 'text-gray-300'}`}
          onMouseEnter={() => setHovered(s)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => {
            submit.mutate({ score: s }, { onSuccess: () => setSubmitted(true) })
          }}
        >
          ★
        </button>
      ))}
    </span>
  )
}

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const { data: run, refetch: refetchRun } = useRun(workspaceId, runId!, {
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)?.status
      return !status || status === 'queued' ? 2000 : false
    },
  })

  const { data: nodeStates = [], refetch: refetchNodes } = useRunNodes(workspaceId, runId!)
  const { data: graph } = useGraph(workspaceId, run?.graph_id ?? '')

  const definition = graph?.latest_version?.definition ?? { nodes: [], edges: [] }
  const nodeStatuses = Object.fromEntries(
    nodeStates.map((n) => [n.node_id, n.status as NodeStatus]),
  )

  // WebSocket: receive live events and trigger refetches
  const wsRef = useRef<WebSocket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)

  useEffect(() => {
    if (!runId || (run && TERMINAL.has(run.status))) return

    const apiBase = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1')
      .replace(/^http/, 'ws')
    const ws = new WebSocket(`${apiBase}/ws/runs/${runId}`)
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string)
        if (event.type === 'node_completed' || event.type === 'escalation_created') {
          refetchNodes()
        }
        if (event.type === 'run_status_changed') {
          refetchRun()
        }
      } catch {
        // ignore malformed
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [runId, run?.status, refetchRun, refetchNodes])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center gap-4">
        <div>
          <p className="text-xs text-gray-400">Run</p>
          <p className="font-mono text-sm text-gray-700">{runId?.slice(0, 8)}…</p>
        </div>
        {run && (
          <span className={`text-sm font-medium ${STATUS_COLOR[run.status] ?? 'text-gray-600'}`}>
            {STATUS_LABEL[run.status] ?? run.status}
          </span>
        )}
        {wsConnected && run?.status === 'running' && (
          <span className="text-xs text-blue-400 animate-pulse">live</span>
        )}
        {run?.status === 'paused' && (
          <a
            href={`/escalations`}
            className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded hover:bg-amber-200"
          >
            Review escalation →
          </a>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 overflow-hidden">
        <GraphCanvas definition={definition} nodeStatuses={nodeStatuses} />
      </div>

      {/* Node state table */}
      {nodeStates.length > 0 && (
        <div className="border-t border-gray-200 px-6 py-3 bg-white max-h-48 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 text-left">
                <th className="pb-1">Node</th>
                <th className="pb-1">Status</th>
                <th className="pb-1">Confidence</th>
                <th className="pb-1">Tokens</th>
                <th className="pb-1">Rate</th>
              </tr>
            </thead>
            <tbody>
              {nodeStates.map((ns) => (
                <tr key={ns.id} className="border-t border-gray-100">
                  <td className="py-1 font-mono text-xs">{ns.node_id}</td>
                  <td className="py-1 capitalize">{ns.status}</td>
                  <td className="py-1">
                    {ns.confidence_score != null
                      ? (ns.confidence_score * 100).toFixed(0) + '%'
                      : '—'}
                  </td>
                  <td className="py-1">{ns.resolved_token_count ?? '—'}</td>
                  <td className="py-1">
                    <StarRating workspaceId={workspaceId} runId={runId!} nodeState={ns} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
