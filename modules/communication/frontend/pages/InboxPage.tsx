import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Archive, ArchiveRestore, AtSign, CheckCheck, Clock3, FilePenLine, PlayCircle } from 'lucide-react'
import { useInbox, useInboxSummary, useMarkAllInboxRead, useUpdateInboxDelivery } from '@modules/communication/frontend/api/channels'
import { SHELL_RAIL_TITLE_CLASS } from '@app-shell/layoutChrome'
import { useRegisterShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
import { useAuthStore } from '@auth'
import Spinner from '@ui/components/Spinner'
import EmptyState from '@ui/components/EmptyState'
import { workflowAssetLink } from '@modules/workflows/frontend/lib/workflowAssetLinks'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

function inboxTarget(item: import('@data-models').InboxItem) {
  if ((item.item_type === 'mentioned_message' || item.item_type === 'task_assigned' || item.item_type === 'message_posted') && item.run_id) {
    return `/runs/${item.run_id}`
  }
  if (item.asset_type === 'workflow' && item.asset_id) {
    if (item.asset_path) {
      return workflowAssetLink(item.asset_path, item.asset_project_slug, { assetChat: true })
    }
    if (item.channel_id) {
      return `/channels/${item.channel_id}${item.message_id ? `?message=${encodeURIComponent(item.message_id)}` : ''}`
    }
  }
  if ((item.asset_type === 'file' || item.asset_type === 'folder') && item.asset_path !== null) {
    const params = new URLSearchParams()
    if (item.asset_type === 'file') params.set('path', item.asset_path)
    else params.set('folder', item.asset_path)
    if (item.message_id) params.set('message', item.message_id)
    if (item.asset_project_slug) {
      return `/projects/${item.asset_project_slug}/assets?${params.toString()}`
    }
    return `/knowledge?${params.toString()}`
  }
  if (item.item_type === 'escalation' || item.item_type === 'run_event') {
    return `/runs/${item.run_id}`
  }
  if (item.item_type === 'mentioned_message' || item.item_type === 'task_assigned' || item.item_type === 'message_posted' || item.item_type === 'knowledge_change') {
    if (item.channel_id) {
      return `/channels/${item.channel_id}${item.message_id ? `?message=${encodeURIComponent(item.message_id)}` : ''}`
    }
    if (item.run_id) return `/runs/${item.run_id}`
    return '/channels'
  }
  return '/runs'
}

function InboxFilters({
  archived,
  activeCount,
  archivedCount,
  onShowActive,
  onShowArchived,
  uiName = 'inbox.filters',
}: {
  archived: boolean
  activeCount?: number
  archivedCount?: number
  onShowActive: () => void
  onShowArchived: () => void
  uiName?: string
}) {
  return (
    <div data-ui={uiName} className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
      <button
        onClick={onShowActive}
        data-ui={`${uiName}.active`}
        className={`px-3 py-1.5 text-sm rounded-lg ${!archived ? 'bg-brand-50 text-brand-700' : 'text-gray-500'}`}
      >
        Active {typeof activeCount === 'number' ? `(${activeCount})` : ''}
      </button>
      <button
        onClick={onShowArchived}
        data-ui={`${uiName}.archived`}
        className={`px-3 py-1.5 text-sm rounded-lg ${archived ? 'bg-brand-50 text-brand-700' : 'text-gray-500'}`}
      >
        Archived {typeof archivedCount === 'number' ? `(${archivedCount})` : ''}
      </button>
    </div>
  )
}

function InboxReadAllButton({
  pending,
  onClick,
  uiName = 'inbox.read-all',
}: {
  pending: boolean
  onClick: () => void
  uiName?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      data-ui={uiName}
      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      <CheckCheck size={14} />
      {pending ? 'Marking…' : 'Read all'}
    </button>
  )
}

export default function InboxPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const navigate = useNavigate()
  const [archived, setArchived] = useState(false)
  const { data: items = [], isLoading } = useInbox(workspaceId, archived)
  const { data: summary } = useInboxSummary(workspaceId)
  const updateDelivery = useUpdateInboxDelivery(workspaceId)
  const markAllRead = useMarkAllInboxRead(workspaceId)
  const itemRefs = useRef(new Map<string, HTMLAnchorElement>())
  const seenDeliveryIdsRef = useRef(new Set<string>())
  const unreadCount = summary?.unread_count ?? 0

  const desktopTopBarLeading = useMemo(() => (
    <div data-ui="inbox.header" className="flex min-w-0 items-center">
      <h1 data-ui="inbox.header.title" className={SHELL_RAIL_TITLE_CLASS}>Inbox</h1>
    </div>
  ), [])

  const desktopTopBarActions = useMemo(() => (
    <InboxFilters
      archived={archived}
      activeCount={summary?.active_count}
      archivedCount={summary?.archived_count}
      onShowActive={() => setArchived(false)}
      onShowArchived={() => setArchived(true)}
    />
  ), [archived, summary?.active_count, summary?.archived_count])

  useRegisterShellTopBarSlots({
    leading: desktopTopBarLeading,
    actions: desktopTopBarActions,
  })

  useEffect(() => {
    if (archived || items.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const deliveryId = entry.target.getAttribute('data-delivery-id')
          if (!deliveryId || seenDeliveryIdsRef.current.has(deliveryId)) continue
          seenDeliveryIdsRef.current.add(deliveryId)
          updateDelivery.mutate({ deliveryId, read: true })
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.6 },
    )

    for (const item of items) {
      if (!item.unread || !item.delivery_id) continue
      if (seenDeliveryIdsRef.current.has(item.delivery_id)) continue
      const node = itemRefs.current.get(item.id)
      if (node) observer.observe(node)
    }

    return () => observer.disconnect()
  }, [archived, items, updateDelivery])

  return (
    <div data-ui="inbox.page" className="h-full overflow-y-auto bg-white">
      <div data-ui="inbox.content" className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 md:px-8 md:py-8">
        <div data-ui="inbox.header.mobile" className="flex items-end justify-between gap-4 md:hidden">
          <div data-ui="inbox.header.mobile.main">
            <h1 data-ui="inbox.header.mobile.title" className="text-xl font-semibold text-gray-900">Inbox</h1>
            <p className="mt-1 text-sm text-gray-500">Items routed to you from channel events.</p>
          </div>
          <div data-ui="inbox.header.mobile.actions" className="flex items-center gap-2">
            {!archived && unreadCount > 0 ? (
              <InboxReadAllButton
                pending={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
                uiName="inbox.read-all.mobile"
              />
            ) : null}
            <InboxFilters
              archived={archived}
              activeCount={summary?.active_count}
              archivedCount={summary?.archived_count}
              onShowActive={() => setArchived(false)}
              onShowArchived={() => setArchived(true)}
              uiName="inbox.filters.mobile"
            />
          </div>
        </div>

        {!archived && unreadCount > 0 ? (
          <div data-ui="inbox.bulk-actions" className="hidden justify-end md:flex">
            <InboxReadAllButton
              pending={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            />
          </div>
        ) : null}

        {isLoading ? (
          <div data-ui="inbox.loading" className="flex flex-1 justify-center py-16"><Spinner size="lg" /></div>
        ) : items.length === 0 ? (
          <div data-ui="inbox.empty" className="flex flex-1 items-center justify-center py-10">
            <EmptyState heading={archived ? 'No archived items' : 'Inbox is clear'} subtext={archived ? 'Archived deliveries stay available here.' : 'No escalations or pending approvals.'} />
          </div>
        ) : (
          <div data-ui="inbox.list" className="space-y-2 pb-4">
            {items.map((item) => {
              const target = inboxTarget(item)

              async function openItem(event: React.MouseEvent<HTMLAnchorElement>) {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return
                }
                event.preventDefault()
                if (item.delivery_id) {
                  await updateDelivery.mutateAsync({
                    deliveryId: item.delivery_id,
                    read: true,
                    archived: true,
                  })
                }
                navigate(target)
              }

              return (
                <Link
                  key={item.id}
                  to={target}
                  onClick={(event) => { void openItem(event) }}
                  ref={(node) => {
                    if (node) itemRefs.current.set(item.id, node)
                    else itemRefs.current.delete(item.id)
                  }}
                  data-delivery-id={item.delivery_id ?? undefined}
                  data-ui="inbox.card"
                  className={`block rounded-xl border bg-white p-4 transition hover:border-brand-300 hover:shadow-sm ${item.unread ? 'border-brand-200 shadow-sm' : 'border-gray-200'}`}
                >
                  <div data-ui="inbox.card.row" className="flex items-start justify-between gap-3">
                    <div data-ui="inbox.card.main" className="min-w-0">
                      <div data-ui="inbox.card.title-row" className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        {item.item_type === 'escalation'
                          ? <AlertCircle size={15} className="text-orange-500" />
                          : item.item_type === 'mentioned_message'
                            ? <AtSign size={15} className="text-brand-500" />
                          : item.item_type === 'run_event'
                            ? <PlayCircle size={15} className="text-blue-500" />
                            : <FilePenLine size={15} className="text-blue-500" />}
                        {item.unread && <span className="inline-block h-2 w-2 rounded-full bg-brand-500" />}
                        <span className="truncate">{item.title}</span>
                      </div>
                      {item.subtitle && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{item.subtitle}</p>}
                      <p className="mt-2 text-[11px] text-gray-400">{new Date(item.created_at).toLocaleString()}</p>
                    </div>

                    <div data-ui="inbox.card.meta" className="shrink-0 space-y-2 text-right">
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] capitalize text-gray-700">
                        {item.status}
                      </span>
                      {item.due_at && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-orange-600">
                          <Clock3 size={10} />
                          {new Date(item.due_at).toLocaleString()}
                        </p>
                      )}
                      {item.delivery_id && (
                        <div data-ui="inbox.card.actions" className="flex items-center justify-end gap-1" onClick={(e) => e.preventDefault()}>
                          {!archived && item.unread && (
                            <button
                              onClick={() => updateDelivery.mutate({ deliveryId: item.delivery_id!, read: true })}
                              data-ui="inbox.card.mark-read"
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                            >
                              <CheckCheck size={11} />
                              Read
                            </button>
                          )}
                          {!archived ? (
                            <button
                              onClick={() => updateDelivery.mutate({ deliveryId: item.delivery_id!, archived: true })}
                              data-ui="inbox.card.archive"
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                            >
                              <Archive size={11} />
                              Archive
                            </button>
                          ) : (
                            <button
                              onClick={() => updateDelivery.mutate({ deliveryId: item.delivery_id!, archived: false })}
                              data-ui="inbox.card.restore"
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                            >
                              <ArchiveRestore size={11} />
                              Restore
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
