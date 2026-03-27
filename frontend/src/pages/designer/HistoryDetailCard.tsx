import { Archive, Copy, FileEdit, Globe, MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Badge from '@/components/shared/Badge'
import Btn from '@/components/shared/Btn'
import type { GraphVersion } from '@/types'
import { formatVersionStamp } from './graphVersionUtils'

export default function HistoryDetailCard({
  graphSlug, version, graphDefaultVersionId,
  isActiveDraftBase, isPending,
  onSetDefault, onFork, onArchive, onUnarchive, onDelete, onManagePublic, onEdit,
}: {
  graphSlug: string | null
  version: GraphVersion
  graphDefaultVersionId: string | null
  isActiveDraftBase: boolean
  isPending: boolean
  onSetDefault: (v: GraphVersion) => void
  onFork: (v: GraphVersion) => void
  onArchive: (v: GraphVersion) => void
  onUnarchive: (v: GraphVersion) => void
  onDelete: (v: GraphVersion) => void
  onManagePublic: (v: GraphVersion) => void
  onEdit: (v: GraphVersion) => void
}) {
  const isDefault = graphDefaultVersionId === version.id
  const isArchived = !!version.archived_at
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  function openMenu() {
    const r = menuBtnRef.current?.getBoundingClientRect()
    if (r) setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    setMenuOpen(true)
  }

  const publicUrl = (graphSlug && version.version_slug)
    ? `${window.location.origin}/public/workflows/${graphSlug}/${version.version_slug}`
    : null

  const [copied, setCopied] = useState(false)
  function copyLink() {
    if (!publicUrl) return
    void navigator.clipboard.writeText(publicUrl)
    setCopied(true); setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="space-y-3">
      {/* Badges + meta */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isDefault && <Badge variant="green">Default</Badge>}
        {isActiveDraftBase && version.draft && <Badge variant="orange">Draft active</Badge>}
        {isArchived && <Badge variant="gray">Archived</Badge>}
        <span className="text-xs text-gray-400">
          {formatVersionStamp(version.version_created_at)} · {version.run_count} run(s)
        </span>
      </div>

      {/* Public link URL */}
      {publicUrl && (
        <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
          <Globe size={13} className="flex-shrink-0 text-purple-500" />
          <a href={publicUrl} target="_blank" rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-xs text-purple-700 hover:underline font-mono">
            {publicUrl}
          </a>
          <button onClick={copyLink} className="flex-shrink-0 text-xs text-purple-600 hover:text-purple-800">
            {copied ? 'Copied' : <Copy size={12} />}
          </button>
        </div>
      )}

      {/* Primary actions */}
      <div className="flex items-center gap-2">
        {!version.draft && (
          <Btn size="sm" variant="primary" disabled={isPending} onClick={() => onEdit(version)}>
            <FileEdit size={12} /> Edit
          </Btn>
        )}
        <Btn size="sm" variant={isDefault ? 'ghost' : 'secondary'} disabled={isPending || isDefault} onClick={() => onSetDefault(version)}>
          <Star size={12} /> Default
        </Btn>
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onManagePublic(version)}>
          <Globe size={12} /> {version.version_slug ? 'Edit public link' : 'Make public'}
        </Btn>
        <button ref={menuBtnRef} disabled={isPending} className="ml-auto inline-flex items-center rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50" onClick={openMenu}>
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && menuPos && createPortal(
          <>
            <div className="fixed inset-0 z-[40]" onClick={() => setMenuOpen(false)} />
            <div className="fixed z-[41] w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
              style={{ top: menuPos.top, right: menuPos.right }}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50" onClick={() => { onFork(version); setMenuOpen(false) }}>
                <Copy size={13} /> Clone workflow
              </button>
              {isArchived
                ? <button className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50" onClick={() => { onUnarchive(version); setMenuOpen(false) }}>Unarchive</button>
                : <button className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50" onClick={() => { onArchive(version); setMenuOpen(false) }}>
                    <Archive size={13} /> Archive
                  </button>
              }
              <button className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50" onClick={() => { onDelete(version); setMenuOpen(false) }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </>,
          document.body
        )}
      </div>
    </div>
  )
}
