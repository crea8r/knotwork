/**
 * HandbookPage — chat-first handbook workspace.
 * Users ask the handbook agent to make changes, then open files to validate.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Ban,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
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
  proposal_id: string
  path: string
  reason: string
  proposed_content: string
  status: 'pending' | 'approved' | 'aborted'
  final_content?: string
}

type TimelineItem =
  | {
      id: string
      ts: number
      type: 'msg'
      payload: { content: string; authorName: string; authorType: string }
    }
  | {
      id: string
      ts: number
      type: 'decision'
      payload: { decisionType: string; actorName: string | null }
    }
  | {
      id: string
      ts: number
      type: 'proposal'
      payload: HandbookProposalPayload
    }

function VideoPanel({ filename, onDismiss }: { filename: string; onDismiss: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-4">
      <Video size={40} className="text-gray-300" />
      <div>
        <p className="font-semibold text-gray-700">Video files aren't supported yet</p>
        <p className="text-sm text-gray-500 mt-1">We're working on transcription - check back soon!</p>
        <p className="text-xs text-gray-400 mt-2 font-mono">{filename}</p>
      </div>
      <button onClick={onDismiss} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
        Dismiss
      </button>
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
      <button onClick={onDismiss} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
        Dismiss
      </button>
    </div>
  )
}

function ProposalCard({
  proposal,
  workspaceId,
  channelId,
  onOpenFile,
  showRaw,
}: {
  proposal: HandbookProposalPayload
  workspaceId: string
  channelId: string
  onOpenFile: (path: string) => void
  showRaw: boolean
}) {
  const resolve = useResolveHandbookProposal(workspaceId, channelId)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(proposal.proposed_content)
  const pending = proposal.status === 'pending'

  async function approveAsIs() {
    await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'accept_output' })
  }

  async function approveEdited() {
    await resolve.mutateAsync({
      proposalId: proposal.proposal_id,
      resolution: 'override_output',
      final_content: editedContent,
    })
    setIsEditing(false)
  }

  async function abortProposal() {
    await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'abort_run' })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">Proposal from Knotwork Agent</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge(proposal.status)}`}>{proposal.status}</span>
      </div>
      <button
        onClick={() => onOpenFile(proposal.path)}
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        <FileText size={14} />
        {proposal.path}
      </button>
      <p className="mt-1 text-sm text-gray-700">{proposal.reason}</p>

      {isEditing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            rows={10}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-800"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void approveEdited()
              }}
              disabled={!pending || resolve.isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs disabled:opacity-40"
            >
              <Check size={12} />
              Save & approve
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700"
            >
              Cancel edit
            </button>
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
            onClick={() => {
              void approveAsIs()
            }}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs disabled:opacity-40"
          >
            <Check size={12} />
            Approve
          </button>
          <button
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 text-xs"
          >
            <SquarePen size={12} />
            Edit
          </button>
          <button
            onClick={() => {
              void abortProposal()
            }}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-700 bg-rose-50 text-xs disabled:opacity-40"
          >
            <Ban size={12} />
            Abort
          </button>
        </div>
      )}
    </div>
  )
}

function HandbookChatPanel({
  workspaceId,
  channelId,
  onCreateChannel,
  onOpenFile,
}: {
  workspaceId: string
  channelId: string | null
  onCreateChannel: () => void
  onOpenFile: (path: string) => void
}) {
  const { data: messages = [], isLoading } = useChannelMessages(workspaceId, channelId ?? '')
  const { data: decisions = [] } = useChannelDecisions(workspaceId, channelId ?? '')
  const askHandbook = useAskHandbookChat(workspaceId, channelId ?? '')

  const [draft, setDraft] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  async function sendRequest() {
    if (askHandbook.isPending) return
    const request = draft.trim()
    if (!request || !channelId) return
    await askHandbook.mutateAsync({ message: request })
    setDraft('')
  }

  const timeline = useMemo<TimelineItem[]>(() => {
    const msgItems: TimelineItem[] = messages.map((m) => ({
      id: `m-${m.id}`,
      ts: new Date(m.created_at).getTime(),
      type: 'msg',
      payload: {
        content: m.content,
        authorName: m.author_name ?? (m.author_type === 'human' ? 'You' : 'Agent'),
        authorType: m.author_type,
      },
    }))

    const decisionItems: TimelineItem[] = decisions
      .filter((d) => d.decision_type !== 'handbook_proposal')
      .map((d) => ({
        id: `d-${d.id}`,
        ts: new Date(d.created_at).getTime(),
        type: 'decision' as const,
        payload: {
          decisionType: d.decision_type,
          actorName: d.actor_name,
        },
      }))

    const proposalItems: TimelineItem[] = decisions
      .filter((d) => d.decision_type === 'handbook_proposal')
      .flatMap((d) => {
        const p = d.payload as Partial<HandbookProposalPayload>
        if (!p || typeof p.proposal_id !== 'string' || typeof p.path !== 'string') return []
        return [
          {
            id: `p-${d.id}`,
            ts: new Date(d.created_at).getTime(),
            type: 'proposal' as const,
            payload: {
              proposal_id: p.proposal_id,
              path: String(p.path ?? ''),
              reason: String(p.reason ?? ''),
              proposed_content: String(p.proposed_content ?? ''),
              status: (p.status as HandbookProposalPayload['status']) ?? 'pending',
              final_content: p.final_content ? String(p.final_content) : undefined,
            },
          },
        ]
      })

    return [...msgItems, ...decisionItems, ...proposalItems].sort((a, b) => a.ts - b.ts)
  }, [messages, decisions])

  return (
    <div className="h-full flex flex-col bg-[#f7f8fb]">
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Handbook Chat</p>
          <p className="text-xs text-gray-500">Ask the agent to create or edit handbook files, then open files to validate.</p>
        </div>
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:border-gray-300"
        >
          {showRaw ? 'Hide raw' : 'Debug raw'}
        </button>
      </div>

      {!channelId ? (
        <div className="p-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-700">Create handbook chat channel to start.</p>
            <button onClick={onCreateChannel} className="mt-3 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">
              Create handbook chat
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner size="lg" />
              </div>
            ) : timeline.length === 0 ? (
              <p className="text-sm text-gray-500">No conversation yet.</p>
            ) : (
              timeline.map((item) => {
                if (item.type === 'msg') {
                  const mine = item.payload.authorType === 'human'
                  return (
                    <div key={item.id} className={`max-w-[92%] ${mine ? 'ml-auto' : 'mr-auto'}`}>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{item.payload.authorName}</p>
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm border whitespace-pre-wrap ${
                          mine ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-800 border-gray-200'
                        }`}
                      >
                        {item.payload.content}
                      </div>
                    </div>
                  )
                }

                if (item.type === 'decision') {
                  return (
                    <div key={item.id} className="max-w-[92%] mr-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-amber-700">Action</p>
                      <p className="text-sm text-amber-900">{decisionLabel(item.payload.decisionType)}</p>
                      {item.payload.actorName && <p className="text-[11px] text-amber-700 mt-1">by {item.payload.actorName}</p>}
                      {showRaw && (
                        <pre className="mt-2 text-[11px] overflow-x-auto text-amber-800">{JSON.stringify(item.payload, null, 2)}</pre>
                      )}
                    </div>
                  )
                }

                return (
                  <ProposalCard
                    key={item.id}
                    proposal={item.payload}
                    workspaceId={workspaceId}
                    channelId={channelId}
                    onOpenFile={onOpenFile}
                    showRaw={showRaw}
                  />
                )
              })
            )}

            {askHandbook.isPending && (
              <div className="max-w-[92%] mr-auto">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Knotwork Agent</p>
                <div className="rounded-2xl px-3 py-2 text-sm border bg-white text-gray-700 border-gray-200 inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Agent is thinking...
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 bg-white p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.trim() && !askHandbook.isPending) {
                  e.preventDefault()
                  void sendRequest()
                }
              }}
              rows={3}
              disabled={askHandbook.isPending}
              placeholder="Ask to create/edit/move/split handbook content... (Ctrl/Cmd + Enter to send)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 resize-y disabled:bg-gray-50 disabled:text-gray-500"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500">Ctrl/Cmd + Enter to send</p>
              <button
                onClick={() => {
                  void sendRequest()
                }}
                disabled={!draft.trim() || askHandbook.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm disabled:opacity-40"
              >
                {askHandbook.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {askHandbook.isPending ? 'Thinking...' : 'Send'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function HandbookPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: files = [], isLoading, error, refetch } = useKnowledgeFiles()
  const { data: channels = [] } = useChannels(workspaceId)
  const createChannel = useCreateChannel(workspaceId)

  const [rightPanel, setRightPanel] = useState<RightPanel>({ kind: 'empty' })
  const [filesOpen, setFilesOpen] = useState(false)
  const [fileActionsOpen, setFileActionsOpen] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const { data: searchResults = [], isFetching: searching } = useSearchKnowledgeFiles(fileQuery)

  const uploadMutation = useUploadFile()
  const pageRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [pageDragOver, setPageDragOver] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)')
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const handbookChannel = useMemo(
    () => channels.find((c) => c.channel_type === 'handbook') ?? null,
    [channels],
  )

  const filteredFiles = useMemo(() => {
    if (!fileQuery.trim()) return files
    return searchResults
  }, [files, fileQuery, searchResults])

  async function handleFileUpload(file: File, folder = '') {
    if (VIDEO_EXTS.has(getExt(file.name))) {
      setRightPanel({ kind: 'video', filename: file.name })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setRightPanel({ kind: 'error', message: 'File is too large (max 10 MB).' })
      return
    }
    try {
      const preview = await uploadMutation.mutateAsync({ file, folder })
      setRightPanel({ kind: 'upload', preview, folder })
    } catch {
      setRightPanel({ kind: 'error', message: 'Upload failed. Please try again.' })
    }
  }

  function handleSelectFile(file: KnowledgeFile) {
    setRightPanel({ kind: 'file', path: file.path })
    if (isMobile) {
      setFilesOpen(false)
    } else {
      const searchingActive = fileQuery.trim().length > 0
      setFilesOpen(searchingActive)
    }
  }

  function handleOpenFileByPath(path: string) {
    setRightPanel({ kind: 'file', path })
    if (isMobile) {
      setFilesOpen(false)
    } else {
      const searchingActive = fileQuery.trim().length > 0
      setFilesOpen(searchingActive)
    }
  }

  function handleNewFile(folder = '') {
    setRightPanel({ kind: 'new', folder })
    setFileActionsOpen(false)
    setFilesOpen(false)
  }

  function handleFileCreated(path: string) {
    refetch()
    setRightPanel({ kind: 'file', path })
    if (!isMobile && fileQuery.trim()) {
      setFilesOpen(true)
    }
  }

  function handleUploadSaved(path: string) {
    refetch()
    setRightPanel({ kind: 'file', path })
    if (!isMobile && fileQuery.trim()) {
      setFilesOpen(true)
    }
  }

  async function handleDrop(e: React.DragEvent, folder = '') {
    e.preventDefault()
    setPageDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    await handleFileUpload(file, folder)
  }

  function onUploadInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void handleFileUpload(file)
    e.target.value = ''
    setFileActionsOpen(false)
    setFilesOpen(false)
  }

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) return <div className="p-8 text-red-500">Failed to load Handbook.</div>

  const selectedPath = rightPanel.kind === 'file' ? rightPanel.path : null
  const focusOnly = rightPanel.kind === 'new' || rightPanel.kind === 'upload' || rightPanel.kind === 'video' || rightPanel.kind === 'error'
  const fileOpened = rightPanel.kind === 'file'
  const searchingActive = fileQuery.trim().length > 0
  const mobileFilesTakeover = !focusOnly && isMobile && filesOpen

  const showChat = !focusOnly && !mobileFilesTakeover && !(isMobile && fileOpened)
  const showFilePane = rightPanel.kind !== 'empty' && !focusOnly && !mobileFilesTakeover
  const showFileTree = !focusOnly && (mobileFilesTakeover || (!isMobile && (filesOpen || (fileOpened && searchingActive))))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!focusOnly && (
        <div className="border-b border-gray-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilesOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-brand-300 text-sm"
            >
              <BookOpen size={14} />
              {showFileTree ? 'Hide files' : 'Show files'}
            </button>
            <div className="relative flex-1 max-w-xl">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={fileQuery}
                onChange={(e) => {
                  const next = e.target.value
                  setFileQuery(next)
                  if (next.trim()) setFilesOpen(true)
                }}
                onFocus={() => {
                  if (isMobile) setFilesOpen(true)
                }}
                placeholder="Full-text search files..."
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
              {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
            </div>
            {showFilePane && (
              <button
                onClick={() => setRightPanel({ kind: 'empty' })}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-sm"
              >
                <X size={14} />
                Close file
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={pageRef}
        className="relative flex flex-1 overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => {
          e.preventDefault()
          setPageDragOver(true)
        }}
        onDragLeave={(e) => {
          if (!pageRef.current?.contains(e.relatedTarget as Node)) setPageDragOver(false)
        }}
        onDrop={(e) => {
          void handleDrop(e)
        }}
      >
        {pageDragOver && (
          <div className="absolute inset-0 z-50 bg-brand-50/90 flex flex-col items-center justify-center pointer-events-none border-2 border-dashed border-brand-400 m-2 rounded-xl gap-3">
            <Upload size={36} className="text-brand-500" />
            <p className="font-semibold text-brand-700 text-lg">Drop to convert & upload</p>
            <p className="text-sm text-brand-500">Documents: .md .txt .pdf .docx .doc .html .csv</p>
            <p className="text-sm text-brand-500">Images (AI vision): .jpg .png .gif .webp</p>
          </div>
        )}

        {showFileTree && (
          <div className={`${isMobile ? 'w-full h-full' : 'w-72 flex-shrink-0 border-r'} border-gray-200 bg-white overflow-y-auto`}>
            <div className="px-2 py-2 border-b border-gray-100 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Files</p>
              <div className="relative">
                <button
                  onClick={() => setFileActionsOpen((v) => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-700"
                >
                  New / Upload
                  {fileActionsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {fileActionsOpen && (
                  <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-1">
                    <button
                      onClick={() => handleNewFile('')}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-gray-50"
                    >
                      New file
                    </button>
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-gray-50"
                    >
                      Upload file
                    </button>
                  </div>
                )}
                <input
                  ref={uploadInputRef}
                  type="file"
                  className="hidden"
                  onChange={onUploadInputChange}
                />
              </div>
            </div>
            <div className="p-2">
              <FileTree
                files={filteredFiles}
                selectedPath={selectedPath}
                onSelectFile={handleSelectFile}
                onNewFile={handleNewFile}
                onDrop={handleDrop}
              />
            </div>
          </div>
        )}

        {showChat && (
          <div className={`min-w-0 ${showFilePane && !isMobile ? 'w-[55%] border-r border-gray-200' : 'flex-1'}`}>
            <HandbookChatPanel
              workspaceId={workspaceId}
              channelId={handbookChannel?.id ?? null}
              onCreateChannel={() => createChannel.mutate({ name: 'handbook-chat', channel_type: 'handbook' })}
              onOpenFile={handleOpenFileByPath}
            />
          </div>
        )}

        {showFilePane && (
          <div className={`${showChat ? 'flex-1' : 'w-full'} min-w-0 bg-white overflow-hidden`}>
            {rightPanel.kind === 'file' && <FileEditor path={rightPanel.path} />}
          </div>
        )}

        {focusOnly && (
          <div className="w-full h-full bg-white overflow-hidden">
            <div className="border-b border-gray-200 px-3 py-2 bg-white flex items-center justify-between">
              <p className="text-sm font-medium text-gray-800">{rightPanel.kind === 'new' ? 'New file' : rightPanel.kind === 'upload' ? 'Upload preview' : 'File action'}</p>
              <button
                onClick={() => setRightPanel({ kind: 'empty' })}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-sm"
              >
                <X size={14} />
                Close
              </button>
            </div>
            {rightPanel.kind === 'new' && (
              <NewFilePanel
                initialFolder={rightPanel.folder}
                onCreate={handleFileCreated}
                onCancel={() => setRightPanel({ kind: 'empty' })}
              />
            )}
            {rightPanel.kind === 'upload' && (
              <UploadPreviewPanel
                preview={rightPanel.preview}
                onSaved={handleUploadSaved}
                onCancel={() => setRightPanel({ kind: 'empty' })}
              />
            )}
            {rightPanel.kind === 'video' && <VideoPanel filename={rightPanel.filename} onDismiss={() => setRightPanel({ kind: 'empty' })} />}
            {rightPanel.kind === 'error' && <ErrorPanel message={rightPanel.message} onDismiss={() => setRightPanel({ kind: 'empty' })} />}
          </div>
        )}
      </div>
    </div>
  )
}
