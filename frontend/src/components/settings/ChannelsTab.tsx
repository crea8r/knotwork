import { Link } from 'react-router-dom'
import { Hash, Megaphone } from 'lucide-react'
import { useChannelMessages, useChannels } from '@/api/channels'
import { useAuthStore } from '@/store/auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export default function ChannelsTab() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: channels = [] } = useChannels(workspaceId)

  const bulletin = channels.find((channel) => channel.channel_type === 'bulletin') ?? null
  const { data: bulletinMessages = [] } = useChannelMessages(workspaceId, bulletin?.slug ?? '')
  const latestBulletinMessage = bulletinMessages.length > 0 ? bulletinMessages[bulletinMessages.length - 1] : null
  const freeChatCount = channels.filter((channel) => channel.channel_type === 'normal' || channel.channel_type === 'agent_main').length
  const workflowCount = channels.filter((channel) => channel.channel_type === 'workflow').length
  const handbookCount = channels.filter((channel) => channel.channel_type === 'handbook').length

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Megaphone size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Workspace Bulletin</h2>
            {bulletin && latestBulletinMessage ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
                <p className="text-xs text-amber-900 line-clamp-3">{latestBulletinMessage.content}</p>
              </div>
            ) : bulletin ? (
              <p className="mt-2 text-xs text-gray-500">No bulletin messages yet.</p>
            ) : (
              <p className="mt-2 text-xs text-gray-500">No bulletin channel exists yet.</p>
            )}
          </div>
          {bulletin ? (
            <Link
              to={`/channels/${bulletin.slug}`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Open
            </Link>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Channel Surface</h2>
            <p className="mt-1 text-sm text-gray-600">
              Browse communication spaces from the Channels page. Creation is handled elsewhere in the product.
            </p>
          </div>
          <Link
            to="/channels"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Hash size={14} />
            Open
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Free Chat</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{freeChatCount}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Workflow</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{workflowCount}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Handbook</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{handbookCount}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
