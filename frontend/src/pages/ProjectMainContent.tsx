import { useState } from 'react'
import { FolderKanban } from 'lucide-react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { usePostChannelMessage } from '@/api/channels'
import { useGraphs } from '@/api/graphs'
import { useUpdateProject } from '@/api/projects'
import { ChannelShell, ChannelTimeline } from '@/components/channel/ChannelFrame'
import WorkflowSlashComposer from '@/components/channel/WorkflowSlashComposer'
import { useChannelTimeline } from '@/components/channel/useChannelTimeline'
import ProjectDashboard from '@/components/project/ProjectDashboard'
import { projectChannelPath, projectObjectivePath, projectPath } from '@/lib/paths'
import type { ProjectOutletContext } from './ProjectDetailPage'

export default function ProjectMainContent() {
  const { workspaceId, projectId, project, objectives, recentRuns, projectChannels, onNewObjective, onUpdateStatus } = useOutletContext<ProjectOutletContext>()
  const navigate = useNavigate()
  const [projectChatDraft, setProjectChatDraft] = useState('')
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(() => localStorage.getItem('kw-pinned-project'))

  const projectChannelId = project.project_channel_id ?? null
  const { data: workflows = [] } = useGraphs(workspaceId)
  const { items: timelineItems } = useChannelTimeline(workspaceId, projectChannelId ?? '')
  const postProjectMessage = usePostChannelMessage(workspaceId, projectChannelId ?? '')
  const updateProject = useUpdateProject(workspaceId, projectId)

  function togglePinProject() {
    const next = pinnedProjectId === projectId ? null : projectId
    setPinnedProjectId(next)
    if (next) {
      localStorage.setItem('kw-pinned-project', next)
    } else {
      localStorage.removeItem('kw-pinned-project')
    }
    window.dispatchEvent(new CustomEvent('kw:pinned-project-changed', { detail: { projectId: next } }))
  }

  return (
    <div className="h-full min-h-0 p-4 md:p-6">
      <ChannelShell
        eyebrow={(
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
            <Link to={projectPath(project.slug)} className="truncate hover:text-stone-800">
              {project.title}
            </Link>
          </div>
        )}
        typeIcon={<FolderKanban size={14} />}
        title={project.title}
        description={project.description || undefined}
        onRenameTitle={async (value) => { await updateProject.mutateAsync({ title: value }) }}
        renamePending={updateProject.isPending}
        topPanel={(
        <ProjectDashboard
          project={project}
          objectives={objectives}
          runs={recentRuns}
          channels={projectChannels}
          onObjectiveClick={(id) => {
            const objective = objectives.find((item) => item.id === id)
            if (objective) navigate(projectObjectivePath(project.slug, objective.slug))
          }}
          onRunClick={(id) => navigate(`/runs/${id}`)}
          onChannelClick={(channel) => navigate(
            channel.kind === 'objective' && channel.objectiveId
              ? projectObjectivePath(
                project.slug,
                objectives.find((item) => item.id === channel.objectiveId)?.slug ?? channel.channel.slug,
              )
              : channel.channel.graph_id
                ? `/graphs/${channel.channel.graph_id}?chat=1`
              : projectChannelPath(project.slug, channel.channel.slug),
          )}
          onUpdateStatus={onUpdateStatus}
          onNewObjective={onNewObjective}
          pinned={pinnedProjectId === projectId}
          onTogglePin={togglePinProject}
        />
      )}
      >
        <ChannelTimeline items={timelineItems} />
        <WorkflowSlashComposer
          workspaceId={workspaceId}
          workflows={workflows}
          channelId={projectChannelId}
          draft={projectChatDraft}
          setDraft={setProjectChatDraft}
          onSend={() => {
            if (!projectChannelId || !projectChatDraft.trim()) return
            postProjectMessage.mutate(
              { content: projectChatDraft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
              { onSuccess: () => setProjectChatDraft('') },
            )
          }}
          pending={postProjectMessage.isPending}
          placeholder="Coordinate project work, delegate, or ask for an update…"
        />
      </ChannelShell>
    </div>
  )
}
