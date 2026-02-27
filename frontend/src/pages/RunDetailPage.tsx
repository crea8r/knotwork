import { useParams } from 'react-router-dom'
import { useRun, useRunNodes } from '@/api/runs'
import { useGraph } from '@/api/graphs'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import type { NodeStatus } from '@/types'
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

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  // Poll every 2s — the hook itself will stop refetching when the component unmounts
  const { data: run } = useRun(workspaceId, runId!, { refetchInterval: 2000 })

  const { data: nodeStates = [] } = useRunNodes(workspaceId, runId!)
  const { data: graph } = useGraph(workspaceId, run?.graph_id ?? '')

  const definition = graph?.latest_version?.definition ?? { nodes: [], edges: [] }

  const nodeStatuses = Object.fromEntries(
    nodeStates.map((n) => [n.node_id, n.status as NodeStatus]),
  )

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
        {run?.status === 'running' && (
          <span className="text-xs text-gray-400 animate-pulse">live</span>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
