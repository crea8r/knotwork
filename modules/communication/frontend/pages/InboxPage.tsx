import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Archive, ArchiveRestore, AtSign, CheckCheck, Clock3, FilePenLine, PlayCircle } from 'lucide-react'
import { useInbox, useInboxSummary, useMarkAllInboxRead, useUpdateInboxDelivery } from '@modules/communication/frontend/api/channels'
import { useAuthStore } from '@auth'
import Spinner from '@ui/components/Spinner'
import EmptyState from '@ui/components/EmptyState'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

function inboxTarget(item: import('@data-models').InboxItem) {
  if (item.asset_type === 'workflow' && item.asset_id) {
    const params = new URLSearchParams()
    params.set('chat', '1')
    if (item.channel_id) params.set('consultation', item.channel_id)
    if (item.message_id) params.set('message', item.message_id)
    return `/graphs/${item.asset_id}?${params.toString()}`
  }
  if ((item.asset_type === 'file' || item.asset_type === 'folder') && item.asset_path !== null) {
    const params = new URLSearchParams()
    if (item.asset_type === 'file') params.set('path', item.asset_path)
    else if (item.asset_path) params.set('folder', item.asset_path)
    params.set('chat', '1')
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
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
        <h1 className="text-xl font-semibold text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">Items routed to you from channel events.</p>
        </div>
        <div className="flex items-center gap-2">
          {!archived && (summary?.unread_count ?? 0) > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <CheckCheck size={14} />
              {markAllRead.isPending ? 'Marking…' : 'Read all'}
            </button>
          )}
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
            <button
              onClick={() => setArchived(false)}
              className={`px-3 py-1.5 text-sm rounded-lg ${!archived ? 'bg-brand-50 text-brand-700' : 'text-gray-500'}`}
            >
              Active {summary ? `(${summary.active_count})` : ''}
            </button>
            <button
              onClick={() => setArchived(true)}
              className={`px-3 py-1.5 text-sm rounded-lg ${archived ? 'bg-brand-50 text-brand-700' : 'text-gray-500'}`}
            >
              Archived {summary ? `(${summary.archived_count})` : ''}
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : items.length === 0 ? (
        <EmptyState heading={archived ? 'No archived items' : 'Inbox is clear'} subtext={archived ? 'Archived deliveries stay available here.' : 'No escalations or pending approvals.'} />
      ) : (
        <div className="space-y-2">
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
                className={`block bg-white border rounded-xl p-4 hover:border-brand-300 hover:shadow-sm transition ${item.unread ? 'border-brand-200 shadow-sm' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      {item.item_type === 'escalation'
                        ? <AlertCircle size={15} className="text-orange-500" />
                        : item.item_type === 'mentioned_message'
                          ? <AtSign size={15} className="text-brand-500" />
                        : item.item_type === 'run_event'
                          ? <PlayCircle size={15} className="text-blue-500" />
                        : <FilePenLine size={15} className="text-blue-500" />}
                      {item.unread && <span className="inline-block w-2 h-2 rounded-full bg-brand-500" />}
                      <span className="truncate">{item.title}</span>
                    </div>
                    {item.subtitle && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.subtitle}</p>}
                    <p className="text-[11px] text-gray-400 mt-2">{new Date(item.created_at).toLocaleString()}</p>
                  </div>

                  <div className="text-right shrink-0 space-y-2">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-700 capitalize">
                      {item.status}
                    </span>
                    {item.due_at && (
                      <p className="mt-1 text-[11px] text-orange-600 inline-flex items-center gap-1">
                        <Clock3 size={10} />
                        {new Date(item.due_at).toLocaleString()}
                      </p>
                    )}
                    {item.delivery_id && (
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.preventDefault()}>
                        {!archived && item.unread && (
                          <button
                            onClick={() => updateDelivery.mutate({ deliveryId: item.delivery_id!, read: true })}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                          >
                            <CheckCheck size={11} />
                            Read
                          </button>
                        )}
                        {!archived ? (
                          <button
                            onClick={() => updateDelivery.mutate({ deliveryId: item.delivery_id!, archived: true })}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                          >
                            <Archive size={11} />
                            Archive
                          </button>
                        ) : (
                          <button
                            onClick={() => updateDelivery.mutate({ deliveryId: item.delivery_id!, archived: false })}
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
  )
}
