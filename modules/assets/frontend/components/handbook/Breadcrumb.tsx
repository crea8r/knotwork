/**
 * Breadcrumb — Windows-Explorer-style path navigation.
 * e.g.  Project Alpha > legal > compliance
 */
import { useRef, useState, type ReactNode } from 'react'
import { ChevronRight, File, FileText, FileType2, GitBranch, Image, Loader2, Pencil } from 'lucide-react'

interface Props {
  /** Current folder path, e.g. "legal/compliance". Empty = root. */
  path: string
  rootLabel?: string
  onNavigate: (path: string) => void
  /** Optional file name appended as a non-clickable last segment. */
  file?: string
  fileType?: string
  onRenameFile?: (newName: string) => void
  onRenameFolder?: (newName: string) => void
  renamePending?: boolean
  afterCurrent?: ReactNode
}

export default function Breadcrumb({
  path, rootLabel = 'Knowledge', onNavigate, file, fileType, onRenameFile, onRenameFolder, renamePending = false,
  afterCurrent,
}: Props) {
  const segments = path ? path.split('/').filter(Boolean) : []
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentLabel = file ?? (segments.length ? segments[segments.length - 1] : '')
  const canRename = Boolean(file ? onRenameFile : segments.length ? onRenameFolder : null)

  function submitRename(nextName: string) {
    const trimmed = nextName.trim()
    setIsEditing(false)
    if (!trimmed || trimmed === currentLabel) return
    if (file) onRenameFile?.(trimmed)
    else onRenameFolder?.(trimmed)
  }

  function FileTypeIcon({ kind }: { kind?: string }) {
    if (kind === 'workflow') return <GitBranch size={12} className="text-brand-500 flex-shrink-0" />
    if (kind === 'pdf') return <FileText size={12} className="text-red-400 flex-shrink-0" />
    if (kind === 'docx') return <FileType2 size={12} className="text-blue-400 flex-shrink-0" />
    if (kind === 'image') return <Image size={12} className="text-purple-400 flex-shrink-0" />
    return <File size={12} className="text-gray-400 flex-shrink-0" />
  }

  return (
    <nav data-ui="shell.asset.breadcrumb" className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap py-1 text-sm leading-5 text-stone-500">
      <button
        onClick={() => onNavigate('')}
        data-ui="shell.asset.breadcrumb.home"
        className="min-w-0 shrink truncate transition-colors hover:text-stone-800"
        title={rootLabel}
      >
        <span className="block truncate">{rootLabel}</span>
      </button>
      {segments.map((seg, i) => {
        const segPath = segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1 && !file
        return (
          <span key={segPath} className="flex min-w-0 shrink items-center gap-1">
            <ChevronRight size={13} className="shrink-0 text-stone-300" />
            {isLast ? (
              isEditing ? (
                <input
                  ref={inputRef}
                  autoFocus
                  defaultValue={seg}
                  onBlur={e => submitRename(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitRename(inputRef.current?.value ?? seg)
                    }
                    if (e.key === 'Escape') setIsEditing(false)
                  }}
                  className="min-w-28 border-b border-brand-400 bg-transparent text-sm font-medium leading-5 text-stone-800 outline-none"
                />
              ) : (
                <span className="block min-w-0 truncate text-sm font-medium leading-5 text-stone-800" title={seg}>{seg}</span>
              )
            ) : (
              <button onClick={() => onNavigate(segPath)} className="min-w-0 truncate text-sm leading-5 transition-colors hover:text-stone-800" title={seg}>
                {seg}
              </button>
            )}
          </span>
        )
      })}
      {file && (
        <span className="flex min-w-0 shrink items-center gap-1">
          <ChevronRight size={13} className="shrink-0 text-stone-300" />
          {isEditing ? (
            <input
              ref={inputRef}
              autoFocus
              defaultValue={file}
              onBlur={e => submitRename(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename(inputRef.current?.value ?? file)
                }
                if (e.key === 'Escape') setIsEditing(false)
              }}
              className="min-w-32 border-b border-brand-400 bg-transparent text-sm font-medium leading-5 text-stone-800 outline-none"
            />
          ) : (
            <>
              <FileTypeIcon kind={fileType} />
              <span className="block min-w-0 truncate text-sm font-medium leading-5 text-stone-800" title={file}>{file}</span>
            </>
          )}
        </span>
      )}
      {canRename && !isEditing && (
        <button
          disabled={renamePending}
          onClick={() => setIsEditing(true)}
          data-ui="shell.asset.breadcrumb.rename"
          className="ml-1 flex items-center justify-center rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
          title={`Rename ${file ? 'file' : 'folder'}`}
        >
          {renamePending ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
        </button>
      )}
      {afterCurrent ? <span data-ui="shell.asset.breadcrumb.trailing" className="flex shrink-0 items-center gap-1">{afterCurrent}</span> : null}
    </nav>
  )
}
