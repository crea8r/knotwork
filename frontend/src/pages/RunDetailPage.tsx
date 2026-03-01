import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { FileText, Play, Trash2, Pencil, Check } from 'lucide-react'
import { useRun, useRunNodes, useDeleteRun, useExecuteRunInline, useRenameRun } from '@/api/runs'
import { useGraphVersion } from '@/api/graphs'
import { useEscalations } from '@/api/escalations'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import StatusBadge from '@/components/shared/StatusBadge'
import Spinner from '@/components/shared/Spinner'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import NodeInspectorPanel from '@/components/operator/NodeInspectorPanel'
import RunInputPanel from '@/components/operator/RunInputPanel'
import PostRunNudge from '@/components/operator/PostRunNudge'
import { useAuthStore } from '@/store/auth'
import type { NodeStatus } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const TERMINAL = new Set(['completed', 'failed', 'stopped'])
const ACTIVE = new Set(['queued', 'running'])
const DELETABLE = new Set(['completed', 'failed', 'stopped', 'draft', 'queued', 'paused'])

function InlineRename({ runId, workspaceId, currentName }: { runId: string; workspaceId: string; currentName: string | null }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentName ?? '')
  const rename = useRenameRun(workspaceId)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    if (value.trim()) rename.mutate({ runId, name: value.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="border border-brand-400 rounded px-2 py-0.5 text-sm font-semibold text-gray-900 outline-none w-48"
        />
        <button onClick={commit} className="text-green-600 hover:text-green-700"><Check size={14} /></button>
      </div>
    )
  }
  return (
    <button
      onClick={() => { setValue(currentName ?? ''); setEditing(true) }}
      className="flex items-center gap-1 group"
      title="Click to rename"
    >
      <span className="font-semibold text-gray-900 text-sm">
        {currentName ?? <span className="text-gray-400 font-normal">Untitled run</span>}
      </span>
      <Pencil size={11} className="text-gray-300 group-hover:text-gray-500" />
    </button>
  )
}

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const { data: run, refetch: refetchRun } = useRun(workspaceId, runId!, {
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)?.status
      return !status || ACTIVE.has(status) ? 2000 : false
    },
  })
  const { data: nodeStates = [], refetch: refetchNodes } = useRunNodes(workspaceId, runId!, {
    refetchInterval: run && ACTIVE.has(run.status) ? 3000 : false,
  })

  // Use the exact graph version the run was executed against
  const { data: graphVersion } = useGraphVersion(workspaceId, run?.graph_version_id ?? '')
  const { data: escalations = [] } = useEscalations(workspaceId)
  const deleteRun = useDeleteRun(workspaceId)
  const executeInline = useExecuteRunInline(workspaceId)

  const definition = graphVersion?.definition ?? { nodes: [], edges: [] }
  const nodeStatuses = Object.fromEntries(
    nodeStates.map((n) => [n.node_id, n.status as NodeStatus]),
  )
  const nodeNameMap = Object.fromEntries(
    (definition.nodes ?? []).map(n => [n.id, n.name])
  )

  const [showInputPanel, setShowInputPanel] = useState(false)
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null)
  const inspectedNode = inspectedNodeId
    ? (nodeStates.find((n) => n.node_id === inspectedNodeId) ?? null)
    : null
  const [lastRating] = useState<number | null>(null)
  const [lastRatedNodeId] = useState<string | null>(null)

  // WebSocket
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
        if (event.type === 'node_completed' || event.type === 'escalation_created') refetchNodes()
        if (event.type === 'run_status_changed') { refetchRun(); refetchNodes() }
      } catch { /* ignore malformed */ }
    }
    return () => { ws.close(); wsRef.current = null }
  }, [runId, run?.status, refetchRun, refetchNodes])

  const lastCompletedNode = [...nodeStates]
    .reverse()
    .find((n) => n.status === 'completed' && n.output != null)
  const resultText =
    lastCompletedNode?.output != null &&
    typeof (lastCompletedNode.output as Record<string, unknown>).text === 'string'
      ? (lastCompletedNode.output as Record<string, unknown>).text as string
      : null

  async function handleDelete() {
    if (!confirm('Delete this run? This cannot be undone.')) return
    await deleteRun.mutateAsync(runId!)
    navigate('/runs')
  }

  const isDeletable = run ? DELETABLE.has(run.status) : false

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-400">Run</p>
          <p className="font-mono text-xs text-gray-400">{runId?.slice(0, 8)}…</p>
        </div>
        {run && <InlineRename runId={runId!} workspaceId={workspaceId} currentName={run.name} />}
        {run && <StatusBadge status={run.status} />}
        {run && (
          <button
            onClick={() => { setShowInputPanel((v) => !v); setInspectedNodeId(null) }}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
              showInputPanel
                ? 'border-brand-400 text-brand-600 bg-brand-50'
                : 'border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            <FileText size={12} /> Input
          </button>
        )}
        {(run?.status === 'queued' || run?.status === 'draft') && (
          <button
            onClick={() => executeInline.mutate(runId!, {
              onSuccess: () => { refetchRun(); refetchNodes() },
              onError: () => { refetchRun(); refetchNodes() },
            })}
            disabled={executeInline.isPending || executeInline.isSuccess}
            className="flex items-center gap-1.5 text-xs bg-brand-500 text-white px-3 py-1.5 rounded-lg hover:bg-brand-600 disabled:opacity-50"
          >
            <Play size={12} /> {executeInline.isPending || executeInline.isSuccess ? 'Starting…' : 'Run now'}
          </button>
        )}
        {wsConnected && run?.status === 'running' && (
          <span className="text-xs text-blue-400 animate-pulse">live</span>
        )}
        {run?.status === 'paused' && (
          <Link
            to="/escalations"
            className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded hover:bg-amber-200"
          >
            Review escalation →
          </Link>
        )}
        {isDeletable && (
          <button
            onClick={handleDelete}
            disabled={deleteRun.isPending}
            className="ml-auto flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>

      {/* Run result banner */}
      {run?.status === 'completed' && resultText && (
        <div className="mx-6 mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-3">
            Result — {nodeNameMap[lastCompletedNode!.node_id] ?? lastCompletedNode!.node_id}
          </p>
          <MarkdownViewer content={resultText} maxHeight="20rem" />
        </div>
      )}

      {run && run.status !== 'completed' && (
        <div className="px-6 pt-3">
          <PostRunNudge
            run={run}
            nodeStates={nodeStates}
            escalations={escalations}
            lastRating={lastRating}
            lastRatedNodeId={lastRatedNodeId}
          />
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 p-4 overflow-hidden">
        {!run ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : (
          <GraphCanvas
            definition={definition}
            nodeStatuses={nodeStatuses}
            selectedNodeId={inspectedNodeId}
            onSelectNode={(nodeId) => setInspectedNodeId(nodeId)}
          />
        )}
      </div>

      {/* Node state table */}
      {nodeStates.length > 0 && (
        <div className="border-t border-gray-200 px-6 py-3 bg-white max-h-52 overflow-y-auto">
          <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Nodes</p>
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
                <tr
                  key={ns.id}
                  className="border-t border-gray-100 cursor-pointer hover:bg-gray-50"
                  onClick={() => setInspectedNodeId(ns.node_id)}
                >
                  <td className="py-1 text-xs text-gray-900 font-medium">
                    {nodeNameMap[ns.node_id] ?? ns.node_id}
                  </td>
                  <td className="py-1"><StatusBadge status={ns.status} /></td>
                  <td className="py-1 text-xs text-gray-500">
                    {ns.confidence_score != null
                      ? (ns.confidence_score * 100).toFixed(0) + '%' : '—'}
                  </td>
                  <td className="py-1 text-xs text-gray-500">{ns.resolved_token_count ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showInputPanel && run && (
        <RunInputPanel
          runId={runId!}
          workspaceId={workspaceId}
          runStatus={run.status}
          input={run.input}
          definition={definition}
          onClose={() => setShowInputPanel(false)}
          onInputSaved={refetchRun}
        />
      )}

      {inspectedNodeId && (
        <NodeInspectorPanel
          nodeId={inspectedNodeId}
          nodeName={nodeNameMap[inspectedNodeId]}
          nodeState={inspectedNode}
          workspaceId={workspaceId}
          runId={runId!}
          onClose={() => setInspectedNodeId(null)}
        />
      )}
    </div>
  )
}
