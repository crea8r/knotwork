/**
 * FileContextMenu — right-click context menu for files and folders.
 * Mirrors Windows Explorer: New File, New Folder, Rename, Move To, Delete.
 */
import { useEffect, useRef } from 'react'
import { FilePlus, FolderPlus, GitBranch, Pencil, FolderInput, Trash2 } from 'lucide-react'

export type ContextTarget =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'workflow'; path: string; graphId: string }

interface Props {
  target: ContextTarget
  x: number
  y: number
  onClose: () => void
  onNewFile: (folder: string) => void
  onNewWorkflow: (folder: string) => void
  onNewFolder: (parentPath: string) => void
  onRename: (target: ContextTarget) => void
  onMoveTo: (target: ContextTarget) => void
  onDelete: (target: ContextTarget) => void
  hideRename?: boolean
  hideMoveTo?: boolean
  hideDelete?: boolean
  disableMoveTo?: boolean
  disableMoveToReason?: string
  disableDelete?: boolean
  disableDeleteReason?: string
}

interface MenuItem {
  icon: React.ReactNode
  label: string
  danger?: boolean
  disabled?: boolean
  helperText?: string
  onClick: () => void
}

export default function FileContextMenu({
  target, x, y, onClose,
  onNewFile, onNewWorkflow, onNewFolder, onRename, onMoveTo, onDelete,
  hideRename = false,
  hideMoveTo = false, hideDelete = false,
  disableMoveTo = false, disableMoveToReason,
  disableDelete = false, disableDeleteReason,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const folder = target.kind === 'folder' ? target.path : target.path.split('/').slice(0, -1).join('/')

  const items: MenuItem[] = [
    {
      icon: <FilePlus size={13} />,
      label: 'New File',
      onClick: () => { onNewFile(folder); onClose() },
    },
    {
      icon: <FolderPlus size={13} />,
      label: 'New Folder',
      onClick: () => { onNewFolder(folder); onClose() },
    },
    {
      icon: <GitBranch size={13} />,
      label: 'New Workflow',
      onClick: () => { onNewWorkflow(folder); onClose() },
    },
  ]

  if (!hideRename) {
    items.push({
      icon: <Pencil size={13} />,
      label: 'Rename',
      onClick: () => { onRename(target); onClose() },
    })
  }

  if (!hideMoveTo) {
    items.push({
      icon: <FolderInput size={13} />,
      label: 'Move To…',
      disabled: disableMoveTo,
      helperText: disableMoveToReason,
      onClick: () => { onMoveTo(target); onClose() },
    })
  }

  if (!hideDelete) {
    items.push({
      icon: <Trash2 size={13} />,
      label: target.kind === 'workflow' ? 'Archive / Delete' : 'Delete',
      danger: true,
      disabled: disableDelete,
      helperText: disableDeleteReason,
      onClick: () => { onDelete(target); onClose() },
    })
  }

  // Clamp menu to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, window.innerHeight - 200),
    zIndex: 1000,
  }

  return (
    <div
      ref={ref}
      style={style}
      className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] text-sm"
    >
      {items.map((item, i) => (
        <div key={i}>
          <button
            onClick={item.disabled ? undefined : item.onClick}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed ${
              item.disabled
                ? 'text-gray-300'
                : item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
          {item.helperText && (
            <p className="px-3 pb-1.5 text-[11px] text-amber-600">
              {item.helperText}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
