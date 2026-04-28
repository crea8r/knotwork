import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BookOpen, FileText, GitBranch, PlayCircle, Search, X } from 'lucide-react'
import {
  useAttachChannelAsset,
  useChannelAssets,
  useChannels,
  useDetachChannelAsset,
  useMyChannelSubscriptions,
  usePostChannelMessage,
  useUpdateMyChannelSubscription,
  useUpdateChannel,
} from '@modules/communication/frontend/api/channels'
import { useGraphs } from "@modules/workflows/frontend/api/graphs"
import { useKnowledgeFiles } from "@modules/assets/frontend/api/knowledge"
import { useObjectives, useProjects } from "@modules/projects/frontend/api/projects"
import { useRuns } from "@modules/workflows/frontend/api/runs"
import { renderShellHeaderIcon, type ShellHeaderIconKind } from '@app-shell/ShellHeaderMeta'
import { useRegisterShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
import {
  SHELL_RAIL_LEADING_ICON_CLASS,
  SHELL_RAIL_SUBTITLE_CLASS,
  SHELL_RAIL_TITLE_CLASS,
  SHELL_TEXT_BUTTON_CLASS,
} from '@app-shell/layoutChrome'
import { useAuthStore } from '@auth'
import { ChannelTimeline } from '@modules/communication/frontend/components/ChannelFrame'
import { ChannelParticipantSummary } from '@modules/communication/frontend/components/ChannelParticipantsPanel'
import WorkflowSlashComposer from '@modules/communication/frontend/components/WorkflowSlashComposer'
import { useChannelTimeline } from '@modules/communication/frontend/components/useChannelTimeline'
import { useMentionDetection } from '@modules/communication/frontend/components/useMentionDetection'
import Spinner from '@ui/components/Spinner'
import { workflowAssetLink, workflowAssetLinkForGraph } from '@modules/workflows/frontend/lib/workflowAssetLinks'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

type AssetType = 'workflow' | 'run' | 'file'
type ChannelAssetType = AssetType | 'folder'

function assetIcon(type: ChannelAssetType) {
  switch (type) {
    case 'workflow':
      return <GitBranch size={14} className="text-brand-600" />
    case 'run':
      return <PlayCircle size={14} className="text-indigo-600" />
    case 'file':
      return <FileText size={14} className="text-emerald-600" />
    case 'folder':
      return <BookOpen size={14} className="text-amber-600" />
  }
}

function channelIconKind(type: string | undefined): ShellHeaderIconKind {
  switch (type) {
    case 'objective':
      return 'objective'
    case 'run':
      return 'run'
    case 'workflow':
      return 'workflow'
    case 'knowledge':
    case 'handbook':
      return 'knowledge'
    case 'agent_main':
      return 'agent'
    default:
      return 'channel'
  }
}

function channelSubtitle(type: string | undefined, linkedProjectTitle?: string | null): string {
  if (linkedProjectTitle) return linkedProjectTitle
  switch (type) {
    case 'bulletin':
      return 'Bulletin'
    case 'objective':
      return 'Objective channel'
    case 'workflow':
      return 'Workflow channel'
    case 'knowledge':
    case 'handbook':
      return 'Knowledge channel'
    case 'run':
      return 'Run channel'
    case 'agent_main':
      return 'Agent channel'
    default:
      return 'Unified channel view'
  }
}

function assetHref(
  asset: { asset_type: ChannelAssetType; asset_id: string; path: string | null },
  workflowHref: string | null,
): string | null {
  switch (asset.asset_type) {
    case 'workflow':
      return workflowHref
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
  const graphById = useMemo(() => new Map(graphs.map((graph) => [graph.id, graph])), [graphs])
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
  const shellIconKind = channelIconKind(channel?.channel_type)
  const shellSubtitle = channelSubtitle(channel?.channel_type, linkedProject?.title)
  const shellLeading = useMemo(() => (
    <div data-ui="channels.detail.header.leading" className="flex min-w-0 items-center gap-3">
      <div data-ui="channels.detail.header.icon" className={SHELL_RAIL_LEADING_ICON_CLASS}>
        {renderShellHeaderIcon(shellIconKind)}
      </div>
      <div className="min-w-0">
        <p data-ui="channels.detail.header.title" className={SHELL_RAIL_TITLE_CLASS}>
          {channel?.name ?? 'Channel'}
        </p>
        <div data-ui="channels.detail.header.meta" className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
          <span data-ui="channels.detail.header.subtitle" className={SHELL_RAIL_SUBTITLE_CLASS}>
            {shellSubtitle}
          </span>
          {channel?.id ? (
            <ChannelParticipantSummary workspaceId={workspaceId} channelId={channel.id} />
          ) : null}
          {assets.length > 0 ? (
            <span
              data-ui="channels.detail.header.sources"
              className="inline-flex h-5 items-center rounded-full border border-stone-200 bg-stone-50 px-2 text-[11px] font-medium leading-4 text-stone-600"
            >
              {assets.length} {assets.length === 1 ? 'source' : 'sources'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  ), [assets.length, channel?.id, channel?.name, shellIconKind, shellSubtitle, workspaceId])
  const shellActions = useMemo(() => (
    <>
      {channel?.id ? (
        <button
          type="button"
          onClick={() => updateSubscription.mutate({ channelId: channel.id, subscribed: !isSubscribed })}
          data-ui="channels.detail.header.subscription"
          className={SHELL_TEXT_BUTTON_CLASS}
        >
          {isSubscribed ? 'Following' : 'Follow'}
        </button>
      ) : null}
      {isFreeChat ? (
        <button
          type="button"
          onClick={() => setAssetPickerOpen(true)}
          data-ui="channels.detail.header.add-source"
          className={SHELL_TEXT_BUTTON_CLASS}
        >
          Add source
        </button>
      ) : null}
      {channel?.channel_type === 'normal' && !channel.archived_at ? (
        <button
          type="button"
          onClick={() => {
            if (!channel) return
            if (!window.confirm(`Archive "${channel.name}"?`)) return
            updateChannel.mutate(
              { archived: true },
              { onSuccess: () => navigate('/channels', { replace: true }) },
            )
          }}
          data-ui="channels.detail.header.archive"
          className={SHELL_TEXT_BUTTON_CLASS}
        >
          Archive
        </button>
      ) : null}
    </>
  ), [channel, isFreeChat, isSubscribed, navigate, updateChannel, updateSubscription])

  useRegisterShellTopBarSlots({
    leading: shellLeading,
    actions: shellActions,
    snapshot: channel
      ? {
          title: channel.name,
          subtitle: shellSubtitle,
          iconKind: shellIconKind,
        }
      : null,
  })

  return (
    <div data-ui="channels.detail.page" className="flex h-full min-h-0 flex-col bg-white">
      {isFreeChat ? (
        <div data-ui="channels.detail.attachments" className="shrink-0 border-b border-stone-200 bg-white px-4 py-3">
          <div data-ui="channels.detail.attachments.header" className="min-w-0">
            <h2 className="text-sm font-semibold text-stone-900">Attached sources</h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Attach workflows, live runs, or files so updates land here automatically.
            </p>
          </div>

          {assets.length > 0 ? (
            <div data-ui="channels.detail.attachments.list" className="mt-3 flex flex-wrap gap-2">
              {assets.map((asset) => (
                (() => {
                  const workflow = asset.asset_type === 'workflow' ? (graphById.get(asset.asset_id) ?? null) : null
                  const href = assetHref(
                    asset,
                    workflow
                      ? workflowAssetLinkForGraph(workflow)
                      : (asset.asset_type === 'workflow' && asset.path
                          ? workflowAssetLink(asset.path, linkedProject?.slug ?? null)
                          : null),
                  )
                  return (
                    <div key={asset.id} data-ui="channels.detail.attachments.item" className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs text-stone-700">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-stone-200 bg-white flex-shrink-0">
                        {assetIcon(asset.asset_type)}
                      </span>
                      {href ? (
                        <Link
                          to={href}
                          className="truncate font-medium text-stone-800 hover:text-brand-700 hover:underline"
                        >
                          {asset.display_name}
                        </Link>
                      ) : (
                        <span className="truncate font-medium text-stone-800">{asset.display_name}</span>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          detachAsset.mutate(asset.id)
                        }}
                        data-ui="channels.detail.attachments.remove"
                        className="rounded-full p-0.5 text-stone-400 hover:text-stone-700 flex-shrink-0"
                        title="Remove asset"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })()
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div data-ui="channels.detail.timeline.loading" className="flex flex-1 items-center justify-center bg-[#faf7f1]"><Spinner size="lg" /></div>
      ) : (
        <ChannelTimeline items={timelineItems} highlightedItemId={highlightedItemId} />
      )}

      <WorkflowSlashComposer
        workspaceId={workspaceId}
        workflows={graphs}
        channelId={channelSlug}
        draft={draft}
        setDraft={setDraft}
        onSend={() => postMessage.mutate(
          { content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
          { onSuccess: () => setDraft('') },
        )}
        pending={postMessage.isPending}
        placeholder={channel?.channel_type === 'knowledge'
          ? 'Ask the assistant to propose knowledge edits. Type @ to mention people…'
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

      {assetPickerOpen && (
        <div data-ui="channels.detail.asset-picker" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div data-ui="channels.detail.asset-picker.panel" className="w-full max-w-2xl rounded-[28px] border border-gray-200 bg-white shadow-2xl">
            <div data-ui="channels.detail.asset-picker.header" className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
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
                data-ui="channels.detail.asset-picker.close"
                className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:text-gray-700"
              >
                <X size={16} />
              </button>
            </div>

            <div data-ui="channels.detail.asset-picker.body" className="p-5 space-y-4">
              <div data-ui="channels.detail.asset-picker.search" className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                  placeholder="Search by name, path, status, or type…"
                  data-ui="channels.detail.asset-picker.search.input"
                  className="w-full rounded-2xl border border-gray-300 bg-white py-3 pl-10 pr-4 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div data-ui="channels.detail.asset-picker.results" className="max-h-[420px] overflow-y-auto space-y-2">
                {assetSearchResults.length === 0 ? (
                  <div data-ui="channels.detail.asset-picker.empty" className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                    No assets match your search.
                  </div>
                ) : (
                  assetSearchResults.map((item) => (
                    <button
                      key={`${item.asset_type}:${item.asset_id}`}
                      type="button"
                      onClick={() => handleAttachAsset(item.asset_type, item.asset_id)}
                      data-ui="channels.detail.asset-picker.result"
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
