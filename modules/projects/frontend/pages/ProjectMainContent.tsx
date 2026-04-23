import { useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { usePostChannelMessage } from '@modules/communication/frontend/api/channels'
import { useGraphs } from "@modules/workflows/frontend/api/graphs"
import { useUpdateProject } from "@modules/projects/frontend/api/projects"
import { ChannelTimeline } from '@modules/communication/frontend/components/ChannelFrame'
import { ChannelParticipantSummary } from '@modules/communication/frontend/components/ChannelParticipantsPanel'
import WorkflowSlashComposer from '@modules/communication/frontend/components/WorkflowSlashComposer'
import { useMentionDetection } from '@modules/communication/frontend/components/useMentionDetection'
import { useChannelTimeline } from '@modules/communication/frontend/components/useChannelTimeline'
import ProjectDashboard from '@modules/projects/frontend/components/ProjectDashboard'
import { workflowAssetLinkForGraph } from '@modules/workflows/frontend/lib/workflowAssetLinks'
import { projectChannelPath, projectObjectivePath } from '@app-shell/paths'
import { renderShellHeaderIcon } from '@app-shell/ShellHeaderMeta'
import { useRegisterShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
import {
  SHELL_RAIL_LEADING_ICON_CLASS,
  SHELL_RAIL_SUBTITLE_CLASS,
  SHELL_RAIL_TITLE_CLASS,
  SHELL_TEXT_BUTTON_CLASS,
} from '@app-shell/layoutChrome'
import { readNamespacedStorage, removeNamespacedStorage, writeNamespacedStorage } from '@storage'
import type { ProjectOutletContext } from './ProjectDetailPage'

const PINNED_PROJECT_STORAGE_KEY = 'pinned-project'

export default function ProjectMainContent() {
  const { workspaceId, projectId, project, objectives, recentRuns, projectChannels, onNewObjective, onUpdateStatus } = useOutletContext<ProjectOutletContext>()
  const navigate = useNavigate()
  const [projectChatDraft, setProjectChatDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(
    () => readNamespacedStorage(PINNED_PROJECT_STORAGE_KEY, ['kw-pinned-project']),
  )

  const projectChannelId = project.project_channel_id ?? null
  const { data: workflows = [] } = useGraphs(workspaceId)
  const workflowById = useMemo(() => new Map(workflows.map((workflow) => [workflow.id, workflow])), [workflows])
  const { items: timelineItems } = useChannelTimeline(workspaceId, projectChannelId ?? '')
  const postProjectMessage = usePostChannelMessage(workspaceId, projectChannelId ?? '')
  const updateProject = useUpdateProject(workspaceId, projectId)
  const { mentionMenuNode } = useMentionDetection(workspaceId, projectChatDraft, setProjectChatDraft, inputRef)
  const shellLeading = useMemo(() => (
    <div data-ui="projects.overview.header.leading" className="flex min-w-0 items-center gap-3">
      <div data-ui="projects.overview.header.icon" className={SHELL_RAIL_LEADING_ICON_CLASS}>
        {renderShellHeaderIcon('project')}
      </div>
      <div className="min-w-0">
        <p data-ui="projects.overview.header.title" className={SHELL_RAIL_TITLE_CLASS}>
          {project.title}
        </p>
        <div data-ui="projects.overview.header.meta" className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
          <span data-ui="projects.overview.header.subtitle" className={SHELL_RAIL_SUBTITLE_CLASS}>
            Project overview
          </span>
          {projectChannelId ? (
            <ChannelParticipantSummary workspaceId={workspaceId} channelId={projectChannelId} />
          ) : null}
        </div>
      </div>
    </div>
  ), [project.title, projectChannelId, workspaceId])
  const shellActions = useMemo(() => (
    <button
      type="button"
      onClick={async () => {
        const nextTitle = window.prompt('Rename project', project.title)?.trim()
        if (!nextTitle || nextTitle === project.title) return
        await updateProject.mutateAsync({ title: nextTitle })
      }}
      data-ui="projects.overview.header.rename"
      className={SHELL_TEXT_BUTTON_CLASS}
    >
      Rename
    </button>
  ), [project.title, updateProject])

  useRegisterShellTopBarSlots({
    leading: shellLeading,
    actions: shellActions,
    snapshot: {
      title: project.title,
      subtitle: 'Project overview',
      iconKind: 'project',
    },
  })

  function togglePinProject() {
    const next = pinnedProjectId === projectId ? null : projectId
    setPinnedProjectId(next)
    if (next) {
      writeNamespacedStorage(PINNED_PROJECT_STORAGE_KEY, next, ['kw-pinned-project'])
    } else {
      removeNamespacedStorage(PINNED_PROJECT_STORAGE_KEY, ['kw-pinned-project'])
    }
    window.dispatchEvent(new CustomEvent('kw:pinned-project-changed', { detail: { projectId: next } }))
  }

  return (
    <div data-ui="projects.overview.page" className="flex h-full min-h-0 flex-col bg-white">
      <div data-ui="projects.overview.dashboard" className="shrink-0">
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
                ? (
                  workflowById.get(channel.channel.graph_id)
                    ? workflowAssetLinkForGraph(workflowById.get(channel.channel.graph_id)!, { assetChat: true })
                    : projectChannelPath(project.slug, channel.channel.slug)
                )
              : projectChannelPath(project.slug, channel.channel.slug),
          )}
          onUpdateStatus={onUpdateStatus}
          onNewObjective={onNewObjective}
          pinned={pinnedProjectId === projectId}
          onTogglePin={togglePinProject}
        />
      </div>
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
    </div>
  )
}
