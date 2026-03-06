/**
 * FileTreeNodes — sub-components and utilities extracted from FileTree.
 *
 * Exports: HealthDot, FileRow, FolderSection, buildTree, getAllFiles
 * Exports type: FolderNode
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, File, FolderOpen, Folder } from 'lucide-react'
import type { KnowledgeFile } from '@/api/knowledge'

// ── Health dot ──────────────────────────────────────────────────────────────

export function HealthDot({ score }: { score: number | null }) {
  if (score === null) return <span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />
  const color = score >= 3.5 ? 'bg-green-400' : score >= 2 ? 'bg-amber-400' : 'bg-red-400'
  return <span className={`w-2 h-2 rounded-full inline-block ${color}`} />
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface FolderNode {
  name: string
  fullPath: string
  files: KnowledgeFile[]
  children: Record<string, FolderNode>
}

export function buildTree(files: KnowledgeFile[]): FolderNode {
  const root: FolderNode = { name: '', fullPath: '', files: [], children: {} }
  for (const file of files) {
    const parts = file.path.split('/')
    if (parts.length === 1) {
      root.files.push(file)
    } else {
      const folderParts = parts.slice(0, -1)
      let node = root
      for (let i = 0; i < folderParts.length; i++) {
        const part = folderParts[i]
        if (!node.children[part]) {
          node.children[part] = {
            name: part,
            fullPath: folderParts.slice(0, i + 1).join('/'),
            files: [],
            children: {},
          }
        }
        node = node.children[part]
      }
      node.files.push(file)
    }
  }
  return root
}

export function getAllFiles(node: FolderNode): KnowledgeFile[] {
  return [...node.files, ...Object.values(node.children).flatMap(c => getAllFiles(c))]
}

// ── FileRow ──────────────────────────────────────────────────────────────────

export function FileRow({
  file,
  selected,
  onClick,
}: {
  file: KnowledgeFile
  selected: boolean
  onClick: () => void
}) {
  const tokenWarn = file.raw_token_count < 300 || file.raw_token_count > 6000
  const filename = file.path.split('/').pop() ?? file.path
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg text-left transition-colors ${
        selected ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-gray-100 text-gray-700'
      }`}
    >
      <HealthDot score={file.health_score} />
      <File size={13} className="flex-shrink-0 text-gray-400" />
      <span className="flex-1 truncate font-mono text-xs">{filename}</span>
      {tokenWarn && <span className="text-amber-500 text-xs">⚠</span>}
    </button>
  )
}

// ── FolderSection ────────────────────────────────────────────────────────────

export function FolderSection({
  node,
  depth,
  collapsed,
  selectedPath,
  onToggle,
  onSelectFile,
  onNewFile,
  onDrop,
}: {
  node: FolderNode
  depth: number
  collapsed: Set<string>
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelectFile: (file: KnowledgeFile) => void
  onNewFile: (folder: string) => void
  onDrop: (e: React.DragEvent, folder?: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const isCollapsed = collapsed.has(node.fullPath)
  const indent = depth * 12

  const allFiles = [...node.files, ...Object.values(node.children).flatMap(c => getAllFiles(c))]
  const worstScore = allFiles.length
    ? allFiles.reduce<number | null>((min, f) => {
        if (f.health_score === null) return min
        return min === null ? f.health_score : Math.min(min, f.health_score)
      }, null)
    : null

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 cursor-pointer select-none"
        style={{ paddingLeft: indent + 8 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onToggle(node.fullPath)}
      >
        {isCollapsed
          ? <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
          : <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
        }
        {isCollapsed
          ? <Folder size={13} className="text-gray-500 flex-shrink-0" />
          : <FolderOpen size={13} className="text-gray-500 flex-shrink-0" />
        }
        <span className="text-xs font-medium text-gray-600 flex-1 truncate">{node.name}</span>
        <HealthDot score={worstScore} />
        {hovered && (
          <button
            onClick={e => { e.stopPropagation(); onNewFile(node.fullPath) }}
            className="ml-1 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700"
            title={`New file in ${node.name}`}
          >
            <Plus size={11} />
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div>
          {Object.values(node.children).map(child => (
            <FolderSection
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
              onNewFile={onNewFile}
              onDrop={onDrop}
            />
          ))}
          {node.files.map(file => (
            <div key={file.id} style={{ paddingLeft: indent + 20 }}>
              <FileRow
                file={file}
                selected={selectedPath === file.path}
                onClick={() => onSelectFile(file)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
