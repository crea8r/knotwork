/**
 * DesignerChat — conversational UI for the designer agent.
 * History is loaded from the DB on mount and persists across server restarts.
 */
import { useEffect, useRef, useState } from 'react'
import { GitBranch, Trash2 } from 'lucide-react'
import axios from 'axios'
import { useDesignChat, useDesignerMessages, useClearDesignerHistory } from '@/api/designer'
import { useGraph } from '@/api/graphs'
import { ChannelComposer, ChannelShell, ChannelTimeline, type ChannelTimelineItem } from '@/components/channel/ChannelFrame'
import { useCanvasStore, type GraphDelta } from '@/store/canvas'
import { useAuthStore } from '@/store/auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

interface Message {
  role: 'user' | 'assistant'
  content: string
  questions?: string[]
  created_at?: string
}

interface Props {
  graphId: string
  sessionId: string
  onBeforeApplyDelta?: () => void
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function DesignerChat({ graphId, sessionId, onBeforeApplyDelta }: Props) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const [messages, setMessages] = useState<Message[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [input, setInput] = useState('')
  const chat = useDesignChat(workspaceId, graphId)
  const applyDelta = useCanvasStore(s => s.applyDelta)
  const endRef = useRef<HTMLDivElement>(null)

  const { data: graph } = useGraph(workspaceId, graphId)
  const { data: dbMessages } = useDesignerMessages(workspaceId, graphId)
  const clearHistory = useClearDesignerHistory(workspaceId, graphId)

  // Load DB history once on mount
  useEffect(() => {
    if (historyLoaded) return
    if (dbMessages === undefined) return
    if (dbMessages.length > 0) {
      setMessages(dbMessages.map(m => ({ role: m.role, content: m.content, created_at: m.created_at })))
    } else {
      setMessages([{ role: 'assistant', content: "Hi! Describe the workflow you want to build and I'll set it up for you." }])
    }
    setHistoryLoaded(true)
  }, [dbMessages, historyLoaded])

  // Auto-scroll when messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || chat.isPending) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])

    try {
      const res = await chat.mutateAsync({ session_id: sessionId, message: text })
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.reply,
        questions: res.questions.length ? res.questions : undefined,
      }])
      if (res.graph_delta && Object.keys(res.graph_delta).length > 0) {
        onBeforeApplyDelta?.()
        applyDelta(res.graph_delta as unknown as GraphDelta)
      }
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.detail ?? error.message
        : error instanceof Error
          ? error.message
          : null
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: detail ? `Something went wrong: ${detail}` : 'Something went wrong. Please try again.',
      }])
    }
  }

  async function handleClear() {
    if (!confirm('Clear chat history for this graph?')) return
    await clearHistory.mutateAsync()
    setMessages([{ role: 'assistant', content: "History cleared. How can I help you?" }])
    setHistoryLoaded(false)
  }

  if (!historyLoaded) {
    return <div className="flex h-full items-center justify-center text-xs text-gray-400">Loading…</div>
  }

  const timelineItems: ChannelTimelineItem[] = messages.map((m, i) => ({
    id: `${m.created_at ?? 'draft'}-${i}`,
    kind: 'message',
    authorLabel: m.role === 'user' ? 'You' : 'Knotwork Agent',
    mine: m.role === 'user',
    tone: m.role === 'user' ? 'human' : 'agent',
    content: (
      <div>
        <p>{m.content}</p>
        {m.questions && m.questions.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs opacity-80">
            {m.questions.map((q, qi) => (
              <li key={qi}>• {q}</li>
            ))}
          </ul>
        ) : null}
        {m.created_at ? <p className="mt-2 text-[10px] opacity-60">{relativeTime(m.created_at)}</p> : null}
      </div>
    ),
  }))

  if (chat.isPending) {
    timelineItems.push({
      id: 'designer-thinking',
      kind: 'message',
      authorLabel: 'Knotwork Agent',
      tone: 'agent',
      content: 'Thinking…',
    })
  }

  return (
    <ChannelShell
      typeIcon={<GitBranch size={14} />}
      title={graph?.name ?? 'Workflow chat'}
      description="Discuss workflow changes and apply them directly to the graph."
      parentLabel={`${messages.filter(m => m.role === 'user').length} prompts`}
      actions={(
        <button
          onClick={handleClear}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-500"
          title="Clear history"
          disabled={clearHistory.isPending}
        >
          <Trash2 size={13} />
        </button>
      )}
    >
      <ChannelTimeline items={timelineItems} emptyState="Describe the workflow you want to build." />
      <div ref={endRef} />
      <ChannelComposer
        draft={input}
        setDraft={setInput}
        onSend={() => { void send() }}
        pending={chat.isPending}
        placeholder="Describe workflow changes for Knotwork Agent…"
        rows={4}
      />
    </ChannelShell>
  )
}
