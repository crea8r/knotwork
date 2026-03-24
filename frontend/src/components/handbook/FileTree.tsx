/**
 * FileTree — folder-file hierarchy for the Handbook left panel.
 * Supports: context menu, inline rename, multi-select, empty folders.
 */
import { useState } from 'react'
import type { KnowledgeFile } from '@/api/knowledge'
import type { KnowledgeFolder } from '@/api/folders'
import { buildTree, FileRow, FolderSection } from './FileTreeNodes'
import type { ContextTarget } from './FileContextMenu'
import FileContextMenu from './FileContextMenu'

interface FileTreeProps {
  files: KnowledgeFile[]
  folders: KnowledgeFolder[]
  selectedPath: string | null
  currentFolder: string
  onSelectFile: (file: KnowledgeFile) => void
  onSelectFolder: (path: string) => void
  onNewFile: (folder: string) => void
  onNewFolder: (parentPath: string) => void
  onRenameFile: (path: string, newName: string) => void
  onRenameFolder: (folderPath: string, newName: string) => void
  onMoveTo: (target: ContextTarget) => void
  onDeleteFile: (path: string) => void
  onDeleteFolder: (path: string) => void
  multiSelected: Set<string>
  onCtrlSelectFile: (file: KnowledgeFile) => void
}

export default function FileTree({
  files, folders, selectedPath, currentFolder, onSelectFile, onSelectFolder,
  onNewFile, onNewFolder, onRenameFile, onRenameFolder, onMoveTo,
  onDeleteFile, onDeleteFolder, multiSelected, onCtrlSelectFile,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ target: ContextTarget; x: number; y: number } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)

  const folderPaths = folders.map(f => f.path)
  const tree = buildTree(files, folderPaths)

  function toggleFolder(path: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  function showContextMenu(e: React.MouseEvent, target: ContextTarget) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ target, x: e.clientX, y: e.clientY })
  }

  function handleRename(target: ContextTarget) {
    if (target.kind === 'file') setRenamingPath(target.path)
    else setRenamingFolder(target.path)
  }

  function handleRenameFileCommit(path: string, newName: string) {
    setRenamingPath(null)
    const dir = path.split('/').slice(0, -1).join('/')
    const newPath = dir ? `${dir}/${newName}` : newName
    if (newPath !== path) onRenameFile(path, newPath)
  }

  function handleRenameFolderCommit(folderPath: string, newName: string) {
    setRenamingFolder(null)
    if (newName.trim() && newName !== folderPath.split('/').pop()) {
      onRenameFolder(folderPath, newName.trim())
    }
  }

  const folderSectionProps = {
    collapsed, selectedPath, multiSelected, currentFolder,
    onToggle: toggleFolder,
    onSelectFile,
    onCtrlSelectFile,
    onSelectFolder,
    onContextMenu: (e: React.MouseEvent, file: KnowledgeFile) =>
      showContextMenu(e, { kind: 'file', path: file.path }),
    onRenameFile: handleRenameFileCommit,
    renamingPath,
    onFolderContextMenu: (e: React.MouseEvent, folderPath: string) =>
      showContextMenu(e, { kind: 'folder', path: folderPath }),
    renamingFolder,
    onRenameFolderCommit: handleRenameFolderCommit,
  }

  return (
    <div className="flex flex-col">
      {tree.files.map(file => (
        <FileRow
          key={file.id}
          file={file}
          selected={selectedPath === file.path}
          selected_multi={multiSelected.has(file.path)}
          onClick={() => onSelectFile(file)}
          onCtrlClick={() => onCtrlSelectFile(file)}
          onContextMenu={e => showContextMenu(e, { kind: 'file', path: file.path })}
          onRenameCommit={newName => handleRenameFileCommit(file.path, newName)}
          renaming={renamingPath === file.path}
        />
      ))}

      {Object.values(tree.children).map(node => (
        <FolderSection key={node.fullPath} node={node} depth={0} {...folderSectionProps} />
      ))}

      {files.length === 0 && folders.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-6 px-2">
          No files yet. Drop a file or click "+ New File".
        </p>
      )}

      {contextMenu && (
        <FileContextMenu
          target={contextMenu.target}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onNewFile={onNewFile}
          onNewWorkflow={() => {}}
          onNewFolder={onNewFolder}
          onRename={handleRename}
          onMoveTo={t => { setContextMenu(null); onMoveTo(t) }}
          onDelete={t => {
            setContextMenu(null)
            if (t.kind === 'file') onDeleteFile(t.path)
            else onDeleteFolder(t.path)
          }}
        />
      )}
    </div>
  )
}
