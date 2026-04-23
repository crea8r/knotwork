import { useMemo, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { usePostChannelMessage, useUpdateChannel } from '@modules/communication/frontend/api/channels'
import { useGraphs } from "@modules/workflows/frontend/api/graphs"
import { ChannelTimeline } from '@modules/communication/frontend/components/ChannelFrame'
import { ChannelParticipantSummary } from '@modules/communication/frontend/components/ChannelParticipantsPanel'
import WorkflowSlashComposer from '@modules/communication/frontend/components/WorkflowSlashComposer'
import { useChannelTimeline } from '@modules/communication/frontend/components/useChannelTimeline'
import { useMentionDetection } from '@modules/communication/frontend/components/useMentionDetection'
import { renderShellHeaderIcon, type ShellHeaderIconKind } from '@app-shell/ShellHeaderMeta'
import { useRegisterShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
import {
  SHELL_RAIL_LEADING_ICON_CLASS,
  SHELL_RAIL_SUBTITLE_CLASS,
  SHELL_RAIL_TITLE_CLASS,
  SHELL_TEXT_BUTTON_CLASS,
} from '@app-shell/layoutChrome'
import type { ProjectOutletContext } from './ProjectDetailPage'

export default function ProjectChannelPage() {
  const { workspaceId, project, projectChannels } = useOutletContext<ProjectOutletContext>()
  const { channelSlug = '' } = useParams<{ channelSlug: string }>()
  const item = projectChannels.find((channel) => channel.channel.slug === channelSlug)
  const { data: workflows = [] } = useGraphs(workspaceId)
  const postMessage = usePostChannelMessage(workspaceId, channelSlug)
  const updateChannel = useUpdateChannel(workspaceId, channelSlug)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const { items: timelineItems } = useChannelTimeline(workspaceId, channelSlug)
  const { mentionMenuNode } = useMentionDetection(workspaceId, draft, setDraft, inputRef)

  if (!item) {
    return <div className="p-8 text-sm text-stone-500">Channel not found in this project.</div>
  }

  const channelIconKind: ShellHeaderIconKind = item.channel.channel_type === 'run'
    ? 'run'
    : item.channel.channel_type === 'workflow'
      ? 'workflow'
      : 'channel'
  const shellLeading = useMemo(() => (
    <div data-ui="projects.channel.header.leading" className="flex min-w-0 items-center gap-3">
      <div data-ui="projects.channel.header.icon" className={SHELL_RAIL_LEADING_ICON_CLASS}>
        {renderShellHeaderIcon(channelIconKind)}
      </div>
      <div className="min-w-0">
        <p data-ui="projects.channel.header.title" className={SHELL_RAIL_TITLE_CLASS}>
          {item.label}
        </p>
        <div data-ui="projects.channel.header.meta" className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
          <span data-ui="projects.channel.header.subtitle" className={SHELL_RAIL_SUBTITLE_CLASS}>
            {project.title}
          </span>
          <ChannelParticipantSummary workspaceId={workspaceId} channelId={item.channel.id} />
          {item.channel.graph_id ? (
            <span
              data-ui="projects.channel.header.workflow"
              className="inline-flex h-5 items-center rounded-full border border-stone-200 bg-stone-50 px-2 text-[11px] font-medium leading-4 text-stone-600"
            >
              Linked workflow
            </span>
          ) : null}
        </div>
      </div>
    </div>
  ), [channelIconKind, item.channel.graph_id, item.channel.id, item.label, project.title, workspaceId])
  const shellActions = item.channel.channel_type === 'normal' && !item.channel.archived_at ? (
    <button
      type="button"
      onClick={() => {
        if (!window.confirm(`Archive "${item.label}"?`)) return
        updateChannel.mutate({ archived: true })
      }}
      data-ui="projects.channel.header.archive"
      className={SHELL_TEXT_BUTTON_CLASS}
    >
      Archive
    </button>
  ) : null

  useRegisterShellTopBarSlots({
    leading: shellLeading,
    actions: shellActions,
    snapshot: {
      title: item.label,
      subtitle: project.title,
      iconKind: channelIconKind,
    },
  })

  return (
    <div data-ui="projects.channel.page" className="flex h-full min-h-0 flex-col bg-white">
      <ChannelTimeline items={timelineItems} />
      <WorkflowSlashComposer
        workspaceId={workspaceId}
        workflows={workflows}
        channelId={channelSlug}
        draft={draft}
        setDraft={setDraft}
        onSend={() => postMessage.mutate(
          { content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
          { onSuccess: () => setDraft('') },
        )}
        pending={postMessage.isPending}
        placeholder="Continue the thread without leaving project context…"
        inputRef={inputRef}
        beforeInput={(
          <>
            {item.channel.channel_type === 'normal' ? (
              <p className="text-xs text-stone-500">
                Type <span className="font-mono text-stone-700">/</span> to start a workflow from this channel.
              </p>
            ) : null}
            {mentionMenuNode}
          </>
        )}
      />
    </div>
  )
}
