/**
 * FileTreeNodes — tree building utilities and row components.
 *
 * Exports: HealthDot, FileRow, FolderSection, buildTree, getAllFiles
 * Exports type: FolderNode, ContextTarget
 */
import { useState, useRef } from 'react'
import {
  ChevronDown, ChevronRight, File, FolderOpen, Folder,
  FileText, Image, FileType2, Lock,
} from 'lucide-react'
import type { KnowledgeFile } from '@/api/knowledge'

// ── Health dot ──────────────────────────────────────────────────────────────

export function HealthDot({ score }: { score: number | null }) {
  if (score === null) return <span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />
  const color = score >= 3.5 ? 'bg-green-400' : score >= 2 ? 'bg-amber-400' : 'bg-red-400'
  return <span className={`w-2 h-2 rounded-full inline-block ${color}`} />
}

// ── File type icon + badge ────────────────────────────────────────────────────

function FileTypeIcon({ fileType }: { fileType: string }) {
  if (fileType === 'pdf') return <FileText size={13} className="flex-shrink-0 text-red-400" />
  if (fileType === 'docx') return <FileType2 size={13} className="flex-shrink-0 text-blue-400" />
  if (fileType === 'image') return <Image size={13} className="flex-shrink-0 text-purple-400" />
  return <File size={13} className="flex-shrink-0 text-gray-400" />
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface FolderNode {
  name: string
  fullPath: string
  files: KnowledgeFile[]
  children: Record<string, FolderNode>
  isExplicit?: boolean  // from DB folder record
}

export function collectFolderPaths(files: Array<Pick<KnowledgeFile, 'path'>>, folderPaths: string[]): string[] {
  const paths = new Set<string>()

  for (const folderPath of folderPaths) {
    const parts = folderPath.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      paths.add(parts.slice(0, i).join('/'))
    }
  }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      paths.add(parts.slice(0, i).join('/'))
    }
  }

  return Array.from(paths).sort((a, b) => a.localeCompare(b))
}

export function buildTree(files: KnowledgeFile[], folderPaths: string[]): FolderNode {
  const root: FolderNode = { name: '', fullPath: '', files: [], children: {} }
  const allFolderPaths = collectFolderPaths(files, folderPaths)

  // Ensure explicit and file-derived folders exist in tree.
  function ensureFolder(node: FolderNode, parts: string[], currentSegments: string[]) {
    if (!parts.length) return
    const [head, ...tail] = parts
    const nextSegments = [...currentSegments, head]
    if (!node.children[head]) {
      node.children[head] = {
        name: head,
        fullPath: nextSegments.join('/'),
        files: [],
        children: {},
        isExplicit: true,
      }
    }
    if (tail.length) ensureFolder(node.children[head], tail, nextSegments)
  }

  for (const fp of allFolderPaths) {
    const parts = fp.split('/').filter(Boolean)
    ensureFolder(root, parts, [])
  }

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
  file, selected, selected_multi, onClick, onCtrlClick, onContextMenu, onRenameCommit,
  renaming,
}: {
  file: KnowledgeFile
  selected: boolean
  selected_multi: boolean
  onClick: () => void
  onCtrlClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onRenameCommit: (newName: string) => void
  renaming: boolean
}) {
  const filename = file.path.split('/').pop() ?? file.path
  const inputRef = useRef<HTMLInputElement>(null)

  function handleRenameKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onRenameCommit(inputRef.current?.value ?? filename)
    }
    if (e.key === 'Escape') onRenameCommit(filename) // cancel → same name
  }

  const rowClass = `w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg text-left transition-colors ${
    selected ? 'bg-brand-50 text-brand-700 font-medium'
    : selected_multi ? 'bg-blue-50 text-blue-700'
    : 'hover:bg-gray-100 text-gray-700'
  }`

  return (
    <button
      onClick={e => { if (e.ctrlKey || e.metaKey) onCtrlClick(); else onClick() }}
      onContextMenu={onContextMenu}
      className={rowClass}
    >
      {!file.is_editable && <Lock size={10} className="flex-shrink-0 text-gray-300" />}
      <FileTypeIcon fileType={file.file_type} />
      {renaming ? (
        <input
          ref={inputRef}
          autoFocus
          defaultValue={filename}
          onClick={e => e.stopPropagation()}
          onBlur={e => onRenameCommit(e.target.value)}
          onKeyDown={handleRenameKey}
          className="flex-1 text-xs font-mono border-b border-brand-400 bg-transparent outline-none"
        />
      ) : (
        <span className="flex-1 truncate font-mono text-xs">{filename}</span>
      )}
      {file.is_editable
        ? <HealthDot score={file.health_score} />
        : <span className="w-2 h-2" />}
    </button>
  )
}

// ── FolderSection ────────────────────────────────────────────────────────────

export function FolderSection({
  node, depth, collapsed, selectedPath, multiSelected, currentFolder,
  onToggle, onSelectFile, onCtrlSelectFile, onContextMenu, onSelectFolder,
  onRenameFile, renamingPath, onFolderContextMenu, renamingFolder, onRenameFolderCommit,
}: {
  node: FolderNode
  depth: number
  collapsed: Set<string>
  selectedPath: string | null
  multiSelected: Set<string>
  currentFolder: string
  onToggle: (path: string) => void
  onSelectFile: (file: KnowledgeFile) => void
  onCtrlSelectFile: (file: KnowledgeFile) => void
  onContextMenu: (e: React.MouseEvent, file: KnowledgeFile) => void
  onSelectFolder: (path: string) => void
  onRenameFile: (path: string, newName: string) => void
  renamingPath: string | null
  onFolderContextMenu: (e: React.MouseEvent, folderPath: string) => void
  renamingFolder: string | null
  onRenameFolderCommit: (folderPath: string, newName: string) => void
}) {
  const [folderHovered, setFolderHovered] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const isCollapsed = collapsed.has(node.fullPath)
  const indent = depth * 12

  const allFiles = [...node.files, ...Object.values(node.children).flatMap(c => getAllFiles(c))]
  const worstScore = allFiles.length
    ? allFiles.reduce<number | null>((min, f) => {
        if (f.health_score === null || !f.is_editable) return min
        return min === null ? f.health_score : Math.min(min, f.health_score)
      }, null)
    : null

  const isRenamingThisFolder = renamingFolder === node.fullPath
  const folderName = node.name

  function handleFolderRenameKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onRenameFolderCommit(node.fullPath, folderInputRef.current?.value ?? folderName)
    }
    if (e.key === 'Escape') onRenameFolderCommit(node.fullPath, folderName)
  }

  const isCurrentFolder = currentFolder === node.fullPath

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer select-none transition-colors ${
          isCurrentFolder
            ? 'bg-brand-50 text-brand-700'
            : 'hover:bg-gray-100'
        }`}
        style={{ paddingLeft: indent + 8 }}
        onMouseEnter={() => setFolderHovered(true)}
        onMouseLeave={() => setFolderHovered(false)}
        onClick={() => { onSelectFolder(node.fullPath); if (isCollapsed) onToggle(node.fullPath) }}
        onContextMenu={e => onFolderContextMenu(e, node.fullPath)}
      >
        {/* Chevron: collapse/expand only — stops propagation so it doesn't navigate */}
        <button
          onClick={e => { e.stopPropagation(); onToggle(node.fullPath) }}
          className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200"
        >
          {isCollapsed
            ? <ChevronRight size={12} className="text-gray-400" />
            : <ChevronDown size={12} className="text-gray-400" />}
        </button>
        {isCollapsed
          ? <Folder size={13} className={`flex-shrink-0 ${isCurrentFolder ? 'text-brand-500' : 'text-amber-500'}`} />
          : <FolderOpen size={13} className={`flex-shrink-0 ${isCurrentFolder ? 'text-brand-500' : 'text-amber-500'}`} />}
        {isRenamingThisFolder ? (
          <input
            ref={folderInputRef}
            autoFocus
            defaultValue={folderName}
            onClick={e => e.stopPropagation()}
            onBlur={e => onRenameFolderCommit(node.fullPath, e.target.value)}
            onKeyDown={handleFolderRenameKey}
            className="flex-1 text-xs font-medium border-b border-brand-400 bg-transparent outline-none text-gray-700"
          />
        ) : (
          <span className={`text-xs font-medium flex-1 truncate ${isCurrentFolder ? 'text-brand-700' : 'text-gray-600'}`}>
            {folderName}
          </span>
        )}
        <HealthDot score={worstScore} />
        {folderHovered && !isRenamingThisFolder && (
          <span className="text-xs text-gray-300 ml-1">{allFiles.length}</span>
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
              multiSelected={multiSelected}
              currentFolder={currentFolder}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
              onCtrlSelectFile={onCtrlSelectFile}
              onContextMenu={onContextMenu}
              onSelectFolder={onSelectFolder}
              onRenameFile={onRenameFile}
              renamingPath={renamingPath}
              onFolderContextMenu={onFolderContextMenu}
              renamingFolder={renamingFolder}
              onRenameFolderCommit={onRenameFolderCommit}
            />
          ))}
          {node.files.map(file => (
            <div key={file.id} style={{ paddingLeft: indent + 20 }}>
              <FileRow
                file={file}
                selected={selectedPath === file.path}
                selected_multi={multiSelected.has(file.path)}
                onClick={() => onSelectFile(file)}
                onCtrlClick={() => onCtrlSelectFile(file)}
                onContextMenu={e => onContextMenu(e, file)}
                onRenameCommit={newName => onRenameFile(file.path, newName)}
                renaming={renamingPath === file.path}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
