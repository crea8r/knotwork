import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Copy, Globe, MessageSquare, Plus } from 'lucide-react'
import Breadcrumb from '@/components/handbook/Breadcrumb'
import type { Graph } from '@/types'

export default function WorkflowHeader({
  workspaceId, graph, defaultVersionIsPublic, showChat, onToggleChat, renamePending, onRename,
}: {
  workspaceId: string
  graph: Graph
  defaultVersionIsPublic: boolean
  showChat: boolean
  onToggleChat: () => void
  renamePending: boolean
  onRename: (name: string) => void
}) {
  void workspaceId
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const graphLinkUrl = (graph.slug && defaultVersionIsPublic)
    ? `${window.location.origin}/public/workflows/${graph.slug}`
    : null

  function copyGraphLink() {
    if (!graphLinkUrl) return
    void navigator.clipboard.writeText(graphLinkUrl)
    setCopied(true); setTimeout(() => setCopied(false), 1600)
  }

  function openNew(kind: 'file' | 'folder' | 'workflow' | 'upload') {
    const params = new URLSearchParams()
    if (graph.path) params.set('folder', graph.path)
    params.set('new', kind)
    navigate(`/handbook?${params.toString()}`)
    setMenuOpen(false)
  }

  return (
    <div className="border-b border-gray-100 bg-white px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumb
            path={graph.path}
            onNavigate={(p) => navigate(p ? `/handbook?folder=${encodeURIComponent(p)}` : '/handbook')}
            file={graph.name} fileType="workflow"
            renamePending={renamePending}
            onRenameFile={onRename}
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700">
              <Plus size={14} /><span className="hidden md:inline">New</span><ChevronDown size={13} className="hidden md:inline" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                {(['file', 'folder', 'workflow', 'upload'] as const).map((kind) => (
                  <button key={kind} onClick={() => openNew(kind)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                    {kind === 'file' ? 'New File' : kind === 'folder' ? 'New Folder' : kind === 'workflow' ? 'New Workflow' : 'Upload'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onToggleChat}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${showChat ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
          >
            <MessageSquare size={14} /><span className="hidden md:inline">Chat</span>
          </button>
        </div>
      </div>

      {graphLinkUrl && (
        <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
          <Globe size={11} className="flex-shrink-0 text-purple-500" />
          <a href={graphLinkUrl} target="_blank" rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-xs font-mono text-purple-600 hover:underline">
            {graphLinkUrl}
          </a>
          <button onClick={copyGraphLink} className="flex-shrink-0 text-xs text-purple-500 hover:text-purple-800">
            {copied ? 'Copied' : <Copy size={11} />}
          </button>
        </div>
      )}
    </div>
  )
}
