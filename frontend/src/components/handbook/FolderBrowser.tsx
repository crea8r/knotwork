/**
 * FolderBrowser — Windows Explorer style folder contents view.
 * Shows direct children (subfolders + files) of currentFolder.
 */
import { useRef, useState } from 'react'
import { File, FileText, FileType2, Folder, GitBranch, Image, Lock } from 'lucide-react'
import { HealthDot } from './FileTreeNodes'
import type { ContextTarget } from './FileContextMenu'
import FileContextMenu from './FileContextMenu'
import type { BrowserFile } from '@/components/file-browser/types'

interface Props {
  files: BrowserFile[]
  folderPaths: string[]
  currentFolder: string
  selectedPath: string | null
  multiSelected: Set<string>
  onSelectFile: (file: BrowserFile) => void
  onCtrlSelectFile: (file: BrowserFile) => void
  onSelectFolder: (path: string) => void
  onNewFile: (folder: string) => void
  onNewWorkflow: (folder: string) => void
  onNewFolder: (parentPath: string) => void
  onRenameFile: (path: string, newPath: string) => void
  onRenameWorkflow: (graphId: string, name: string) => void
  onRenameFolder: (folderPath: string, newName: string) => void
  onMoveTo: (target: ContextTarget) => void
  onDeleteFile: (path: string) => void
  onDeleteWorkflow: (graphId: string) => void
  onDeleteFolder: (path: string) => void
}

function FileTypeIcon({ fileType }: { fileType: string }) {
  if (fileType === 'workflow') return <GitBranch size={14} className="flex-shrink-0 text-brand-500" />
  if (fileType === 'pdf') return <FileText size={14} className="flex-shrink-0 text-red-400" />
  if (fileType === 'docx') return <FileType2 size={14} className="flex-shrink-0 text-blue-400" />
  if (fileType === 'image') return <Image size={14} className="flex-shrink-0 text-purple-400" />
  return <File size={14} className="flex-shrink-0 text-gray-400" />
}

function getDirectChildren(files: BrowserFile[], folderPaths: string[], currentFolder: string) {
  const prefix = currentFolder ? currentFolder + '/' : ''

  const directFiles = files.filter(f => {
    if (prefix && !f.path.startsWith(prefix)) return false
    const rest = f.path.slice(prefix.length)
    return !rest.includes('/')
  })

  const seen = new Set<string>()
  const directFolders: string[] = []

  for (const fp of folderPaths) {
    if (prefix && !fp.startsWith(prefix)) continue
    const rest = fp.slice(prefix.length)
    if (!rest.includes('/') && rest.length > 0) {
      seen.add(fp); directFolders.push(fp)
    }
  }
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue
    const rest = f.path.slice(prefix.length)
    if (rest.includes('/')) {
      const fp = prefix + rest.split('/')[0]
      if (!seen.has(fp)) { seen.add(fp); directFolders.push(fp) }
    }
  }

  return { files: directFiles, folders: directFolders.sort() }
}

export default function FolderBrowser({
  files, folderPaths, currentFolder, selectedPath, multiSelected,
  onSelectFile, onCtrlSelectFile, onSelectFolder,
  onNewFile, onNewWorkflow, onNewFolder,
  onRenameFile, onRenameWorkflow, onRenameFolder, onMoveTo, onDeleteFile, onDeleteWorkflow, onDeleteFolder,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{
    target: ContextTarget
    x: number
    y: number
    hideRename?: boolean
    hideMoveTo?: boolean
    hideDelete?: boolean
    disableDelete?: boolean
    disableDeleteReason?: string
  } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)

  const { files: dirFiles, folders: dirFolders } = getDirectChildren(files, folderPaths, currentFolder)
  const isHomeFolder = currentFolder === ''
  function folderHasContents(path: string) {
    const prefix = path ? `${path}/` : ''
    return files.some(file => path === '' || file.path.startsWith(prefix))
      || folderPaths.some(folderPath => folderPath !== path && (path === '' || folderPath.startsWith(prefix)))
  }

  function showContext(
    e: React.MouseEvent,
    target: ContextTarget,
    options?: {
      hideRename?: boolean
      hideMoveTo?: boolean
      hideDelete?: boolean
      disableDelete?: boolean
      disableDeleteReason?: string
    },
  ) {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ target, x: e.clientX, y: e.clientY, ...options })
  }
  function handleRename(target: ContextTarget) {
    if (target.kind === 'file') setRenamingPath(target.path)
    else if (target.kind === 'workflow') setRenamingPath(target.path)
    else setRenamingFolder(target.path)
  }
  function commitFileRename(path: string, newName: string) {
    setRenamingPath(null)
    const workflow = files.find((item) => item.path === path && item.entryKind === 'workflow')
    if (workflow?.graphId) {
      if (newName.trim() && newName !== workflow.title) onRenameWorkflow(workflow.graphId, newName.trim())
      return
    }
    const dir = path.split('/').slice(0, -1).join('/')
    const newPath = dir ? `${dir}/${newName}` : newName
    if (newPath !== path) onRenameFile(path, newPath)
  }
  function commitFolderRename(folderPath: string, newName: string) {
    setRenamingFolder(null)
    if (newName.trim() && newName !== folderPath.split('/').pop()) onRenameFolder(folderPath, newName.trim())
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 overflow-y-auto"
        onContextMenu={e => showContext(e, { kind: 'folder', path: currentFolder }, {
          hideRename: true,
          hideMoveTo: isHomeFolder,
          hideDelete: isHomeFolder,
          disableDelete: !isHomeFolder && folderHasContents(currentFolder),
          disableDeleteReason: !isHomeFolder && folderHasContents(currentFolder)
            ? 'Only empty folders can be deleted.'
            : undefined,
        })}
      >
        {dirFolders.length === 0 && dirFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-16 text-center">
            <Folder size={36} className="text-gray-200" />
            <p className="text-sm text-gray-400">This folder is empty</p>
            <p className="text-xs text-gray-300">Create a file or upload a document to get started</p>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {dirFolders.map(fp => (
              <FolderRow key={fp} name={fp.split('/').pop() ?? fp}
                isRenaming={renamingFolder === fp}
                onClick={() => onSelectFolder(fp)}
                onContextMenu={e => showContext(e, { kind: 'folder', path: fp }, {
                  disableDelete: folderHasContents(fp),
                  disableDeleteReason: folderHasContents(fp) ? 'Only empty folders can be deleted.' : undefined,
                })}
                onRenameCommit={name => commitFolderRename(fp, name)} />
            ))}
            {dirFiles.map(file => (
              <FileRow key={file.id} file={file}
                filename={file.entryKind === 'workflow' ? file.title : (file.path.split('/').pop() ?? file.path)}
                selected={selectedPath === file.path}
                selectedMulti={multiSelected.has(file.path)}
                isRenaming={renamingPath === file.path}
                onClick={e => { if (e.ctrlKey || e.metaKey) onCtrlSelectFile(file); else onSelectFile(file) }}
                onContextMenu={e => showContext(
                  e,
                  file.entryKind === 'workflow' && file.graphId
                    ? { kind: 'workflow', path: file.path, graphId: file.graphId }
                    : { kind: 'file', path: file.path },
                )}
                onRenameCommit={name => commitFileRename(file.path, name)} />
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <FileContextMenu target={contextMenu.target} x={contextMenu.x} y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onNewFile={onNewFile} onNewWorkflow={onNewWorkflow} onNewFolder={onNewFolder}
          onRename={handleRename}
          onMoveTo={t => { setContextMenu(null); onMoveTo(t) }}
          onDelete={t => {
            setContextMenu(null)
            if (t.kind === 'file') onDeleteFile(t.path)
            else if (t.kind === 'workflow') onDeleteWorkflow(t.graphId)
            else onDeleteFolder(t.path)
          }}
          hideRename={contextMenu.hideRename}
          hideMoveTo={contextMenu.hideMoveTo}
          hideDelete={contextMenu.hideDelete}
          disableDelete={contextMenu.disableDelete}
          disableDeleteReason={contextMenu.disableDeleteReason} />
      )}
    </div>
  )
}

function FolderRow({ name, isRenaming, onClick, onContextMenu, onRenameCommit }: {
  name: string; isRenaming: boolean
  onClick: () => void; onContextMenu: (e: React.MouseEvent) => void
  onRenameCommit: (newName: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div onClick={onClick} onContextMenu={onContextMenu}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-100 cursor-pointer select-none transition-colors group">
      <Folder size={15} className="flex-shrink-0 text-amber-500" />
      {isRenaming ? (
        <input ref={ref} autoFocus defaultValue={name} onClick={e => e.stopPropagation()}
          onBlur={e => onRenameCommit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onRenameCommit(ref.current?.value ?? name) } if (e.key === 'Escape') onRenameCommit(name) }}
          className="flex-1 text-sm font-medium border-b border-brand-400 bg-transparent outline-none text-gray-700" />
      ) : (
        <span className="flex-1 text-sm font-medium text-gray-700 truncate">{name}</span>
      )}
      <span className="text-xs text-gray-300 group-hover:text-gray-400 flex-shrink-0">›</span>
    </div>
  )
}

function FileRow({ file, filename, selected, selectedMulti, isRenaming, onClick, onContextMenu, onRenameCommit }: {
  file: BrowserFile; filename: string; selected: boolean; selectedMulti: boolean; isRenaming: boolean
  onClick: (e: React.MouseEvent) => void; onContextMenu: (e: React.MouseEvent) => void
  onRenameCommit: (newName: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const isWorkflow = file.entryKind === 'workflow'
  return (
    <div onClick={onClick} onContextMenu={onContextMenu}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer select-none transition-colors ${
        selected ? 'bg-brand-50' : selectedMulti ? 'bg-blue-50' : 'hover:bg-gray-100'
      }`}>
      {!file.is_editable && !isWorkflow && <Lock size={10} className="flex-shrink-0 text-gray-300" />}
      <FileTypeIcon fileType={file.file_type} />
      {isRenaming ? (
        <input ref={ref} autoFocus defaultValue={filename} onClick={e => e.stopPropagation()}
          onBlur={e => onRenameCommit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onRenameCommit(ref.current?.value ?? filename) } if (e.key === 'Escape') onRenameCommit(filename) }}
          className="flex-1 text-sm font-mono border-b border-brand-400 bg-transparent outline-none" />
      ) : (
        <div className="flex-1 min-w-0">
          <p className={`truncate text-sm ${isWorkflow ? 'font-medium' : 'font-mono'} ${selected ? 'text-brand-700 font-medium' : 'text-gray-700'}`}>
            {filename}
          </p>
          {isWorkflow && file.description && (
            <p className="truncate text-xs text-gray-500">{file.description}</p>
          )}
        </div>
      )}
      {isWorkflow ? <span className="w-2 h-2" /> : file.is_editable ? <HealthDot score={file.health_score} /> : <span className="w-2 h-2" />}
    </div>
  )
}
