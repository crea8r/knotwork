import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Paperclip, Send, X } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { api } from '@/api/client'
import type { ChannelMessage } from '@/types'
import type { AgentMainChatAskResponse, ChatAttachmentRef, RegisteredAgent } from '@/api/agents'

const WS = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const HIDDEN_KINDS = new Set(['main_chat_plugin_log', 'main_session_ready'])
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i
const MS_24H = 24 * 60 * 60 * 1000

interface AttachmentState {
  ref: ChatAttachmentRef
  previewUrl?: string
  kind: 'image' | 'file'
}

interface Props {
  agent: RegisteredAgent
  chatReady: boolean
  chatStatusMsg: string
  sessionName: string | null
  chatMessages: ChannelMessage[]
  chatMsgLoading: boolean
  isPending: boolean
  onSend: (message: string, attachments?: ChatAttachmentRef[]) => Promise<AgentMainChatAskResponse>
}

function dayKey(iso: string) {
  const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date(), yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

type RenderItem = { type: 'divider'; label: string } | { type: 'msg'; msg: ChannelMessage }

function buildItems(messages: ChannelMessage[]): RenderItem[] {
  const items: RenderItem[] = []
  let lastDay = ''
  for (const m of messages) {
    const day = dayKey(m.created_at)
    if (day !== lastDay) { items.push({ type: 'divider', label: dayLabel(m.created_at) }); lastDay = day }
    items.push({ type: 'msg', msg: m })
  }
  return items
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-[11px] text-gray-400 font-medium">{label}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  )
}

function MessageBubble({ m, agentName }: { m: ChannelMessage; agentName: string }) {
  const isHuman = m.author_type === 'human'
  const isSystem = m.author_type === 'system'
  return (
    <div className={`flex ${isHuman ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] flex flex-col gap-0.5 ${isHuman ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm ${
          isHuman ? 'bg-brand-600 text-white'
            : isSystem ? 'bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg'
            : 'bg-white border border-gray-200 text-gray-800'
        }`}>
          {!isHuman && <p className="text-[10px] opacity-60 mb-1 font-semibold uppercase tracking-wide">{m.author_name || agentName}</p>}
          <div className={`prose prose-sm max-w-none break-words [&>*:last-child]:mb-0 [&>*:first-child]:mt-0 ${isHuman ? 'prose-invert' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
          </div>
        </div>
        <span className="text-[10px] text-gray-400 px-1">{formatTime(m.created_at)}</span>
      </div>
    </div>
  )
}

export default function AgentChatTab({
  agent, chatReady, chatStatusMsg, sessionName,
  chatMessages, chatMsgLoading, isPending, onSend,
}: Props) {
  const [chatText, setChatText] = useState('')
  const [attachment, setAttachment] = useState<AttachmentState | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [showOlder, setShowOlder] = useState(false)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const initializedRef = useRef(false)
  const loadingOlderRef = useRef(false)

  const allVisible = chatMessages.filter((m) => !HIDDEN_KINDS.has((m.metadata_?.kind ?? '') as string))
  const cutoff = Date.now() - MS_24H
  const recentVisible = allVisible.filter((m) => new Date(m.created_at).getTime() >= cutoff)
  const olderCount = allVisible.length - recentVisible.length
  const displayed = showOlder ? allVisible : recentVisible
  const items = buildItems(displayed)

  // Scroll to bottom: instant on first load, smooth on new messages, skip on load-older
  useEffect(() => {
    if (!chatReady || chatMsgLoading) return
    if (!initializedRef.current) {
      if (displayed.length > 0) {
        chatEndRef.current?.scrollIntoView({ behavior: 'instant' })
        initializedRef.current = true
      }
      return
    }
    if (loadingOlderRef.current) { loadingOlderRef.current = false; return }
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatReady, chatMsgLoading, displayed.length])

  useEffect(() => () => { if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl) }, [attachment?.previewUrl])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    if (file.size > 50 * 1024 * 1024) { alert('Max file size is 50 MB'); return }
    setUploading(true)
    try {
      const form = new FormData(); form.append('file', file)
      const { data } = await api.post<ChatAttachmentRef & { attachment_id: string }>(
        `/workspaces/${WS}/agents/${agent.id}/main-chat/attach`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      const ref: ChatAttachmentRef = { key: data.key, url: data.url, filename: data.filename, mime_type: data.mime_type, size: data.size }
      const isImage = file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name)
      setAttachment({ ref, previewUrl: isImage ? URL.createObjectURL(file) : undefined, kind: isImage ? 'image' : 'file' })
    } catch (err: any) {
      alert(`Upload failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`)
    } finally { setUploading(false); textareaRef.current?.focus() }
  }

  async function handleSend() {
    const text = chatText.trim()
    if ((!text && !attachment) || isPending || !chatReady) return
    setSendError(null); setChatText('')
    const attachments = attachment ? [attachment.ref] : undefined
    setAttachment(null)
    try { await onSend(text, attachments) }
    catch (e: any) { setSendError(e?.response?.data?.detail ?? 'Send failed') }
  }

  return (
    <>
      {chatReady && sessionName && (
        <div className="flex-shrink-0 border-b bg-white px-6 py-2 flex items-center gap-2 text-[11px] text-gray-400">
          <span className="font-medium text-gray-500">OpenClaw session:</span>
          <code className="font-mono text-gray-600 truncate max-w-xs">{sessionName}</code>
          <button type="button" onClick={() => navigator.clipboard.writeText(sessionName ?? '')}
            className="text-gray-400 hover:text-brand-600 underline underline-offset-2">copy</button>
          <span className="text-gray-300">·</span>
          <span className="italic">Find this session in your OpenClaw workspace</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6 space-y-3 bg-gray-50">
        {!chatReady ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 pt-4"><Spinner /><span>{chatStatusMsg}</span></div>
        ) : chatMsgLoading ? (
          <div className="pt-4"><Spinner /></div>
        ) : displayed.length === 0 ? (
          <p className="text-sm text-gray-400 italic pt-4">No messages in the last 24 hours. Say hello to {agent.display_name}.</p>
        ) : (
          <>
            {/* Load older messages */}
            {!showOlder && olderCount > 0 && (
              <div className="flex justify-center">
                <button onClick={() => { loadingOlderRef.current = true; setShowOlder(true) }}
                  className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 py-1">
                  Load {olderCount} older message{olderCount !== 1 ? 's' : ''}
                </button>
              </div>
            )}
            {items.map((item, i) =>
              item.type === 'divider'
                ? <DayDivider key={`div-${i}`} label={item.label} />
                : <MessageBubble key={item.msg.id} m={item.msg} agentName={agent.display_name} />
            )}
          </>
        )}
        {isPending && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-400 italic flex items-center gap-2">
              <Spinner size="sm" />{agent.display_name} is thinking…
            </div>
          </div>
        )}
        {sendError && (
          <div className="flex justify-center">
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">{sendError}</p>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="flex-shrink-0 border-t p-4 bg-white space-y-2">
        {(attachment || uploading) && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex items-center gap-1.5 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1 text-xs text-brand-700 max-w-sm">
              {uploading ? (
                <><Loader2 size={11} className="animate-spin flex-shrink-0" /><span>Uploading…</span></>
              ) : attachment?.kind === 'image' && attachment.previewUrl ? (
                <>
                  <img src={attachment.previewUrl} alt={attachment.ref.filename} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                  <span className="truncate max-w-[160px]">{attachment.ref.filename}</span>
                  <span className="text-brand-400 flex-shrink-0">({(attachment.ref.size / 1024).toFixed(0)} KB)</span>
                  <button type="button" onClick={() => setAttachment(null)} className="ml-0.5 text-brand-400 hover:text-brand-700 flex-shrink-0"><X size={11} /></button>
                </>
              ) : attachment ? (
                <>
                  <Paperclip size={11} className="flex-shrink-0" />
                  <span className="truncate max-w-[180px]">{attachment.ref.filename}</span>
                  <span className="text-brand-400 flex-shrink-0">({(attachment.ref.size / 1024).toFixed(0)} KB)</span>
                  <button type="button" onClick={() => setAttachment(null)} className="ml-0.5 text-brand-400 hover:text-brand-700 flex-shrink-0"><X size={11} /></button>
                </>
              ) : null}
            </div>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
          <button type="button" onClick={() => fileInputRef.current?.click()}
            disabled={!chatReady || isPending || uploading} title="Attach any file (max 50 MB)"
            className="flex-shrink-0 w-9 h-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:text-brand-600 hover:border-brand-300 disabled:opacity-40 transition-colors">
            <Paperclip size={15} />
          </button>
          <textarea ref={textareaRef} value={chatText} onChange={(e) => setChatText(e.target.value)}
            placeholder={chatReady ? `Message ${agent.display_name}… (⌘↵ to send)` : 'Connecting…'}
            disabled={!chatReady || isPending} rows={2}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void handleSend() } }} />
          <button onClick={() => void handleSend()}
            disabled={!chatReady || (!chatText.trim() && !attachment) || isPending || uploading}
            className="flex-shrink-0 w-9 h-9 rounded-xl bg-brand-600 text-white disabled:opacity-40 flex items-center justify-center self-end">
            {isPending ? <Spinner size="sm" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </>
  )
}
