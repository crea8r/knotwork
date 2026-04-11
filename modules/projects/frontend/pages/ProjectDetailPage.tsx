import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Send } from 'lucide-react'
import {
  useCreateObjective,
  useCreateProjectStatusUpdate,
  useProjectChannels,
  useProjectDashboard,
} from "@modules/projects/frontend/api/projects"
import { useRuns } from "@modules/workflows/frontend/api/runs"
import { useAuthStore } from '@auth'
import Btn from '@ui/components/Btn'
import Spinner from '@ui/components/Spinner'
import { projectObjectivePath } from '@app-shell/paths'
import type { Channel, Objective, Project, Run } from '@data-models'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export type ProjectActiveItem =
  | { kind: 'home' }
  | { kind: 'assets' }
  | { kind: 'objective'; objectiveId: string }
  | { kind: 'channel'; channelId: string }

export interface ProjectChannelNavItem {
  channel: Channel
  label: string
  updatedAt: string
  archivedAt: string | null
  kind: 'objective' | 'channel'
  objectiveId?: string
  run?: Run | null
}

export interface ProjectOutletContext {
  workspaceId: string
  projectId: string
  projectSlug: string
  project: Project
  objectives: Objective[]
  recentRuns: Run[]
  projectChannels: ProjectChannelNavItem[]
  onNewObjective: () => void
  onUpdateStatus: () => void
}

export default function ProjectDetailPage() {
  const { projectSlug = '' } = useParams<{ projectSlug: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: dashboard, isLoading } = useProjectDashboard(workspaceId, projectSlug)
  const { data: channels = [] } = useProjectChannels(workspaceId, projectSlug, true)
  const { data: runs = [] } = useRuns(workspaceId)

  const [showObjectiveComposer, setShowObjectiveComposer] = useState(false)
  const [showStatusDialog, setShowStatusDialog] = useState(false)
  const [projectStatusDraft, setProjectStatusDraft] = useState('')
  const [composerForm, setComposerForm] = useState({ title: '', description: '', parentObjectiveId: '' })

  const createObjective = useCreateObjective(workspaceId)
  const createStatus = useCreateProjectStatusUpdate(workspaceId, projectSlug)

  useEffect(() => {
    if (projectSlug) {
      localStorage.setItem('kw-last-project', projectSlug)
    }
  }, [projectSlug])

  useEffect(() => {
    if (location.state?.openObjectiveComposer) {
      setComposerForm({ title: '', description: '', parentObjectiveId: '' })
      setShowObjectiveComposer(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.pathname, location.state, navigate])

  const project = dashboard?.project
  const objectives = dashboard?.objectives ?? []
  const recentRuns = dashboard?.recent_runs ?? []
  const projectTitle = project?.title ?? 'Project'
  const objectiveMap = useMemo(() => new Map(objectives.map((objective) => [objective.id, objective])), [objectives])
  const projectRuns = useMemo(() => runs.filter((run) => run.project_id === project?.id), [project?.id, runs])
  const runByChannelName = useMemo(() => new Map(projectRuns.map((run) => [`run:${run.id}`, run])), [projectRuns])

  const projectChannels = useMemo<ProjectChannelNavItem[]>(() => {
    return channels
      .filter((channel) => channel.id !== project?.project_channel_id)
      .map((channel) => {
        if (channel.channel_type === 'objective' && channel.objective_id) {
          const objective = objectiveMap.get(channel.objective_id)
          return {
            channel,
            label: objective ? [objective.code, objective.title].filter(Boolean).join(' · ') : channel.name,
            updatedAt: channel.updated_at,
            archivedAt: channel.archived_at,
            kind: 'objective' as const,
            objectiveId: channel.objective_id,
            run: null,
          }
        }

        const run = channel.channel_type === 'run' ? (runByChannelName.get(channel.name) ?? null) : null
        return {
          channel,
          label: run?.name?.trim() || (run ? `Run ${run.id.slice(0, 8)}` : channel.name),
          updatedAt: channel.updated_at,
          archivedAt: channel.archived_at,
          kind: 'channel' as const,
          run,
        }
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [channels, objectiveMap, project?.project_channel_id, runByChannelName])

  const orderedObjectives = useMemo(() => {
    const children = new Map<string | null, Objective[]>()
    for (const objective of objectives) {
      const key = objective.parent_objective_id ?? null
      const list = children.get(key) ?? []
      list.push(objective)
      children.set(key, list)
    }

    function segmentValue(code: string | null) {
      if (!code) return [Number.MAX_SAFE_INTEGER]
      return code
        .replace(/^[A-Z]/i, '')
        .split('.')
        .map((part) => Number.parseInt(part, 10))
        .filter((part) => !Number.isNaN(part))
    }

    function compareObjectives(a: Objective, b: Objective) {
      const aSeg = segmentValue(a.code)
      const bSeg = segmentValue(b.code)
      const len = Math.max(aSeg.length, bSeg.length)
      for (let i = 0; i < len; i += 1) {
        const diff = (aSeg[i] ?? Number.MAX_SAFE_INTEGER) - (bSeg[i] ?? Number.MAX_SAFE_INTEGER)
        if (diff !== 0) return diff
      }
      return a.title.localeCompare(b.title)
    }

    const flattened: Array<{ objective: Objective; depth: number }> = []
    function visit(parentId: string | null, depth: number) {
      const siblings = [...(children.get(parentId) ?? [])].sort(compareObjectives)
      for (const objective of siblings) {
        flattened.push({ objective, depth })
        visit(objective.id, depth + 1)
      }
    }
    visit(null, 0)
    return flattened
  }, [objectives])

  const generatedObjectiveCode = useMemo(() => {
    const projectPrefix = (projectTitle.match(/[A-Za-z]/)?.[0] ?? 'P').toUpperCase()
    const parentObjective = composerForm.parentObjectiveId
      ? objectives.find((objective) => objective.id === composerForm.parentObjectiveId) ?? null
      : null
    const siblingObjectives = objectives.filter((objective) => (
      (objective.parent_objective_id ?? '') === (parentObjective?.id ?? '')
    ))
    const nextIndex = siblingObjectives.reduce((maxIndex, objective) => {
      if (!objective.code) return maxIndex
      if (parentObjective?.code) {
        const match = objective.code.match(new RegExp(`^${parentObjective.code.replace('.', '\\.')}\\.(\\d+)$`))
        return match ? Math.max(maxIndex, Number.parseInt(match[1], 10)) : maxIndex
      }
      const match = objective.code.match(new RegExp(`^${projectPrefix}(\\d+)$`, 'i'))
      return match ? Math.max(maxIndex, Number.parseInt(match[1], 10)) : maxIndex
    }, 0) + 1

    return parentObjective?.code
      ? `${parentObjective.code}.${nextIndex}`
      : `${projectPrefix}${nextIndex}`
  }, [composerForm.parentObjectiveId, objectives, projectTitle])

  async function createNewObjective() {
    if (!project) return
    if (!composerForm.title.trim()) return
    const objective = await createObjective.mutateAsync({
      code: generatedObjectiveCode,
      title: composerForm.title.trim(),
      description: composerForm.description.trim() || undefined,
      project_id: project.id,
      parent_objective_id: composerForm.parentObjectiveId || undefined,
      status_summary: 'New objective. Needs a first update.',
    })
    setShowObjectiveComposer(false)
    setComposerForm({ title: '', description: '', parentObjectiveId: '' })
    navigate(projectObjectivePath(project.slug, objective.slug))
  }

  if (isLoading || !project) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  const outletContext: ProjectOutletContext = {
    workspaceId,
    projectId: project.id,
    projectSlug: project.slug,
    project,
    objectives,
    recentRuns,
    projectChannels,
    onNewObjective: () => {
      setComposerForm({ title: '', description: '', parentObjectiveId: '' })
      setShowObjectiveComposer(true)
    },
    onUpdateStatus: () => setShowStatusDialog(true),
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Outlet context={outletContext} />
      </div>

      {showObjectiveComposer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-[32px] bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-stone-950">New Objective</h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => { e.preventDefault(); void createNewObjective() }}
            >
              <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                <label className="text-sm text-stone-600">
                  Parent objective
                  <select
                    value={composerForm.parentObjectiveId}
                    onChange={(e) => setComposerForm((current) => ({ ...current, parentObjectiveId: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  >
                    <option value="">None</option>
                    {orderedObjectives.map(({ objective, depth }) => (
                      <option key={objective.id} value={objective.id}>
                        {`${'  '.repeat(depth)}${[objective.code, objective.title].filter(Boolean).join(' · ')}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-stone-600">
                  Title
                  <input
                    autoFocus
                    value={composerForm.title}
                    onChange={(e) => setComposerForm((c) => ({ ...c, title: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </label>
              </div>
              <label className="block text-sm text-stone-600">
                Code
                <div className="mt-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">
                  {generatedObjectiveCode}
                </div>
              </label>
              <label className="block text-sm text-stone-600">
                Description
                <textarea
                  rows={4}
                  value={composerForm.description}
                  onChange={(e) => setComposerForm((c) => ({ ...c, description: e.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Btn type="button" variant="ghost" size="sm" onClick={() => setShowObjectiveComposer(false)}>Cancel</Btn>
                <Btn type="submit" size="sm" loading={createObjective.isPending}>Create Objective</Btn>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStatusDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-[32px] bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-stone-950">Update Project Status</h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (!projectStatusDraft.trim()) return
                createStatus.mutate(
                  { summary: projectStatusDraft.trim(), author_name: 'You' },
                  { onSuccess: () => { setProjectStatusDraft(''); setShowStatusDialog(false) } },
                )
              }}
            >
              <textarea
                rows={6}
                value={projectStatusDraft}
                onChange={(e) => setProjectStatusDraft(e.target.value)}
                placeholder="Write a concise project status update."
                className="w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
              />
              <div className="flex justify-end gap-2">
                <Btn type="button" variant="ghost" size="sm" onClick={() => setShowStatusDialog(false)}>Cancel</Btn>
                <Btn type="submit" size="sm" loading={createStatus.isPending}>
                  <Send size={14} /> Save Status
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
