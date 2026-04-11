import { useRef, useState } from 'react'
import { GitBranch, MessageSquare, PlayCircle } from 'lucide-react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { usePostChannelMessage, useUpdateChannel } from '@modules/communication/frontend/api/channels'
import { useGraphs } from "@modules/workflows/frontend/api/graphs"
import { ChannelContextPill, ChannelShell, ChannelTimeline } from '@modules/communication/frontend/components/ChannelFrame'
import ChannelParticipantsPanel from '@modules/communication/frontend/components/ChannelParticipantsPanel'
import WorkflowSlashComposer from '@modules/communication/frontend/components/WorkflowSlashComposer'
import { useChannelTimeline } from '@modules/communication/frontend/components/useChannelTimeline'
import { useMentionDetection } from '@modules/communication/frontend/components/useMentionDetection'
import Btn from '@ui/components/Btn'
import { projectPath } from '@app-shell/paths'
import type { ProjectOutletContext } from './ProjectDetailPage'

export default function ProjectChannelPage() {
  const { workspaceId, project, projectSlug, projectChannels } = useOutletContext<ProjectOutletContext>()
  const { channelSlug = '' } = useParams<{ channelSlug: string }>()
  const navigate = useNavigate()
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

  const channelTypeIcon = item.channel.channel_type === 'run'
    ? <PlayCircle size={14} />
    : item.channel.channel_type === 'workflow'
      ? <GitBranch size={14} />
      : <MessageSquare size={14} />

  return (
    <div className="h-full min-h-0 p-4 md:p-6">
      <ChannelShell
        title={item.label}
        typeIcon={channelTypeIcon}
        parentLabel={project.title}
        onRenameTitle={async (value) => {
          const next = await updateChannel.mutateAsync({ name: value })
          if (next.channel_type === 'normal' && next.slug !== channelSlug) {
            navigate(`/projects/${projectSlug}/channels/${next.slug}`, { replace: true })
          }
        }}
        renamePending={updateChannel.isPending}
        actions={(
          <div className="flex items-center gap-2">
            {item.channel.channel_type === 'normal' && !item.channel.archived_at ? (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!window.confirm(`Archive "${item.label}"?`)) return
                  updateChannel.mutate(
                    { archived: true },
                    { onSuccess: () => navigate(projectPath(projectSlug), { replace: true }) },
                  )
                }}
              >
                Archive
              </Btn>
            ) : null}
            <Link to={projectPath(projectSlug)} className="text-xs text-stone-500 hover:text-stone-700">
              Back to project
            </Link>
          </div>
        )}
        context={(
          <>
            <ChannelParticipantsPanel workspaceId={workspaceId} channelId={item.channel.id} />
            {item.channel.graph_id ? <ChannelContextPill>Linked workflow</ChannelContextPill> : null}
          </>
        )}
      >
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
      </ChannelShell>
    </div>
  )
}
