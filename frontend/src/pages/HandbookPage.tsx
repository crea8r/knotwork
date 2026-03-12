/**
 * HandbookPage — tabbed left panel (Files | Chat) + resizable + content on the right.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Ban,
  BookOpen,
  Check,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  SquarePen,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useKnowledgeFiles, useSearchKnowledgeFiles, useUploadFile, type KnowledgeFile, type UploadPreview } from '@/api/knowledge'
import {
  useAskHandbookChat,
  useChannelDecisions,
  useChannelMessages,
  useChannels,
  useCreateChannel,
  useResolveHandbookProposal,
} from '@/api/channels'
import { useAuthStore } from '@/store/auth'
import FileTree from '@/components/handbook/FileTree'
import FileEditor from '@/components/handbook/FileEditor'
import NewFilePanel from '@/components/handbook/NewFilePanel'
import UploadPreviewPanel from '@/components/handbook/UploadPreviewPanel'
import Spinner from '@/components/shared/Spinner'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp'])
const MS_24H = 24 * 60 * 60 * 1000
const MIN_RECENT = 10          // always show at least this many messages
const MIN_PANEL_W = 200
const MAX_PANEL_W = 520
const DEFAULT_PANEL_W = 288   // w-72

function getExt(name: string) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function statusBadge(status: string) {
  if (status === 'pending') return 'bg-amber-100 text-amber-700'
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (status === 'aborted') return 'bg-rose-100 text-rose-700'
  return 'bg-gray-100 text-gray-700'
}

function decisionLabel(kind: string): string {
  if (kind === 'handbook_change_requested') return 'Handbook change requested'
  return kind.replace(/_/g, ' ')
}

type RightPanel =
  | { kind: 'empty' }
  | { kind: 'file'; path: string }
  | { kind: 'new'; folder: string }
  | { kind: 'upload'; preview: UploadPreview; folder: string }
  | { kind: 'video'; filename: string }
  | { kind: 'error'; message: string }

type HandbookProposalPayload = {
  proposal_id: string; path: string; reason: string
  proposed_content: string; status: 'pending' | 'approved' | 'aborted'; final_content?: string
}

type TimelineItem =
  | { id: string; ts: number; type: 'msg'; payload: { content: string; authorName: string; authorType: string } }
  | { id: string; ts: number; type: 'decision'; payload: { decisionType: string; actorName: string | null } }
  | { id: string; ts: number; type: 'proposal'; payload: HandbookProposalPayload }

// ── Small panels ──────────────────────────────────────────────────────────────

function VideoPanel({ filename, onDismiss }: { filename: string; onDismiss: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-4">
      <Video size={40} className="text-gray-300" />
      <div>
        <p className="font-semibold text-gray-700">Video files aren't supported yet</p>
        <p className="text-sm text-gray-500 mt-1">We're working on transcription — check back soon!</p>
        <p className="text-xs text-gray-400 mt-2 font-mono">{filename}</p>
      </div>
      <button onClick={onDismiss} className="text-sm text-brand-600 hover:text-brand-700 font-medium">Dismiss</button>
    </div>
  )
}

function ErrorPanel({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-4">
      <AlertCircle size={40} className="text-red-400" />
      <div>
        <p className="font-semibold text-gray-700">Upload failed</p>
        <p className="text-sm text-red-500 mt-1">{message}</p>
      </div>
      <button onClick={onDismiss} className="text-sm text-brand-600 hover:text-brand-700 font-medium">Dismiss</button>
    </div>
  )
}

// ── Proposal card ─────────────────────────────────────────────────────────────

function ProposalCard({
  proposal, workspaceId, channelId, onOpenFile, showRaw,
}: {
  proposal: HandbookProposalPayload; workspaceId: string; channelId: string
  onOpenFile: (path: string) => void; showRaw: boolean
}) {
  const resolve = useResolveHandbookProposal(workspaceId, channelId)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(proposal.proposed_content)
  const pending = proposal.status === 'pending'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">Proposal from Knotwork Agent</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge(proposal.status)}`}>{proposal.status}</span>
      </div>
      <button onClick={() => onOpenFile(proposal.path)}
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800">
        <FileText size={14} />{proposal.path}
      </button>
      <p className="mt-1 text-sm text-gray-700">{proposal.reason}</p>

      {isEditing ? (
        <div className="mt-2 space-y-2">
          <textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)}
            rows={10} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-800" />
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'override_output', final_content: editedContent }); setIsEditing(false) }}
              disabled={!pending || resolve.isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs disabled:opacity-40">
              <Check size={12} />Save & approve
            </button>
            <button onClick={() => setIsEditing(false)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-2 text-xs text-gray-700 whitespace-pre-wrap max-h-44 overflow-y-auto">
          {proposal.final_content ?? proposal.proposed_content}
        </div>
      )}

      {showRaw && (
        <pre className="mt-2 rounded-lg border border-gray-200 bg-white p-2 text-[11px] text-gray-700 overflow-x-auto">
          {JSON.stringify(proposal, null, 2)}
        </pre>
      )}

      {pending && !isEditing && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={async () => { await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'accept_output' }) }}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs disabled:opacity-40">
            <Check size={12} />Approve
          </button>
          <button onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 text-xs">
            <SquarePen size={12} />Edit
          </button>
          <button
            onClick={async () => { await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'abort_run' }) }}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-700 bg-rose-50 text-xs disabled:opacity-40">
            <Ban size={12} />Abort
          </button>
        </div>
      )}
    </div>
  )
}

// ── Chat panel ────────────────────────────────────────────────────────────────

function HandbookChatPanel({
  workspaceId, channelId, onCreateChannel, onOpenFile,
}: {
  workspaceId: string; channelId: string | null
  onCreateChannel: () => void; onOpenFile: (path: string) => void
}) {
  const { data: messages = [], isLoading } = useChannelMessages(workspaceId, channelId ?? '')
  const { data: decisions = [] } = useChannelDecisions(workspaceId, channelId ?? '')
  const askHandbook = useAskHandbookChat(workspaceId, channelId ?? '')
  const [draft, setDraft] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [showOlder, setShowOlder] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const loadingOlderRef = useRef(false)

  // Build full timeline from messages + decisions
  const allTimeline = useMemo<TimelineItem[]>(() => {
    const msgItems: TimelineItem[] = messages.map((m) => ({
      id: `m-${m.id}`, ts: new Date(m.created_at).getTime(), type: 'msg',
      payload: { content: m.content, authorName: m.author_name ?? (m.author_type === 'human' ? 'You' : 'Agent'), authorType: m.author_type },
    }))
    const decisionItems: TimelineItem[] = decisions
      .filter((d) => d.decision_type !== 'handbook_proposal')
      .map((d) => ({
        id: `d-${d.id}`, ts: new Date(d.created_at).getTime(), type: 'decision' as const,
        payload: { decisionType: d.decision_type, actorName: d.actor_name },
      }))
    const proposalItems: TimelineItem[] = decisions
      .filter((d) => d.decision_type === 'handbook_proposal')
      .flatMap((d) => {
        const p = d.payload as Partial<HandbookProposalPayload>
        if (!p || typeof p.proposal_id !== 'string' || typeof p.path !== 'string') return []
        return [{
          id: `p-${d.id}`, ts: new Date(d.created_at).getTime(), type: 'proposal' as const,
          payload: {
            proposal_id: p.proposal_id, path: String(p.path ?? ''), reason: String(p.reason ?? ''),
            proposed_content: String(p.proposed_content ?? ''),
            status: (p.status as HandbookProposalPayload['status']) ?? 'pending',
            final_content: p.final_content ? String(p.final_content) : undefined,
          },
        }]
      })
    return [...msgItems, ...decisionItems, ...proposalItems].sort((a, b) => a.ts - b.ts)
  }, [messages, decisions])

  // 24h filter: always show at least MIN_RECENT items
  const cutoff = Date.now() - MS_24H
  const recentTimeline = allTimeline.filter((item) => item.ts >= cutoff)
  const defaultTimeline = recentTimeline.length >= MIN_RECENT ? recentTimeline : allTimeline.slice(-MIN_RECENT)
  const displayedTimeline = showOlder ? allTimeline : defaultTimeline
  const olderCount = allTimeline.length - displayedTimeline.length

  // Scroll: instant on first load, smooth on new messages, skip on load-older
  useEffect(() => {
    if (isLoading || displayedTimeline.length === 0) return
    if (!initializedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      initializedRef.current = true
      return
    }
    if (loadingOlderRef.current) { loadingOlderRef.current = false; return }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [isLoading, displayedTimeline.length])

  async function sendRequest() {
    if (askHandbook.isPending || !draft.trim() || !channelId) return
    await askHandbook.mutateAsync({ message: draft.trim() })
    setDraft('')
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <p className="text-xs text-gray-500">Ask the agent to create or edit handbook files.</p>
        <button onClick={() => setShowRaw((v) => !v)}
          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-gray-300">
          {showRaw ? 'Hide raw' : 'Debug'}
        </button>
      </div>

      {!channelId ? (
        <div className="p-4 flex-1">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-700">Create handbook chat channel to start.</p>
            <button onClick={onCreateChannel} className="mt-3 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">
              Create handbook chat
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <>
                {/* Load older */}
                {olderCount > 0 && (
                  <div className="flex justify-center">
                    <button
                      onClick={() => { loadingOlderRef.current = true; setShowOlder(true) }}
                      className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 py-1">
                      Load {olderCount} older message{olderCount !== 1 ? 's' : ''}
                    </button>
                  </div>
                )}

                {displayedTimeline.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No conversation yet.</p>
                ) : (
                  displayedTimeline.map((item) => {
                    if (item.type === 'msg') {
                      const mine = item.payload.authorType === 'human'
                      return (
                        <div key={item.id} className={`max-w-[92%] ${mine ? 'ml-auto' : 'mr-auto'}`}>
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{item.payload.authorName}</p>
                          <div className={`rounded-2xl px-3 py-2 text-sm border whitespace-pre-wrap ${
                            mine ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-800 border-gray-200'
                          }`}>{item.payload.content}</div>
                        </div>
                      )
                    }
                    if (item.type === 'decision') {
                      return (
                        <div key={item.id} className="max-w-[92%] mr-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-amber-700">Action</p>
                          <p className="text-sm text-amber-900">{decisionLabel(item.payload.decisionType)}</p>
                          {item.payload.actorName && <p className="text-[11px] text-amber-700 mt-1">by {item.payload.actorName}</p>}
                          {showRaw && <pre className="mt-2 text-[11px] overflow-x-auto text-amber-800">{JSON.stringify(item.payload, null, 2)}</pre>}
                        </div>
                      )
                    }
                    return (
                      <ProposalCard key={item.id} proposal={item.payload}
                        workspaceId={workspaceId} channelId={channelId}
                        onOpenFile={onOpenFile} showRaw={showRaw} />
                    )
                  })
                )}

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
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
              disabled={askHandbook.isPending}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.trim() && !askHandbook.isPending) {
                  e.preventDefault(); void sendRequest()
                }
              }}
              placeholder="Ask to create/edit/move handbook content… (⌘↵ to send)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 resize-none disabled:bg-gray-50 disabled:text-gray-500" />
            <div className="mt-2 flex justify-end">
              <button onClick={() => { void sendRequest() }}
                disabled={!draft.trim() || askHandbook.isPending}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HandbookPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: files = [], isLoading, error, refetch } = useKnowledgeFiles()
  const { data: channels = [] } = useChannels(workspaceId)
  const createChannel = useCreateChannel(workspaceId)

  const [rightPanel, setRightPanel] = useState<RightPanel>({ kind: 'empty' })
  const [leftTab, setLeftTab] = useState<'files' | 'chat'>('files')
  const [fileActionsOpen, setFileActionsOpen] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const { data: searchResults = [], isFetching: searching } = useSearchKnowledgeFiles(fileQuery)
  const uploadMutation = useUploadFile()
  const pageRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [pageDragOver, setPageDragOver] = useState(false)

  // Resizable panel
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_W)
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  function onDividerMouseDown(e: React.MouseEvent) {
    isDraggingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(ev: MouseEvent) {
      if (!isDraggingRef.current) return
      const newW = Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, startWidthRef.current + ev.clientX - startXRef.current))
      setPanelWidth(newW)
    }
    function onMouseUp() {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const handbookChannel = useMemo(() => channels.find((c) => c.channel_type === 'handbook') ?? null, [channels])
  const filteredFiles = useMemo(() => (!fileQuery.trim() ? files : searchResults), [files, fileQuery, searchResults])

  async function handleFileUpload(file: File, folder = '') {
    if (VIDEO_EXTS.has(getExt(file.name))) { setRightPanel({ kind: 'video', filename: file.name }); return }
    if (file.size > 10 * 1024 * 1024) { setRightPanel({ kind: 'error', message: 'File is too large (max 10 MB).' }); return }
    try {
      const preview = await uploadMutation.mutateAsync({ file, folder })
      setRightPanel({ kind: 'upload', preview, folder })
    } catch { setRightPanel({ kind: 'error', message: 'Upload failed. Please try again.' }) }
  }

  function handleSelectFile(file: KnowledgeFile) { setRightPanel({ kind: 'file', path: file.path }) }
  function handleOpenFileByPath(path: string) { setRightPanel({ kind: 'file', path }) }
  function handleNewFile(folder = '') { setRightPanel({ kind: 'new', folder }); setFileActionsOpen(false) }
  function handleFileCreated(path: string) { refetch(); setRightPanel({ kind: 'file', path }) }
  function handleUploadSaved(path: string) { refetch(); setRightPanel({ kind: 'file', path }) }

  async function handleDrop(e: React.DragEvent, folder = '') {
    e.preventDefault(); setPageDragOver(false)
    const file = e.dataTransfer.files[0]; if (!file) return
    await handleFileUpload(file, folder)
  }
  function onUploadInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    void handleFileUpload(file); e.target.value = ''; setFileActionsOpen(false)
  }

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) return <div className="p-8 text-red-500">Failed to load Handbook.</div>

  const selectedPath = rightPanel.kind === 'file' ? rightPanel.path : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          {([['files', BookOpen, 'Files'], ['chat', MessageSquare, 'Chat']] as const).map(([tab, Icon, label]) => (
            <button key={tab} onClick={() => setLeftTab(tab)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                leftTab === tab ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
        {rightPanel.kind !== 'empty' && (
          <button onClick={() => setRightPanel({ kind: 'empty' })}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:border-gray-300">
            <X size={14} />Close
          </button>
        )}
      </div>

      {/* Main */}
      <div ref={pageRef} className="relative flex flex-1 overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => { e.preventDefault(); setPageDragOver(true) }}
        onDragLeave={(e) => { if (!pageRef.current?.contains(e.relatedTarget as Node)) setPageDragOver(false) }}
        onDrop={(e) => { void handleDrop(e) }}>

        {pageDragOver && (
          <div className="absolute inset-0 z-50 bg-brand-50/90 flex flex-col items-center justify-center pointer-events-none border-2 border-dashed border-brand-400 m-2 rounded-xl gap-3">
            <Upload size={36} className="text-brand-500" />
            <p className="font-semibold text-brand-700 text-lg">Drop to convert & upload</p>
            <p className="text-sm text-brand-500">Documents: .md .txt .pdf .docx .doc .html .csv</p>
            <p className="text-sm text-brand-500">Images (AI vision): .jpg .png .gif .webp</p>
          </div>
        )}

        {/* Left panel — resizable */}
        <div style={{ width: panelWidth }} className="flex-shrink-0 bg-white flex flex-col overflow-hidden">
          {leftTab === 'files' ? (
            <>
              <div className="px-3 py-2.5 border-b border-gray-100 space-y-2 flex-shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={fileQuery} onChange={(e) => setFileQuery(e.target.value)}
                    placeholder="Search files…"
                    className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500" />
                  {searching && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
                </div>
                <div className="relative">
                  <button onClick={() => setFileActionsOpen((v) => !v)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-500 text-sm hover:border-brand-300 hover:text-brand-600 transition-colors">
                    <Plus size={14} />New / Upload
                  </button>
                  {fileActionsOpen && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-1">
                      <button onClick={() => handleNewFile('')}
                        className="w-full text-left text-sm px-3 py-2 rounded hover:bg-gray-50 flex items-center gap-2">
                        <FileText size={14} className="text-gray-400" />New file
                      </button>
                      <button onClick={() => uploadInputRef.current?.click()}
                        className="w-full text-left text-sm px-3 py-2 rounded hover:bg-gray-50 flex items-center gap-2">
                        <Upload size={14} className="text-gray-400" />Upload file
                      </button>
                    </div>
                  )}
                  <input ref={uploadInputRef} type="file" className="hidden" onChange={onUploadInputChange} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <FileTree files={filteredFiles} selectedPath={selectedPath}
                  onSelectFile={handleSelectFile} onNewFile={handleNewFile} onDrop={handleDrop} />
              </div>
            </>
          ) : (
            <HandbookChatPanel
              workspaceId={workspaceId}
              channelId={handbookChannel?.id ?? null}
              onCreateChannel={() => createChannel.mutate({ name: 'handbook-chat', channel_type: 'handbook' })}
              onOpenFile={handleOpenFileByPath}
            />
          )}
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onDividerMouseDown}
          className="w-1 flex-shrink-0 bg-gray-200 hover:bg-brand-400 active:bg-brand-500 transition-colors cursor-col-resize"
        />

        {/* Right: content */}
        <div className="flex-1 min-w-0 overflow-hidden bg-white">
          {rightPanel.kind === 'empty' && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <BookOpen size={36} className="text-gray-200" />
              <p className="text-sm text-gray-400">Select a file to view or edit</p>
            </div>
          )}
          {rightPanel.kind === 'file' && <FileEditor path={rightPanel.path} />}
          {rightPanel.kind === 'new' && (
            <NewFilePanel initialFolder={rightPanel.folder}
              onCreate={handleFileCreated} onCancel={() => setRightPanel({ kind: 'empty' })} />
          )}
          {rightPanel.kind === 'upload' && (
            <UploadPreviewPanel preview={rightPanel.preview}
              onSaved={handleUploadSaved} onCancel={() => setRightPanel({ kind: 'empty' })} />
          )}
          {rightPanel.kind === 'video' && <VideoPanel filename={rightPanel.filename} onDismiss={() => setRightPanel({ kind: 'empty' })} />}
          {rightPanel.kind === 'error' && <ErrorPanel message={rightPanel.message} onDismiss={() => setRightPanel({ kind: 'empty' })} />}
        </div>
      </div>
    </div>
  )
}
