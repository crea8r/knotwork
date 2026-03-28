import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bot, BookOpen, FileText, GitBranch, MessageSquare, PlayCircle, Plus, Search, X } from 'lucide-react'
import {
  useAttachChannelAsset,
  useChannelAssets,
  useChannelDecisions,
  useChannelMessages,
  useChannelParticipants,
  useChannels,
  useDetachChannelAsset,
  useMyChannelSubscriptions,
  usePostChannelMessage,
  useUpdateMyChannelSubscription,
  useUpdateChannel,
} from '@/api/channels'
import { useGraphs } from '@/api/graphs'
import { useKnowledgeFiles } from '@/api/knowledge'
import { useRuns } from '@/api/runs'
import { useAuthStore } from '@/store/auth'
import { ChannelContextPill, ChannelShell, ChannelTimeline, type ChannelTimelineItem } from '@/components/channel/ChannelFrame'
import WorkflowSlashComposer from '@/components/channel/WorkflowSlashComposer'
import Btn from '@/components/shared/Btn'
import Spinner from '@/components/shared/Spinner'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

type AssetType = 'workflow' | 'run' | 'file'

function decisionLabel(kind: string): string {
  switch (kind) {
    case 'approved':
    case 'accept_output':
      return 'Accepted output'
    case 'edited':
    case 'override_output':
      return 'Overrode with human output'
    case 'guided':
    case 'request_revision':
      return 'Requested revision'
    case 'aborted':
    case 'abort_run':
      return 'Aborted run'
    default:
      return kind.replace(/_/g, ' ')
  }
}

function assetIcon(type: AssetType) {
  switch (type) {
    case 'workflow':
      return <GitBranch size={14} className="text-brand-600" />
    case 'run':
      return <PlayCircle size={14} className="text-indigo-600" />
    case 'file':
      return <FileText size={14} className="text-emerald-600" />
  }
}

function channelTypeIcon(type: string | undefined) {
  switch (type) {
    case 'project':
      return <MessageSquare size={14} />
    case 'objective':
      return <MessageSquare size={14} />
    case 'run':
      return <PlayCircle size={14} />
    case 'workflow':
      return <GitBranch size={14} />
    case 'handbook':
      return <BookOpen size={14} />
    case 'agent_main':
      return <Bot size={14} />
    default:
      return <MessageSquare size={14} />
  }
}

export default function ChannelDetailPage() {
  const { channelSlug } = useParams<{ channelSlug: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const { data: channels = [] } = useChannels(workspaceId)
  const { data: participants = [] } = useChannelParticipants(workspaceId)
  const { data: subscriptions = [] } = useMyChannelSubscriptions(workspaceId)
  const { data: messages = [], isLoading: messagesLoading } = useChannelMessages(workspaceId, channelSlug ?? '')
  const { data: decisions = [], isLoading: decisionsLoading } = useChannelDecisions(workspaceId, channelSlug ?? '')
  const { data: assets = [] } = useChannelAssets(workspaceId, channelSlug ?? '')
  const { data: graphs = [] } = useGraphs(workspaceId)
  const { data: runs = [] } = useRuns(workspaceId)
  const { data: files = [] } = useKnowledgeFiles()
  const postMessage = usePostChannelMessage(workspaceId, channelSlug ?? '')
  const updateSubscription = useUpdateMyChannelSubscription(workspaceId)
  const updateChannel = useUpdateChannel(workspaceId, channelSlug ?? '')
  const attachAsset = useAttachChannelAsset(workspaceId, channelSlug ?? '')
  const detachAsset = useDetachChannelAsset(workspaceId, channelSlug ?? '')

  const [draft, setDraft] = useState('')
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [assetQuery, setAssetQuery] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const channel = channels.find((c) => c.slug === channelSlug)
  const isSubscribed = subscriptions.find((row) => row.channel_id === channel?.id)?.subscribed ?? true
  const isFreeChat = channel?.channel_type === 'normal'

  const activeMention = useMemo(() => {
    const cursor = inputRef.current?.selectionStart ?? draft.length
    const beforeCursor = draft.slice(0, cursor)
    const match = beforeCursor.match(/(^|\s)@([A-Za-z0-9._-]*)$/)
    if (!match || match.index == null) return null
    const query = match[2] ?? ''
    const start = match.index + match[1].length
    return { query: query.toLowerCase(), start, end: cursor }
  }, [draft])

  const mentionSuggestions = useMemo(() => {
    if (!activeMention) return []
    return participants
      .filter((participant) => participant.mention_handle)
      .filter((participant) => {
        const handle = (participant.mention_handle ?? '').toLowerCase()
        const name = participant.display_name.toLowerCase()
        return !activeMention.query || handle.includes(activeMention.query) || name.includes(activeMention.query)
      })
      .slice(0, 6)
  }, [activeMention, participants])

  const attachableWorkflows = useMemo(() => {
    const attachedIds = new Set(assets.filter((asset) => asset.asset_type === 'workflow').map((asset) => asset.asset_id))
    return graphs.filter((graph) => graph.status !== 'archived' && !attachedIds.has(graph.id))
  }, [assets, graphs])

  const attachableRuns = useMemo(() => {
    const attachedIds = new Set(assets.filter((asset) => asset.asset_type === 'run').map((asset) => asset.asset_id))
    return runs.filter((run) => !attachedIds.has(run.id) && !['completed', 'failed', 'stopped'].includes(run.status))
  }, [assets, runs])

  const attachableFiles = useMemo(() => {
    const attachedIds = new Set(assets.filter((asset) => asset.asset_type === 'file').map((asset) => asset.asset_id))
    return files.filter((file) => !attachedIds.has(file.id))
  }, [assets, files])

  const assetSearchResults = useMemo(() => {
    const items = [
      ...attachableWorkflows.map((graph) => ({
        asset_type: 'workflow' as const,
        asset_id: graph.id,
        title: graph.name,
        meta: graph.path || 'Workflow',
      })),
      ...attachableRuns.map((run) => ({
        asset_type: 'run' as const,
        asset_id: run.id,
        title: run.name?.trim() || `Run ${run.id.slice(0, 8)}`,
        meta: run.status,
      })),
      ...attachableFiles.map((file) => ({
        asset_type: 'file' as const,
        asset_id: file.id,
        title: file.title || file.path,
        meta: file.path,
      })),
    ]
    const q = assetQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => `${item.title} ${item.meta} ${item.asset_type}`.toLowerCase().includes(q))
  }, [assetQuery, attachableFiles, attachableRuns, attachableWorkflows])

  function handleAttachAsset(assetType: AssetType, assetId: string) {
    attachAsset.mutate(
      { asset_type: assetType, asset_id: assetId },
      {
        onSuccess: () => {
          setAssetPickerOpen(false)
          setAssetQuery('')
        },
      },
    )
  }

  function insertMention(mentionHandle: string) {
    if (!activeMention) return
    const next = `${draft.slice(0, activeMention.start)}@${mentionHandle} ${draft.slice(activeMention.end)}`
    setDraft(next)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const pos = activeMention.start + mentionHandle.length + 2
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const timeline = useMemo(() => {
    const msgItems = messages.map((m) => ({
      id: `m-${m.id}`,
      kind: 'message' as const,
      ts: new Date(m.created_at).getTime(),
      data: m,
    }))
    const decItems = decisions.map((d) => ({
      id: `d-${d.id}`,
      kind: 'decision' as const,
      ts: new Date(d.created_at).getTime(),
      data: d,
    }))
    return [...msgItems, ...decItems].sort((a, b) => a.ts - b.ts)
  }, [messages, decisions])
  const timelineItems = useMemo<ChannelTimelineItem[]>(() => timeline.map((item) => {
    if (item.kind === 'message') {
      const message = item.data
      return {
        id: item.id,
        kind: 'message' as const,
        authorLabel: message.author_name ?? (message.author_type === 'human' ? 'You' : 'Agent'),
        mine: message.role === 'user',
        tone: message.author_type === 'system' ? 'system' : message.author_type === 'human' ? 'human' : 'agent',
        content: message.content,
      }
    }
    return {
      id: item.id,
      kind: 'decision' as const,
      label: decisionLabel(item.data.decision_type),
      actorName: item.data.actor_name,
    }
  }), [timeline])

  const loading = messagesLoading || decisionsLoading

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto h-full flex flex-col min-h-0 w-full">
      <div className="mb-4 space-y-3">
        <div>
          <Link to="/channels" className="text-xs text-gray-500 hover:text-gray-700">Channels</Link>
          <div className="mt-1 flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-gray-900">{channel?.name ?? 'Channel'}</h1>
            {channel?.id && (
              <button
                type="button"
                onClick={() => updateSubscription.mutate({ channelId: channel.id, subscribed: !isSubscribed })}
                className={`rounded-lg border px-3 py-1.5 text-sm ${isSubscribed ? 'border-gray-200 text-gray-700' : 'border-brand-200 text-brand-700 bg-brand-50'}`}
              >
                {isSubscribed ? 'Following' : 'Unfollowed'}
              </button>
            )}
          </div>
        </div>

        {isFreeChat && (
          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900">Attached sources</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  Attach workflows, live runs, or files so updates land here automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssetPickerOpen(true)}
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-brand-300 hover:text-brand-700"
                title="Add source"
                aria-label="Add source"
              >
                <Plus size={14} />
              </button>
            </div>

            {assets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {assets.map((asset) => (
                  <div key={asset.id} className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white border border-gray-200 flex-shrink-0">
                      {assetIcon(asset.asset_type)}
                    </span>
                    <span className="truncate font-medium text-gray-800">{asset.display_name}</span>
                    <button
                      type="button"
                      onClick={() => detachAsset.mutate(asset.id)}
                      className="rounded-full p-0.5 text-gray-400 hover:text-gray-700 flex-shrink-0"
                      title="Remove asset"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ChannelShell
        title={channel?.name ?? 'Channel'}
        typeIcon={channelTypeIcon(channel?.channel_type)}
        parentLabel="Unified channel view"
        onRenameTitle={async (value) => {
          const next = await updateChannel.mutateAsync({ name: value })
          if (next.channel_type === 'normal' && next.slug !== channelSlug) {
            navigate(`/channels/${next.slug}`, { replace: true })
          }
        }}
        renamePending={updateChannel.isPending}
        actions={channel?.channel_type === 'normal' && !channel.archived_at ? (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!channel) return
              if (!window.confirm(`Archive "${channel.name}"?`)) return
              updateChannel.mutate(
                { archived: true },
                { onSuccess: () => navigate('/channels', { replace: true }) },
              )
            }}
          >
            Archive
          </Btn>
        ) : null}
        status={channel?.id ? (
          <button
            type="button"
            onClick={() => updateSubscription.mutate({ channelId: channel.id, subscribed: !isSubscribed })}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${isSubscribed ? 'border-gray-200 text-gray-600' : 'border-brand-200 text-brand-700 bg-brand-50'}`}
          >
            {isSubscribed ? 'Following' : 'Unfollowed'}
          </button>
        ) : null}
        context={(
          <>
            {assets.slice(0, 3).map((asset) => (
              <ChannelContextPill key={asset.id}>{asset.display_name}</ChannelContextPill>
            ))}
          </>
        )}
      >
        {loading ? (
          <div className="flex flex-1 items-center justify-center bg-[#faf7f1]"><Spinner size="lg" /></div>
        ) : (
          <ChannelTimeline items={timelineItems} />
        )}

        <div className="border-t border-gray-200 bg-white p-3 space-y-2">
          <WorkflowSlashComposer
            workspaceId={workspaceId}
            workflows={graphs}
            channelId={channelSlug}
            draft={draft}
            setDraft={setDraft}
            onSend={() => postMessage.mutate({ content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' }, { onSuccess: () => setDraft('') })}
            pending={postMessage.isPending}
            placeholder={channel?.channel_type === 'handbook'
              ? 'Ask the assistant to propose handbook edits. Type @ to mention people…'
              : 'Type a message. Use @ to mention participants…'}
            inputRef={inputRef}
            beforeInput={(
              <>
                {channel?.channel_type === 'normal' ? (
                  <p className="text-xs text-stone-500">
                    Type <span className="font-mono text-stone-700">/</span> to start a workflow from this channel.
                  </p>
                ) : null}
                {mentionSuggestions.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {mentionSuggestions.map((participant) => (
                      <button
                        key={participant.participant_id}
                        type="button"
                        onClick={() => insertMention(participant.mention_handle ?? '')}
                        className="w-full border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50 last:border-b-0"
                      >
                        <div className="text-sm text-gray-800">{participant.display_name}</div>
                        <div className="text-xs text-gray-500">
                          @{participant.mention_handle}
                          {participant.email ? ` · ${participant.email}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          />
        </div>
      </ChannelShell>

      {assetPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-[28px] border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Attach asset</p>
                <h2 className="mt-1 text-base font-semibold text-gray-900">Search workflows, runs, and files</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAssetPickerOpen(false)
                  setAssetQuery('')
                }}
                className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:text-gray-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                  placeholder="Search by name, path, status, or type…"
                  className="w-full rounded-2xl border border-gray-300 bg-white py-3 pl-10 pr-4 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="max-h-[420px] overflow-y-auto space-y-2">
                {assetSearchResults.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-10 text-center">
                    <p className="text-sm font-medium text-gray-700">No matching assets</p>
                    <p className="mt-1 text-sm text-gray-500">Try another term or create the asset first.</p>
                  </div>
                ) : (
                  assetSearchResults.map((item) => (
                    <button
                      key={`${item.asset_type}:${item.asset_id}`}
                      type="button"
                      onClick={() => handleAttachAsset(item.asset_type, item.asset_id)}
                      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                          {assetIcon(item.asset_type)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                          <p className="mt-1 truncate text-xs text-gray-500">{item.meta}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-600">
                        {item.asset_type}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
