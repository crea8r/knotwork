import { useMemo, useState } from 'react'
import { GitBranch, MessageSquare, PlayCircle } from 'lucide-react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useChannelDecisions, useChannelMessages, usePostChannelMessage, useUpdateChannel } from '@/api/channels'
import { useGraphs } from '@/api/graphs'
import { ChannelContextPill, ChannelShell, ChannelTimeline, type ChannelTimelineItem } from '@/components/channel/ChannelFrame'
import WorkflowSlashComposer from '@/components/channel/WorkflowSlashComposer'
import Btn from '@/components/shared/Btn'
import { projectPath } from '@/lib/paths'
import type { ProjectOutletContext } from './ProjectDetailPage'

export default function ProjectChannelPage() {
  const { workspaceId, project, projectSlug, projectChannels } = useOutletContext<ProjectOutletContext>()
  const { channelSlug = '' } = useParams<{ channelSlug: string }>()
  const navigate = useNavigate()
  const item = projectChannels.find((channel) => channel.channel.slug === channelSlug)
  const { data: workflows = [] } = useGraphs(workspaceId)
  const { data: messages = [] } = useChannelMessages(workspaceId, channelSlug)
  const { data: decisions = [] } = useChannelDecisions(workspaceId, channelSlug)
  const postMessage = usePostChannelMessage(workspaceId, channelSlug)
  const updateChannel = useUpdateChannel(workspaceId, channelSlug)
  const [draft, setDraft] = useState('')

  const timeline = useMemo(() => {
    const msgItems = messages.map((message) => ({
      id: `m-${message.id}`,
      kind: 'message' as const,
      ts: new Date(message.created_at).getTime(),
      data: message,
    }))
    const decisionItems = decisions.map((decision) => ({
      id: `d-${decision.id}`,
      kind: 'decision' as const,
      ts: new Date(decision.created_at).getTime(),
      data: decision,
    }))
    return [...msgItems, ...decisionItems].sort((a, b) => a.ts - b.ts)
  }, [decisions, messages])
  const timelineItems = useMemo<ChannelTimelineItem[]>(() => timeline.map((entry) => {
    if (entry.kind === 'message') {
      return {
        id: entry.id,
        kind: 'message' as const,
        authorLabel: entry.data.author_name ?? (entry.data.author_type === 'human' ? 'You' : 'Agent'),
        mine: entry.data.role === 'user',
        tone: entry.data.author_type === 'system' ? 'system' : entry.data.author_type === 'human' ? 'human' : 'agent',
        content: entry.data.content,
      }
    }
    return {
      id: entry.id,
      kind: 'decision' as const,
      label: entry.data.decision_type.replace(/_/g, ' '),
      actorName: entry.data.actor_name,
    }
  }), [timeline])

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
          beforeInput={item.channel.channel_type === 'normal' ? (
            <p className="text-xs text-stone-500">
              Type <span className="font-mono text-stone-700">/</span> to start a workflow from this channel.
            </p>
          ) : null}
        />
      </ChannelShell>
    </div>
  )
}
