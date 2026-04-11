import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { useCreateGraph } from "@modules/workflows/frontend/api/graphs"
import { useAuthStore } from '@auth'
import Btn from '@ui/components/Btn'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

interface Props {
  folder: string
  onCreate: (graphId: string) => void
  onCancel: () => void
  projectId?: string | null
}

export default function NewWorkflowPanel({ folder, onCreate, onCancel, projectId }: Props) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const createGraph = useCreateGraph(workspaceId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      const graph = await createGraph.mutateAsync({
        name: name.trim(),
        path: folder,
        description: description.trim() || undefined,
        project_id: projectId ?? undefined,
      })
      onCreate(graph.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
        <GitBranch size={18} className="flex-shrink-0 text-brand-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">New Workflow</h2>
          {folder && <p className="mt-0.5 text-xs text-gray-400">in {folder}</p>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 space-y-4 p-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Workflow name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer onboarding"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What this workflow does"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex items-center gap-2 pt-2">
          <Btn type="submit" loading={createGraph.isPending}>Create Workflow</Btn>
          <Btn type="button" variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </form>
    </div>
  )
}
