import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Archive, ArchiveRestore, AtSign, CheckCheck, Clock3, FilePenLine, PlayCircle } from 'lucide-react'
import { useInbox, useInboxSummary, useUpdateInboxDelivery } from '@/api/channels'
import { useAuthStore } from '@/store/auth'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export default function InboxPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const [archived, setArchived] = useState(false)
  const { data: items = [], isLoading } = useInbox(workspaceId, archived)
  const { data: summary } = useInboxSummary(workspaceId)
  const updateDelivery = useUpdateInboxDelivery(workspaceId)

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
        <h1 className="text-xl font-semibold text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">Items routed to you from channel events.</p>
        </div>
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

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : items.length === 0 ? (
        <EmptyState heading={archived ? 'No archived items' : 'Inbox is clear'} subtext={archived ? 'Archived deliveries stay available here.' : 'No escalations or pending approvals.'} />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const target = item.item_type === 'escalation' || item.item_type === 'run_event'
              ? `/runs/${item.run_id}`
              : item.item_type === 'mentioned_message' || item.item_type === 'task_assigned'
                ? item.channel_id
                  ? `/channels/${item.channel_id}`
                  : item.run_id
                    ? `/runs/${item.run_id}`
                    : '/channels'
                : item.proposal_id
                  ? '/handbook?tab=proposals'
                  : '/runs'

            return (
              <Link
                key={item.id}
                to={target}
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
