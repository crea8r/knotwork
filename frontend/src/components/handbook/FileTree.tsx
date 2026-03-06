/**
 * FileTree — folder-file hierarchy for the Handbook left panel.
 * Pure display component. All drag-and-drop is handled by HandbookPage.
 */
import { useState } from 'react'
import type { KnowledgeFile } from '@/api/knowledge'
import { buildTree, FileRow, FolderSection } from './FileTreeNodes'

interface FileTreeProps {
  files: KnowledgeFile[]
  selectedPath: string | null
  onSelectFile: (file: KnowledgeFile) => void
  onNewFile: (folder: string) => void
  /** HandbookPage passes this so folder rows can route drops to the right folder. */
  onDrop: (e: React.DragEvent, folder?: string) => void
}

export default function FileTree({
  files,
  selectedPath,
  onSelectFile,
  onNewFile,
  onDrop,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const tree = buildTree(files)

  function toggleFolder(path: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  return (
    <div className="flex flex-col">
      {tree.files.map(file => (
        <FileRow
          key={file.id}
          file={file}
          selected={selectedPath === file.path}
          onClick={() => onSelectFile(file)}
        />
      ))}

      {Object.values(tree.children).map(node => (
        <FolderSection
          key={node.fullPath}
          node={node}
          depth={0}
          collapsed={collapsed}
          selectedPath={selectedPath}
          onToggle={toggleFolder}
          onSelectFile={onSelectFile}
          onNewFile={onNewFile}
          onDrop={onDrop}
        />
      ))}

      {files.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-6 px-2">
          No files yet. Drop a file or click "+ New File".
        </p>
      )}
    </div>
  )
}
