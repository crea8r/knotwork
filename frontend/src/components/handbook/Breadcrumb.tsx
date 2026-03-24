/**
 * Breadcrumb — Windows-Explorer-style path navigation.
 * e.g.  Home > legal > compliance
 */
import { useRef, useState } from 'react'
import { ChevronRight, File, FileText, FileType2, GitBranch, Home, Image, Loader2, Pencil } from 'lucide-react'

interface Props {
  /** Current folder path, e.g. "legal/compliance". Empty = root. */
  path: string
  onNavigate: (path: string) => void
  /** Optional file name appended as a non-clickable last segment. */
  file?: string
  fileType?: string
  onRenameFile?: (newName: string) => void
  onRenameFolder?: (newName: string) => void
  renamePending?: boolean
}

export default function Breadcrumb({
  path, onNavigate, file, fileType, onRenameFile, onRenameFolder, renamePending = false,
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
    <nav className="flex items-center gap-1 text-sm text-gray-500 overflow-x-auto min-w-0 py-1">
      <button
        onClick={() => onNavigate('')}
        className="flex items-center gap-1 hover:text-gray-800 transition-colors flex-shrink-0"
      >
        <Home size={13} />
        <span className="text-xs">Home</span>
      </button>
      {segments.map((seg, i) => {
        const segPath = segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1 && !file
        return (
          <span key={segPath} className="flex items-center gap-1 flex-shrink-0">
            <ChevronRight size={12} className="text-gray-300" />
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
                  className="min-w-28 border-b border-brand-400 bg-transparent text-xs font-medium text-gray-800 outline-none"
                />
              ) : (
                <span className="text-xs font-medium text-gray-800">{seg}</span>
              )
            ) : (
              <button onClick={() => onNavigate(segPath)} className="text-xs hover:text-gray-800 transition-colors">
                {seg}
              </button>
            )}
          </span>
        )
      })}
      {file && (
        <span className="flex items-center gap-1 flex-shrink-0">
          <ChevronRight size={12} className="text-gray-300" />
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
              className="min-w-32 border-b border-brand-400 bg-transparent text-xs font-medium text-gray-800 outline-none"
            />
          ) : (
            <>
              <FileTypeIcon kind={fileType} />
              <span className="text-xs font-medium text-gray-800">{file}</span>
            </>
          )}
        </span>
      )}
      {canRename && !isEditing && (
        <button
          disabled={renamePending}
          onClick={() => setIsEditing(true)}
          className="ml-1 flex items-center justify-center rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          title={`Rename ${file ? 'file' : 'folder'}`}
        >
          {renamePending ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
        </button>
      )}
    </nav>
  )
}
