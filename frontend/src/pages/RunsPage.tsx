import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, Pencil, Check } from 'lucide-react'
import { useRuns, useDeleteRun, useRenameRun } from '@/api/runs'
import { useGraphs } from '@/api/graphs'
import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import EmptyState from '@/components/shared/EmptyState'
import Spinner from '@/components/shared/Spinner'
import type { Run, RunStatus } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const DELETABLE = new Set<RunStatus>(['completed', 'failed', 'stopped', 'draft', 'queued', 'paused'])

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
  const { data: runs = [], isLoading } = useRuns(workspaceId)
  const { data: graphs = [] } = useGraphs(workspaceId)
  const deleteRun = useDeleteRun(workspaceId)

  const graphNameById = Object.fromEntries(graphs.map((g) => [g.id, g.name]))
  const statuses = FILTER_STATUSES[filter]
  const filtered = statuses ? runs.filter((r) => statuses.includes(r.status)) : runs

  async function handleDelete(e: React.MouseEvent, runId: string) {
    e.stopPropagation()
    if (!confirm('Delete this run? This cannot be undone.')) return
    await deleteRun.mutateAsync(runId)
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader title="Runs" />

      <div className="flex gap-2 mb-6">
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
      </div>

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
              {filtered.map((run) => (
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
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={run.status} />
                      {run.needs_attention && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                          ⚠ Review
                        </span>
                      )}
                    </div>
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
                    {DELETABLE.has(run.status) && (
                      <button
                        onClick={(e) => handleDelete(e, run.id)}
                        disabled={deleteRun.isPending}
                        className="text-gray-300 hover:text-red-500 p-1 rounded"
                        title="Delete run"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
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
