/**
 * DesignerChat — conversational UI for the designer agent.
 * History is loaded from the DB on mount and persists across server restarts.
 */
import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useDesignChat, useDesignerMessages, useClearDesignerHistory } from '@/api/designer'
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
  const chat = useDesignChat(graphId)
  const applyDelta = useCanvasStore(s => s.applyDelta)
  const endRef = useRef<HTMLDivElement>(null)

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
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
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

  return (
    <div className="flex flex-col h-full">
      {/* Chat header with clear button */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[11px] font-semibold">
            K
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-700 leading-none">Knotwork Agent</p>
            <p className="text-[10px] text-gray-400 leading-none mt-0.5">
              {messages.filter(m => m.role === 'user').length} messages
            </p>
          </div>
        </div>
        <button
          onClick={handleClear}
          className="text-gray-300 hover:text-red-400 p-1 rounded"
          title="Clear history"
          disabled={clearHistory.isPending}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            {m.role === 'assistant' && (
              <div className="flex items-center gap-1.5 mb-1 pl-1">
                <div className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-semibold">
                  K
                </div>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Knotwork Agent</span>
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p>{m.content}</p>
              {m.questions && m.questions.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.questions.map((q, qi) => (
                    <li key={qi} className="text-xs text-gray-600">• {q}</li>
                  ))}
                </ul>
              )}
            </div>
            {m.created_at && (
              <span className="text-[10px] text-gray-300 mt-0.5 px-1">{relativeTime(m.created_at)}</span>
            )}
          </div>
        ))}
        {chat.isPending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-400 animate-pulse">
              Thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3 flex gap-2 flex-shrink-0">
        <textarea
          className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-400 resize-none min-h-[86px]"
          placeholder="Describe workflow changes for Knotwork Agent..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
          disabled={chat.isPending}
        />
        <button
          onClick={send}
          disabled={!input.trim() || chat.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  )
}
