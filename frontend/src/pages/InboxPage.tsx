import { Link } from 'react-router-dom'
import { AlertCircle, Clock3, FilePenLine } from 'lucide-react'
import { useInbox } from '@/api/channels'
import { useAuthStore } from '@/store/auth'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export default function InboxPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: items = [], isLoading } = useInbox(workspaceId)

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Inbox</h1>
        <p className="text-sm text-gray-500 mt-1">Items that need attention now.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : items.length === 0 ? (
        <EmptyState heading="Inbox is clear" subtext="No escalations or pending approvals." />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const target = item.escalation_id
              ? `/runs/${item.run_id}`
              : item.proposal_id
                ? '/handbook?tab=proposals'
                : '/runs'

            return (
              <Link
                key={item.id}
                to={target}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-brand-300 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      {item.item_type === 'escalation'
                        ? <AlertCircle size={15} className="text-orange-500" />
                        : <FilePenLine size={15} className="text-blue-500" />}
                      <span className="truncate">{item.title}</span>
                    </div>
                    {item.subtitle && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.subtitle}</p>}
                    <p className="text-[11px] text-gray-400 mt-2">{new Date(item.created_at).toLocaleString()}</p>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-700 capitalize">
                      {item.status}
                    </span>
                    {item.due_at && (
                      <p className="mt-1 text-[11px] text-orange-600 inline-flex items-center gap-1">
                        <Clock3 size={10} />
                        {new Date(item.due_at).toLocaleString()}
                      </p>
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
