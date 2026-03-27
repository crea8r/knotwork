import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, Plus } from 'lucide-react'
import { useProjects, useCreateProject } from '@/api/projects'
import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Btn from '@/components/shared/Btn'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

function statusVariant(status: string): 'gray' | 'green' | 'orange' | 'red' {
  if (status === 'done') return 'green'
  if (status === 'blocked') return 'red'
  if (status === 'in_progress') return 'orange'
  return 'gray'
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: projects = [], isLoading } = useProjects(workspaceId)
  const createProject = useCreateProject(workspaceId)
  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !description.trim()) return
    const project = await createProject.mutateAsync({ title: title.trim(), description: description.trim() })
    setShowNew(false)
    setTitle('')
    setDescription('')
    navigate(`/projects/${project.id}`)
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Projects"
        subtitle="Objective-scoped work containers that bring together project knowledge, workflows, channels, and status."
        actions={
          <Btn size="sm" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New Project
          </Btn>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={32} />}
          heading="No projects yet"
          subtext="Create the first project to start organizing work above workflows and runs."
          action={{ label: 'New Project', onClick: () => setShowNew(true) }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <Card key={project.id} className="p-5" onClick={() => navigate(`/projects/${project.id}`)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">{project.title}</h2>
                  <p className="mt-1 text-sm text-gray-600 line-clamp-3">{project.description}</p>
                </div>
                <Badge variant={statusVariant(project.status)}>{project.status.replace('_', ' ')}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-gray-500">
                <div>
                  <p className="font-medium text-gray-700">{project.objective_count}</p>
                  <p>objectives</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">{project.open_objective_count}</p>
                  <p>open</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">{project.run_count}</p>
                  <p>runs</p>
                </div>
              </div>
              {project.latest_status_update && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Latest update</p>
                  <p className="mt-1 text-sm text-gray-700 line-clamp-3">{project.latest_status_update.summary}</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">New project</h2>
            <form className="mt-4 space-y-4" onSubmit={handleCreate}>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title</label>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Btn type="button" variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Btn>
                <Btn type="submit" size="sm" loading={createProject.isPending}>Create</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
