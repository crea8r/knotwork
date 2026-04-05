import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bot, BookOpen, FileText, GitBranch, MessageSquare, PlayCircle, Plus, Search, X } from 'lucide-react'
import {
  useAttachChannelAsset,
  useChannelAssets,
  useChannels,
  useDetachChannelAsset,
  useMyChannelSubscriptions,
  usePostChannelMessage,
  useUpdateMyChannelSubscription,
  useUpdateChannel,
} from '@/api/channels'
import { useGraphs } from '@/api/graphs'
import { useKnowledgeFiles } from '@/api/knowledge'
import { useObjectives, useProjects } from '@/api/projects'
import { useRuns } from '@/api/runs'
import { projectPath } from '@/lib/paths'
import { useAuthStore } from '@/store/auth'
import { ChannelContextPill, ChannelShell, ChannelTimeline } from '@/components/channel/ChannelFrame'
import WorkflowSlashComposer from '@/components/channel/WorkflowSlashComposer'
import { useChannelTimeline } from '@/components/channel/useChannelTimeline'
import { useMentionDetection } from '@/components/channel/useMentionDetection'
import Btn from '@/components/shared/Btn'
import Spinner from '@/components/shared/Spinner'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

type AssetType = 'workflow' | 'run' | 'file'

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

function assetHref(asset: { asset_type: AssetType | 'folder'; asset_id: string; path: string | null }): string | null {
  switch (asset.asset_type) {
    case 'workflow':
      return `/graphs/${asset.asset_id}`
    case 'run':
      return `/runs/${asset.asset_id}`
    case 'file':
      return asset.path ? `/knowledge?path=${encodeURIComponent(asset.path)}` : null
    default:
      return asset.path ? `/knowledge?folder=${encodeURIComponent(asset.path)}` : null
  }
}

export default function ChannelDetailPage() {
  const { channelSlug } = useParams<{ channelSlug: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const { data: channels = [] } = useChannels(workspaceId)
  const { data: subscriptions = [] } = useMyChannelSubscriptions(workspaceId)
  const { data: objectives = [] } = useObjectives(workspaceId)
  const { data: projects = [] } = useProjects(workspaceId)
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
  const channel = channels.find((c) => c.slug === channelSlug || c.id === channelSlug)
  const linkedObjective = useMemo(
    () => objectives.find((objective) => objective.channel_id === channel?.id) ?? null,
    [channel?.id, objectives],
  )
  const linkedProject = useMemo(() => {
    const projectId = linkedObjective?.project_id ?? channel?.project_id ?? null
    return projects.find((project) => project.id === projectId) ?? null
  }, [channel?.project_id, linkedObjective?.project_id, projects])
  const isSubscribed = subscriptions.find((row) => row.channel_id === channel?.id)?.subscribed ?? true
  const isFreeChat = channel?.channel_type === 'normal'

  const { mentionMenuNode } = useMentionDetection(workspaceId, draft, setDraft, inputRef)

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

  const { items: timelineItems, isLoading: loading } = useChannelTimeline(workspaceId, channelSlug ?? '')
  const highlightedItemId = useMemo(() => {
    const messageId = searchParams.get('message')
    return messageId ? `m-${messageId}` : null
  }, [searchParams])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto h-full flex flex-col min-h-0 w-full">
      <div className="mb-4 space-y-3">
        <div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Link to="/channels" className="hover:text-gray-700">Channels</Link>
            <span>/</span>
            {linkedProject?.slug ? (
              <Link
                to={projectPath(linkedProject.slug)}
                className="hover:text-gray-700"
              >
                {linkedProject.title}
              </Link>
            ) : (
              <span>
                {channel?.channel_type === 'bulletin'
                  ? 'Bulletin'
                  : channel?.channel_type === 'workflow'
                    ? 'Workflows'
                    : channel?.channel_type === 'handbook'
                      ? 'Handbook'
                      : channel?.channel_type === 'run'
                        ? 'Runs'
                        : 'Channels'}
              </span>
            )}
            <span>/</span>
            <span className="truncate">{channel?.name ?? 'Channel'}</span>
          </div>
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
                    {assetHref(asset) ? (
                      <Link
                        to={assetHref(asset)!}
                        className="truncate font-medium text-gray-800 hover:text-brand-700 hover:underline"
                      >
                        {asset.display_name}
                      </Link>
                    ) : (
                      <span className="truncate font-medium text-gray-800">{asset.display_name}</span>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        detachAsset.mutate(asset.id)
                      }}
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
          if ((next.channel_type === 'normal' || next.channel_type === 'bulletin') && next.slug !== channelSlug) {
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
          <ChannelTimeline items={timelineItems} highlightedItemId={highlightedItemId} />
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
                {mentionMenuNode}
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
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                    No assets match your search.
                  </div>
                ) : (
                  assetSearchResults.map((item) => (
                    <button
                      key={`${item.asset_type}:${item.asset_id}`}
                      type="button"
                      onClick={() => handleAttachAsset(item.asset_type, item.asset_id)}
                      className="flex w-full items-start justify-between rounded-2xl border border-gray-200 px-4 py-3 text-left hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white">
                            {assetIcon(item.asset_type)}
                          </span>
                          <span className="truncate">{item.title}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-gray-500">{item.meta}</p>
                      </div>
                      <span className="ml-3 rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
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
