/**
 * HandbookChatPanel — AI chat panel for handbook editing.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { useAskHandbookChat, useChannelDecisions, useChannelMessages } from '@/api/channels'
import Spinner from '@/components/shared/Spinner'
import HandbookProposalCard, { type HandbookProposalPayload } from './HandbookProposalCard'

const MS_24H = 24 * 60 * 60 * 1000
const MIN_RECENT = 10

type TimelineItem =
  | { id: string; ts: number; type: 'msg'; payload: { content: string; authorName: string; authorType: string } }
  | { id: string; ts: number; type: 'decision'; payload: { decisionType: string; actorName: string | null } }
  | { id: string; ts: number; type: 'proposal'; payload: HandbookProposalPayload }

function decisionLabel(kind: string) {
  if (kind === 'handbook_change_requested') return 'Handbook change requested'
  return kind.replace(/_/g, ' ')
}

interface Props {
  workspaceId: string
  channelId: string | null
  onCreateChannel: () => void
  onOpenFile: (path: string) => void
  currentFolder: string
  currentFilePath?: string | null
}

export default function HandbookChatPanel({
  workspaceId, channelId, onCreateChannel, onOpenFile, currentFolder, currentFilePath,
}: Props) {
  const { data: messages = [], isLoading } = useChannelMessages(workspaceId, channelId ?? '')
  const { data: decisions = [] } = useChannelDecisions(workspaceId, channelId ?? '')
  const askHandbook = useAskHandbookChat(workspaceId, channelId ?? '')
  const [draft, setDraft] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [showOlder, setShowOlder] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const loadingOlderRef = useRef(false)

  const allTimeline = useMemo<TimelineItem[]>(() => {
    const msgs: TimelineItem[] = messages.map(m => ({
      id: `m-${m.id}`, ts: new Date(m.created_at).getTime(), type: 'msg',
      payload: { content: m.content, authorName: m.author_name ?? (m.author_type === 'human' ? 'You' : 'Agent'), authorType: m.author_type },
    }))
    const acts: TimelineItem[] = decisions.filter(d => d.decision_type !== 'handbook_proposal').map(d => ({
      id: `d-${d.id}`, ts: new Date(d.created_at).getTime(), type: 'decision' as const,
      payload: { decisionType: d.decision_type, actorName: d.actor_name },
    }))
    const props: TimelineItem[] = decisions.filter(d => d.decision_type === 'handbook_proposal').flatMap(d => {
      const p = d.payload as Partial<HandbookProposalPayload>
      if (!p?.proposal_id || !p?.path) return []
      return [{ id: `p-${d.id}`, ts: new Date(d.created_at).getTime(), type: 'proposal' as const,
        payload: { proposal_id: p.proposal_id, path: String(p.path), reason: String(p.reason ?? ''),
          proposed_content: String(p.proposed_content ?? ''), status: (p.status ?? 'pending') as HandbookProposalPayload['status'],
          final_content: p.final_content ? String(p.final_content) : undefined } }]
    })
    return [...msgs, ...acts, ...props].sort((a, b) => a.ts - b.ts)
  }, [messages, decisions])

  const cutoff = Date.now() - MS_24H
  const recentTimeline = allTimeline.filter(i => i.ts >= cutoff)
  const defaultTimeline = recentTimeline.length >= MIN_RECENT ? recentTimeline : allTimeline.slice(-MIN_RECENT)
  const displayedTimeline = showOlder ? allTimeline : defaultTimeline
  const olderCount = allTimeline.length - displayedTimeline.length

  useEffect(() => {
    if (isLoading || displayedTimeline.length === 0) return
    if (!initializedRef.current) { bottomRef.current?.scrollIntoView({ behavior: 'instant' }); initializedRef.current = true; return }
    if (loadingOlderRef.current) { loadingOlderRef.current = false; return }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [isLoading, displayedTimeline.length])

  async function sendRequest() {
    if (askHandbook.isPending || !draft.trim() || !channelId) return
    await askHandbook.mutateAsync({ message: draft.trim() })
    setDraft('')
  }

  const contextLabel = currentFilePath
    ? currentFilePath
    : currentFolder || 'Home'

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-xs text-gray-500">Ask the agent to create or edit handbook files.</p>
          <p className="mt-0.5 text-[11px] font-mono text-gray-400 truncate">Context: {contextLabel}</p>
        </div>
        <button onClick={() => setShowRaw(v => !v)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-gray-300">
          {showRaw ? 'Hide raw' : 'Debug'}
        </button>
      </div>
      {!channelId ? (
        <div className="p-4 flex-1">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-700">Create handbook chat channel to start.</p>
            <button onClick={onCreateChannel} className="mt-3 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">Create handbook chat</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {isLoading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : (
              <>
                {olderCount > 0 && (
                  <div className="flex justify-center">
                    <button onClick={() => { loadingOlderRef.current = true; setShowOlder(true) }}
                      className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 py-1">
                      Load {olderCount} older message{olderCount !== 1 ? 's' : ''}
                    </button>
                  </div>
                )}
                {displayedTimeline.length === 0
                  ? <p className="text-sm text-gray-400 italic">No conversation yet.</p>
                  : displayedTimeline.map(item => {
                      if (item.type === 'msg') {
                        const mine = item.payload.authorType === 'human'
                        return (
                          <div key={item.id} className={`max-w-[92%] ${mine ? 'ml-auto' : 'mr-auto'}`}>
                            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{item.payload.authorName}</p>
                            <div className={`rounded-2xl px-3 py-2 text-sm border whitespace-pre-wrap ${mine ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-800 border-gray-200'}`}>{item.payload.content}</div>
                          </div>
                        )
                      }
                      if (item.type === 'decision') {
                        return (
                          <div key={item.id} className="max-w-[92%] mr-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-amber-700">Action</p>
                            <p className="text-sm text-amber-900">{decisionLabel(item.payload.decisionType)}</p>
                            {item.payload.actorName && <p className="text-[11px] text-amber-700 mt-1">by {item.payload.actorName}</p>}
                          </div>
                        )
                      }
                      return <HandbookProposalCard key={item.id} proposal={item.payload} workspaceId={workspaceId} channelId={channelId} onOpenFile={onOpenFile} showRaw={showRaw} />
                    })
                }
                {askHandbook.isPending && (
                  <div className="max-w-[92%] mr-auto">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Knotwork Agent</p>
                    <div className="rounded-2xl px-3 py-2 text-sm border bg-white text-gray-700 border-gray-200 inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />Agent is thinking…
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>
          <div className="border-t border-gray-200 bg-white p-3 flex-shrink-0">
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} disabled={askHandbook.isPending}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.trim()) { e.preventDefault(); void sendRequest() } }}
              placeholder="Ask to create/edit/move handbook content… (⌘↵ to send)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 resize-none disabled:bg-gray-50 disabled:text-gray-500" />
            <div className="mt-2 flex justify-end">
              <button onClick={() => { void sendRequest() }} disabled={!draft.trim() || askHandbook.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm disabled:opacity-40">
                {askHandbook.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {askHandbook.isPending ? 'Thinking…' : 'Send'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
