/**
 * HandbookChatPanel — AI chat panel for handbook editing.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { useAskHandbookChat, useChannelDecisions, useChannelMessages } from '@/api/channels'
import { ChannelComposer, ChannelContextPill, ChannelShell, ChannelTimeline, type ChannelTimelineItem } from '@/components/channel/ChannelFrame'
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
  const timelineItems = useMemo<ChannelTimelineItem[]>(() => displayedTimeline.map((item) => {
    if (item.type === 'msg') {
      return {
        id: item.id,
        kind: 'message' as const,
        authorLabel: item.payload.authorName,
        mine: item.payload.authorType === 'human',
        tone: item.payload.authorType === 'human' ? 'human' : 'agent',
        content: item.payload.content,
      }
    }
    if (item.type === 'decision') {
      return {
        id: item.id,
        kind: 'decision' as const,
        label: decisionLabel(item.payload.decisionType),
        actorName: item.payload.actorName,
      }
    }
    return {
      id: item.id,
      kind: 'custom' as const,
      content: <HandbookProposalCard proposal={item.payload} workspaceId={workspaceId} channelId={channelId ?? ''} onOpenFile={onOpenFile} showRaw={showRaw} />,
    }
  }), [channelId, displayedTimeline, onOpenFile, showRaw, workspaceId])

  return (
    <ChannelShell
      title="Handbook Agent"
      typeIcon={<BookOpen size={14} />}
      parentLabel="Knowledge maintenance channel"
      actions={(
        <button onClick={() => setShowRaw(v => !v)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-gray-300">
          {showRaw ? 'Hide raw' : 'Debug'}
        </button>
      )}
      context={(
        <>
          <ChannelContextPill>{contextLabel}</ChannelContextPill>
          {channelId ? null : <ChannelContextPill>Create channel required</ChannelContextPill>}
        </>
      )}
    >
      {!channelId ? (
        <div className="p-4 flex-1 bg-[#faf7f1]">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-700">Create handbook chat channel to start.</p>
            <button onClick={onCreateChannel} className="mt-3 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">Create handbook chat</button>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 items-center justify-center bg-[#faf7f1]"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex flex-col">
            {olderCount > 0 && !showOlder ? (
              <div className="bg-[#faf7f1] px-4 pt-3">
                <button
                  onClick={() => { loadingOlderRef.current = true; setShowOlder(true) }}
                  className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 py-1"
                >
                  Load {olderCount} older message{olderCount !== 1 ? 's' : ''}
                </button>
              </div>
            ) : null}
            <ChannelTimeline items={timelineItems} emptyState="No conversation yet." />
            {askHandbook.isPending ? (
              <div className="bg-[#faf7f1] px-4 pb-3">
                <div className="max-w-[92%] mr-auto">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Knotwork Agent</p>
                  <div className="rounded-2xl px-3 py-2 text-sm border bg-white text-gray-700 border-gray-200 inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />Agent is thinking…
                  </div>
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <ChannelComposer
            draft={draft}
            setDraft={setDraft}
            onSend={() => { void sendRequest() }}
            pending={askHandbook.isPending}
            placeholder="Ask to create, edit, move, or restructure handbook content…"
          />
        </>
      )}
    </ChannelShell>
  )
}
