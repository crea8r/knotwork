import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, Pencil, Check, Play } from 'lucide-react'
import axios from 'axios'
import { useRuns, useDeleteRun, useRenameRun } from '@/api/runs'
import { useGraphs } from '@/api/graphs'
import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import EmptyState from '@/components/shared/EmptyState'
import Spinner from '@/components/shared/Spinner'
import RunTriggerModal from '@/components/operator/RunTriggerModal'
import { DraftRunBadge } from '@/components/shared/DraftRunBadge'
import { validateGraph } from '@/utils/validateGraph'
import { isDraftRun } from '@/types'
import type { Run, RunStatus, GraphDefinition } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const ROW_DELETE_STATUSES = new Set<RunStatus>(['completed', 'failed', 'stopped'])
const PAGE_SIZE = 10

type Filter = 'all' | 'active' | 'completed' | 'failed'
const FILTER_STATUSES: Record<Filter, RunStatus[] | null> = {
  all: null,
  active: ['queued', 'running', 'paused'],
  completed: ['completed'],
  failed: ['failed', 'stopped'],
}

function duration(createdAt: string, completedAt: string | null) {
  if (!completedAt) return '—'
  const s = Math.floor((new Date(completedAt).getTime() - new Date(createdAt).getTime()) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function inputSummary(input: Record<string, unknown>): string {
  const vals = Object.values(input)
  if (!vals.length) return '—'
  const first = String(vals[0])
  return first.length > 55 ? first.slice(0, 52) + '…' : first
}

function InlineName({ run, workspaceId }: { run: Run; workspaceId: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(run.name ?? '')
  const rename = useRenameRun(workspaceId)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setValue(run.name ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function commit(e: React.MouseEvent) {
    e.stopPropagation()
    if (value.trim()) rename.mutate({ runId: run.id, name: value.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { if (value.trim()) rename.mutate({ runId: run.id, name: value.trim() }); setEditing(false) }
            if (e.key === 'Escape') setEditing(false)
          }}
          className="border border-brand-400 rounded px-1.5 py-0.5 text-xs font-medium outline-none w-36"
        />
        <button onClick={commit} className="text-green-600 hover:text-green-700"><Check size={12} /></button>
      </div>
    )
  }

  return (
    <button onClick={startEdit} className="flex items-center gap-1 group max-w-[160px] text-left">
      <span className="text-xs font-medium text-gray-800 truncate">
        {run.name ?? <span className="text-gray-300 italic">Name…</span>}
      </span>
      <Pencil size={10} className="flex-shrink-0 text-gray-200 group-hover:text-gray-400" />
    </button>
  )
}

export default function RunsPage() {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const [filter, setFilter] = useState<Filter>('all')
  const [showDraftRuns, setShowDraftRuns] = useState(false)
  const { data: runs = [], isLoading } = useRuns(workspaceId)
  const { data: graphs = [] } = useGraphs(workspaceId)
  const deleteRun = useDeleteRun(workspaceId)
  const [showNewRun, setShowNewRun] = useState(false)
  const [selectedGraphId, setSelectedGraphId] = useState('')
  const [runTrigger, setRunTrigger] = useState<{ graphId: string; definition: GraphDefinition } | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const runnableGraphs = useMemo(
    () =>
      graphs.filter((g) => {
        if (g.status === 'archived') return false
        const def = g.latest_version?.definition
        if (!def) return false
        return validateGraph(def).length === 0
      }),
    [graphs],
  )

  const graphNameById = Object.fromEntries(graphs.map((g) => [g.id, g.name]))
  const statuses = FILTER_STATUSES[filter]
  // By default exclude draft runs; show them only when toggle is on
  const filteredByDraft = showDraftRuns ? runs : runs.filter((r) => !isDraftRun(r))
  const filteredByStatus = statuses ? filteredByDraft.filter((r) => statuses.includes(r.status)) : filteredByDraft
  const q = search.trim().toLowerCase()
  const filtered = q
    ? filteredByStatus.filter((r) => {
        const graphName = (graphNameById[r.graph_id] ?? '').toLowerCase()
        return (
          (r.name ?? '').toLowerCase().includes(q)
          || r.id.toLowerCase().includes(q)
          || graphName.includes(q)
          || r.status.toLowerCase().includes(q)
        )
      })
    : filteredByStatus
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visibleRuns = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [filter, search])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  async function handleDelete(e: React.MouseEvent, runId: string) {
    e.stopPropagation()
    if (!confirm('Delete this run? This cannot be undone.')) return
    try {
      await deleteRun.mutateAsync(runId)
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.detail ?? err.message)
        : String(err)
      alert(`Delete failed: ${message}`)
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Runs"
        actions={(
          <button
            onClick={() => setShowNewRun(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm"
          >
            <Play size={14} />
            New run
          </button>
        )}
      />

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {(['all', 'active', 'completed', 'failed'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${
              filter === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            {f}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDraftRuns}
            onChange={(e) => setShowDraftRuns(e.target.checked)}
            className="h-3 w-3 rounded"
          />
          Show draft runs
        </label>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search runs by name, id, workflow, or status..."
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-6 outline-none focus:ring-2 focus:ring-brand-500"
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState heading="No runs found" subtext="Trigger a graph from the Designer to see runs here." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b bg-gray-50">
                <th className="text-left px-3 py-3">Name / ID</th>
                <th className="text-left px-3 py-3">Graph</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-left px-3 py-3">Input</th>
                <th className="text-left px-3 py-3">Output</th>
                <th className="text-left px-3 py-3">Tokens</th>
                <th className="text-left px-3 py-3">Started</th>
                <th className="text-left px-3 py-3">Duration</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRuns.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => navigate(`/runs/${run.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <InlineName run={run} workspaceId={workspaceId} />
                    <p className="font-mono text-[10px] text-gray-300">{run.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {graphNameById[run.graph_id] ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <StatusBadge status={run.status} />
                      {isDraftRun(run) && <DraftRunBadge />}
                      {run.needs_attention && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                          ⚠ Review
                        </span>
                      )}
                    </div>
                    {run.status === 'failed' && run.error && (
                      <p className="text-[10px] text-red-500 mt-0.5 max-w-[180px] truncate" title={run.error}>
                        {run.error}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-[140px] truncate">
                    {inputSummary(run.input)}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-[180px] truncate">
                    {run.output_summary
                      ? run.output_summary
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">
                    {run.total_tokens != null ? run.total_tokens.toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {run.started_at ? timeAgo(run.started_at) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {duration(run.created_at, run.completed_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {ROW_DELETE_STATUSES.has(run.status) && (
                      <button
                        onClick={(e) => handleDelete(e, run.id)}
                        disabled={deleteRun.isPending}
                        className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 p-1 rounded disabled:opacity-40"
                        title="Delete run"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-xs text-gray-500">Page {page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {showNewRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-3">Create run</h2>
            <label className="block text-xs text-gray-500 mb-1">Runnable workflow</label>
            <select
              value={selectedGraphId}
              onChange={(e) => setSelectedGraphId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select workflow...</option>
              {runnableGraphs.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">Only eligible workflows are listed.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewRun(false)} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={() => {
                  const graph = runnableGraphs.find((g) => g.id === selectedGraphId)
                  const def = graph?.latest_version?.definition
                  if (!graph || !def) return
                  setShowNewRun(false)
                  setRunTrigger({ graphId: graph.id, definition: def })
                }}
                disabled={!selectedGraphId}
                className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {runTrigger && (
        <RunTriggerModal
          graphId={runTrigger.graphId}
          definition={runTrigger.definition}
          onClose={() => setRunTrigger(null)}
        />
      )}
    </div>
  )
}
