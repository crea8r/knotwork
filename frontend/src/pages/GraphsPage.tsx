import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useCreateGraph, useGraphs } from '@/api/graphs'
import { useAuthStore } from '@/store/auth'

// Dev fallback — replace with real auth when Session 2 lands
const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export default function GraphsPage() {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: graphs, isLoading } = useGraphs(workspaceId)
  const createGraph = useCreateGraph(workspaceId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const g = await createGraph.mutateAsync({ name: name.trim() })
    setCreating(false)
    setName('')
    navigate(`/graphs/${g.id}`)
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Graphs</h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600"
        >
          <Plus size={16} /> New graph
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="mb-6 flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Graph name"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="px-4 py-2 text-gray-600 text-sm"
          >
            Cancel
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : !graphs?.length ? (
        <p className="text-gray-400 text-sm">No graphs yet.</p>
      ) : (
        <ul className="space-y-2">
          {graphs.map((g) => (
            <li key={g.id}>
              <button
                onClick={() => navigate(`/graphs/${g.id}`)}
                className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-brand-500 hover:bg-brand-50 transition-colors"
              >
                <span className="font-medium text-gray-900">{g.name}</span>
                {g.description && (
                  <span className="ml-2 text-sm text-gray-500">{g.description}</span>
                )}
                <span className="ml-auto float-right text-xs text-gray-400 capitalize">
                  {g.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
