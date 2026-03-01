import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, GitBranch } from 'lucide-react'
import { useCreateGraph, useGraphs } from '@/api/graphs'
import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Btn from '@/components/shared/Btn'
import EmptyState from '@/components/shared/EmptyState'
import Spinner from '@/components/shared/Spinner'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

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
  archived: 'blue',
}

export default function GraphsPage() {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: graphs, isLoading } = useGraphs(workspaceId)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = (graphs ?? []).filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Designer"
        subtitle="Build and edit agent graphs."
        actions={
          <Btn size="sm" onClick={() => setShowModal(true)}>
            <Plus size={14} /> New Graph
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
          {filtered.map((g) => (
            <Card key={g.id} className="p-4" onClick={() => navigate(`/graphs/${g.id}`)}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{g.name}</p>
                  {g.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{g.description}</p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[g.status] ?? 'gray'}>{g.status}</Badge>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Updated {new Date(g.updated_at).toLocaleDateString()}
              </p>
            </Card>
          ))}
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
