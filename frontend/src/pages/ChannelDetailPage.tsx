import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Send } from 'lucide-react'
import { useChannelMessages, useChannelDecisions, useChannels, usePostChannelMessage } from '@/api/channels'
import { useAuthStore } from '@/store/auth'
import Spinner from '@/components/shared/Spinner'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

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
    default: return kind.replace(/_/g, ' ')
  }
}

export default function ChannelDetailPage() {
  const { channelId } = useParams<{ channelId: string }>()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const { data: channels = [] } = useChannels(workspaceId)
  const { data: messages = [], isLoading: messagesLoading } = useChannelMessages(workspaceId, channelId ?? '')
  const { data: decisions = [], isLoading: decisionsLoading } = useChannelDecisions(workspaceId, channelId ?? '')
  const postMessage = usePostChannelMessage(workspaceId, channelId ?? '')

  const [draft, setDraft] = useState('')
  const channel = channels.find((c) => c.id === channelId)

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

  const loading = messagesLoading || decisionsLoading

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto h-full flex flex-col min-h-0">
      <div className="mb-4">
        <Link to="/channels" className="text-xs text-gray-500 hover:text-gray-700">Channels</Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-1">{channel?.name ?? 'Channel'}</h1>
      </div>

      <div className="flex-1 min-h-0 bg-[#f7f8fb] border border-gray-200 rounded-2xl flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner size="lg" /></div>
          ) : timeline.length === 0 ? (
            <p className="text-sm text-gray-500">No messages yet.</p>
          ) : (
            timeline.map((item) => {
              if (item.kind === 'message') {
                const m = item.data
                const mine = m.role === 'user'
                return (
                  <div key={item.id} className={`max-w-[90%] ${mine ? 'ml-auto' : 'mr-auto'}`}>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
                      {m.author_name ?? (m.author_type === 'human' ? 'You' : 'Agent')}
                    </p>
                    <div className={`rounded-2xl px-4 py-2.5 text-sm border ${mine ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-800 border-gray-200'}`}>
                      {m.content}
                    </div>
                  </div>
                )
              }

              const d = item.data
              return (
                <div key={item.id} className="max-w-[90%] mr-auto bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-amber-700">Decision</p>
                  <p className="text-sm text-amber-900">{decisionLabel(d.decision_type)}</p>
                  {d.actor_name && <p className="text-[11px] text-amber-700 mt-1">by {d.actor_name}</p>}
                </div>
              )
            })
          )}
        </div>

        <div className="border-t border-gray-200 bg-white p-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                postMessage.mutate({ content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' }, { onSuccess: () => setDraft('') })
              }
            }}
            placeholder={channel?.channel_type === 'handbook'
              ? 'Ask the assistant to propose handbook edits…'
              : 'Type a message…'}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => postMessage.mutate({ content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' }, { onSuccess: () => setDraft('') })}
            disabled={!draft.trim() || postMessage.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm disabled:opacity-40"
          >
            <Send size={14} />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
