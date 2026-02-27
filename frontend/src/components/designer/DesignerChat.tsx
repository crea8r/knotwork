/**
 * DesignerChat — conversational UI for the designer agent.
 * Sends messages to POST /graphs/design/chat, receives reply + graph_delta,
 * and calls applyDelta on the canvas store.
 */
import { useRef, useState } from 'react'
import { useDesignChat, type GraphDelta } from '@/api/designer'
import { useCanvasStore } from '@/store/canvas'

interface Message {
  role: 'user' | 'assistant'
  content: string
  questions?: string[]
}

interface Props {
  graphId: string
  sessionId: string
}

export default function DesignerChat({ graphId, sessionId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! Describe the workflow you want to build and I\'ll set it up for you.' },
  ])
  const [input, setInput] = useState('')
  const chat = useDesignChat(graphId)
  const applyDelta = useCanvasStore(s => s.applyDelta)
  const endRef = useRef<HTMLDivElement>(null)

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
      if (Object.keys(res.graph_delta).length > 0) {
        applyDelta(res.graph_delta as GraphDelta)
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
      }])
    }

    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
      <div className="border-t p-3 flex gap-2">
        <input
          className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="Describe a change…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
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
