import { useRef, useState } from 'react'
import { FolderKanban } from 'lucide-react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { usePostChannelMessage } from '@modules/communication/frontend/api/channels'
import { useGraphs } from "@modules/workflows/frontend/api/graphs"
import { useUpdateProject } from "@modules/projects/frontend/api/projects"
import { ChannelShell, ChannelTimeline } from '@modules/communication/frontend/components/ChannelFrame'
import ChannelParticipantsPanel from '@modules/communication/frontend/components/ChannelParticipantsPanel'
import WorkflowSlashComposer from '@modules/communication/frontend/components/WorkflowSlashComposer'
import { useMentionDetection } from '@modules/communication/frontend/components/useMentionDetection'
import { useChannelTimeline } from '@modules/communication/frontend/components/useChannelTimeline'
import ProjectDashboard from '@modules/projects/frontend/components/ProjectDashboard'
import { projectChannelPath, projectObjectivePath, projectPath } from '@app-shell/paths'
import type { ProjectOutletContext } from './ProjectDetailPage'

export default function ProjectMainContent() {
  const { workspaceId, projectId, project, objectives, recentRuns, projectChannels, onNewObjective, onUpdateStatus } = useOutletContext<ProjectOutletContext>()
  const navigate = useNavigate()
  const [projectChatDraft, setProjectChatDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(() => localStorage.getItem('kw-pinned-project'))

  const projectChannelId = project.project_channel_id ?? null
  const { data: workflows = [] } = useGraphs(workspaceId)
  const { items: timelineItems } = useChannelTimeline(workspaceId, projectChannelId ?? '')
  const postProjectMessage = usePostChannelMessage(workspaceId, projectChannelId ?? '')
  const updateProject = useUpdateProject(workspaceId, projectId)
  const { mentionMenuNode } = useMentionDetection(workspaceId, projectChatDraft, setProjectChatDraft, inputRef)

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
        context={projectChannelId ? <ChannelParticipantsPanel workspaceId={workspaceId} channelId={projectChannelId} /> : null}
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
          placeholder="Coordinate project work, delegate, ask for an update, or use @ to mention participants…"
          inputRef={inputRef}
          beforeInput={mentionMenuNode}
        />
      </ChannelShell>
    </div>
  )
}
