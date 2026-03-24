/**
 * MoveToDialog — mobile-friendly folder picker for Move To action.
 */
import { useState } from 'react'
import { ChevronRight, Folder, FolderOpen, X } from 'lucide-react'
import { useKnowledgeFiles } from '@/api/knowledge'
import { useKnowledgeFolders } from '@/api/folders'
import Btn from '@/components/shared/Btn'
import { collectFolderPaths } from './FileTreeNodes'

interface FolderTree {
  name: string
  path: string
  children: FolderTree[]
}

function buildFolderTree(paths: string[]): FolderTree {
  const home: FolderTree = { name: 'Home', path: '', children: [] }
  const map: Record<string, FolderTree> = { '': home }

  for (const p of paths) {
    const parts = p.split('/').filter(Boolean)
    map[p] = { name: parts[parts.length - 1], path: p, children: [] }
  }
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean)
    const parentPath = parts.slice(0, -1).join('/')
    const parent = map[parentPath] ?? home
    parent.children.push(map[p])
  }

  function sortTree(node: FolderTree) {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of node.children) sortTree(child)
  }

  sortTree(home)
  return home
}

function FolderNode({
  node, selected, onSelect, depth, movingTargetKind, movingTargetPath,
}: {
  node: FolderTree; selected: string; onSelect: (path: string) => void; depth: number
  movingTargetKind?: 'file' | 'folder' | 'workflow'
  movingTargetPath?: string
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = node.children.length > 0
  const isSelected = node.path === selected
  const isDisabled = movingTargetKind === 'folder' && movingTargetPath
    ? node.path === movingTargetPath || node.path.startsWith(`${movingTargetPath}/`)
    : false

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 text-sm rounded-lg transition-colors ${
          isDisabled
            ? 'text-gray-300'
            : isSelected ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-gray-100 text-gray-700'
        }`}
        style={{ paddingLeft: depth * 16 + 4 }}
      >
        {/* Chevron — only shown if has children */}
        <span className="flex-shrink-0 w-5 flex items-center justify-center">
          {hasChildren && (
            <button
              onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
              className="p-1 rounded hover:bg-gray-200 cursor-pointer"
            >
              <ChevronRight size={12} className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          )}
        </span>
        {/* Folder label — select only */}
        <button
          onClick={() => { if (!isDisabled) onSelect(node.path) }}
          disabled={isDisabled}
          className="flex items-center gap-2 flex-1 min-w-0 text-left px-1 py-0.5 rounded disabled:cursor-not-allowed"
        >
          {expanded && hasChildren
            ? <FolderOpen size={14} className="text-amber-500 flex-shrink-0" />
            : <Folder size={14} className={`flex-shrink-0 ${hasChildren ? 'text-amber-500' : 'text-amber-400'}`} />}
          <span className="flex-1 truncate">{node.name}</span>
        </button>
      </div>
      {expanded && hasChildren && node.children.map(child => (
        <FolderNode
          key={child.path}
          node={child}
          selected={selected}
          onSelect={onSelect}
          depth={depth + 1}
          movingTargetKind={movingTargetKind}
          movingTargetPath={movingTargetPath}
        />
      ))}
    </div>
  )
}

interface Props {
  title?: string
  movingTargetPath?: string
  movingTargetKind?: 'file' | 'folder' | 'workflow'
  browserFiles?: Array<{ path: string }>
  folderPaths?: string[]
  onConfirm: (destinationFolder: string) => void
  onCancel: () => void
  isPending?: boolean
}

export default function MoveToDialog({
  title = 'Move To', movingTargetPath, movingTargetKind, browserFiles, folderPaths: providedFolderPaths, onConfirm, onCancel, isPending,
}: Props) {
  const { data: files = [] } = useKnowledgeFiles()
  const { data: folders = [] } = useKnowledgeFolders()
  const [selected, setSelected] = useState('')
  const treeFiles = browserFiles ?? files
  const treeFolderPaths = providedFolderPaths ?? folders.map(f => f.path)
  const tree = buildFolderTree(collectFolderPaths(treeFiles, treeFolderPaths))
  const invalidDestination = movingTargetKind === 'folder' && movingTargetPath
    ? selected === movingTargetPath || selected.startsWith(`${movingTargetPath}/`)
    : false

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <FolderNode
            node={tree}
            selected={selected}
            onSelect={setSelected}
            depth={0}
            movingTargetKind={movingTargetKind}
            movingTargetPath={movingTargetPath}
          />
        </div>

        <div className="flex gap-2 p-3 border-t">
          {invalidDestination && (
            <p className="flex-1 text-xs text-amber-700">
              You cannot move a folder into itself or one of its sub-folders.
            </p>
          )}
          <Btn variant="ghost" size="sm" onClick={onCancel} className="flex-1">Cancel</Btn>
          <Btn
            size="sm"
            onClick={() => onConfirm(selected)}
            loading={isPending}
            disabled={invalidDestination}
            className="flex-1"
          >
            Move Here
          </Btn>
        </div>
      </div>
    </div>
  )
}
