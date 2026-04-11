import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, GitBranch, Plus, Trash2 } from 'lucide-react'
import { useCreateGraph, useDeleteGraph, useGraphs } from "@modules/workflows/frontend/api/graphs"
import { useAuthStore } from '@auth'
import PageHeader from '@ui/components/PageHeader'
import Card from '@ui/components/Card'
import Badge from '@ui/components/Badge'
import Btn from '@ui/components/Btn'
import EmptyState from '@ui/components/EmptyState'
import Spinner from '@ui/components/Spinner'
import { validateGraph } from '@modules/workflows/frontend/lib/validateGraph'
import type { Graph } from '@data-models'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const PAGE_SIZE = 10

function NewGraphModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const createGraph = useCreateGraph(workspaceId)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const g = await createGraph.mutateAsync({ name: name.trim(), description: desc.trim() || undefined })
    onCreated(g.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="font-semibold text-gray-900 mb-4">New Graph</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My workflow"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What does this graph do?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Btn type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" size="sm" loading={createGraph.isPending}>Create</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

const STATUS_VARIANT: Record<string, 'gray' | 'green' | 'blue'> = {
  draft: 'gray',
  active: 'green',
  runnable: 'green',
  archived: 'blue',
}

export default function GraphsPage() {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: graphs, isLoading } = useGraphs(workspaceId)
  const deleteGraph = useDeleteGraph(workspaceId)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const filtered = (graphs ?? []).filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visibleGraphs = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  function computedStatus(g: Graph): string {
    if (g.status === 'archived') return 'archived'
    const def = g.latest_version?.definition
    if (!def) return 'draft'
    const errors = validateGraph(def)
    return errors.length === 0 ? 'runnable' : 'draft'
  }

  async function handleRetireGraph(g: Graph, e: React.MouseEvent) {
    e.stopPropagation()
    const hasRuns = (g.run_count ?? 0) > 0
    const confirmText = hasRuns
      ? `Archive "${g.name}"? It has ${g.run_count} run(s), so it cannot be deleted.`
      : `Delete "${g.name}" permanently?`
    if (!window.confirm(confirmText)) return
    try {
      const result = await deleteGraph.mutateAsync(g.id)
      window.alert(result.action === 'archived' ? 'Workflow archived.' : 'Workflow deleted.')
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? 'Action failed'
      window.alert(`Cannot update workflow: ${msg}`)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Workflows"
        subtitle="Build and edit agent workflows."
        actions={
          <Btn size="sm" onClick={() => setShowModal(true)} title="New Graph">
            <Plus size={14} /><span className="hidden md:inline"> New Graph</span>
          </Btn>
        }
      />

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search graphs…"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-6 outline-none focus:ring-2 focus:ring-brand-500"
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<GitBranch size={32} />}
          heading="No graphs yet"
          subtext="Create your first graph to get started."
          action={{ label: '+ New Graph', onClick: () => setShowModal(true) }}
        />
      ) : (
        <div className="grid gap-3">
          {visibleGraphs.map((g) => (
            <Card key={g.id} className="p-4" onClick={() => navigate(`/graphs/${g.id}`)}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{g.name}</p>
                  {g.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{g.description}</p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">{g.run_count ?? 0} run(s)</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[(computedStatus(g) as keyof typeof STATUS_VARIANT)] ?? 'gray'}>
                    {computedStatus(g)}
                  </Badge>
                  <Btn
                    size="sm"
                    variant={(g.run_count ?? 0) > 0 ? 'secondary' : 'danger'}
                    onClick={(e) => void handleRetireGraph(g, e)}
                    loading={deleteGraph.isPending}
                    title={(g.run_count ?? 0) > 0 ? 'Archive workflow' : 'Delete workflow'}
                  >
                    {(g.run_count ?? 0) > 0 ? <Archive size={12} /> : <Trash2 size={12} />}
                    <span className="hidden md:inline">
                      {(g.run_count ?? 0) > 0 ? ' Archive' : ' Delete'}
                    </span>
                  </Btn>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Updated {new Date(g.updated_at).toLocaleDateString()}
              </p>
            </Card>
          ))}
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

      {showModal && (
        <NewGraphModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => { setShowModal(false); navigate(`/graphs/${id}`) }}
        />
      )}
    </div>
  )
}
