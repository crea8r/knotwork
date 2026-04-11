import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useObjective } from "@modules/projects/frontend/api/projects"
import { useAuthStore } from '@auth'
import Spinner from '@ui/components/Spinner'
import { projectObjectivePath } from '@app-shell/paths'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export default function ObjectiveDetailPage() {
  const { objectiveSlug = '' } = useParams<{ objectiveSlug: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: objective, isLoading } = useObjective(workspaceId, objectiveSlug)

  useEffect(() => {
    if (!objective?.project_id || !objective.project_slug) return
    navigate(projectObjectivePath(objective.project_slug, objective.slug), { replace: true })
  }, [navigate, objective])

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  if (!objective?.project_id) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-sm text-stone-600">This objective is not attached to a project.</p>
        <Link to="/projects?view=list" className="text-sm text-brand-700 hover:text-brand-900">
          Open project list
        </Link>
      </div>
    )
  }

  return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
}
