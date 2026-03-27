/**
 * FileBrowserShell — reusable folder-browser layout.
 * Handles toolbar, breadcrumb, search, drag-drop, and content routing.
 * Feature-specific content injected via render props.
 * Note: imports FolderBrowser/Breadcrumb from handbook/ — move those to
 * file-browser/ when building the next file-management feature.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronLeft, ChevronDown, Loader2, MessageSquare, Plus, Search, Upload, Video, X } from 'lucide-react'
import type { UploadPreview } from '@/api/knowledge'
import type { FileBrowserState } from './useFileBrowserState'
import type { BrowserFile, RightPanel } from './types'
import type { ContextTarget } from '@/components/handbook/FileContextMenu'
import Breadcrumb from '@/components/handbook/Breadcrumb'
import FolderBrowser from '@/components/handbook/FolderBrowser'

interface Props {
  files: BrowserFile[]
  folderPaths: string[]
  searchResults: BrowserFile[]
  searching: boolean
  fileQuery: string
  onFileQueryChange: (q: string) => void
  state: FileBrowserState
  onRenameFile: (path: string, newPath: string) => void
  onRenameWorkflow: (graphId: string, name: string) => void
  onRenameFolder: (path: string, newName: string) => void
  onMoveTo: (target: ContextTarget) => void
  onDeleteFile: (path: string) => void
  onDeleteWorkflow: (graphId: string) => void
  onDeleteFolder: (path: string) => void
  onUploadClick: (folder: string) => void
  onDrop: (e: React.DragEvent) => void
  isBusy?: boolean
  busyLabel?: string
  renamePending?: boolean
  onNavigateFolder: (path: string) => void
  onNavigateFile: (path: string) => void
  onNavigateWorkflow: (graphId: string) => void
  onFileCreated: (path: string) => void
  onWorkflowCreated: (graphId: string) => void
  onUploadSaved: (path: string) => void
  renderFileView: (path: string) => React.ReactNode
  renderWorkflowView: (graphId: string) => React.ReactNode
  renderNewFilePanel: (folder: string, onCreate: (path: string) => void, onCancel: () => void) => React.ReactNode
  renderNewWorkflowPanel: (folder: string, onCreate: (graphId: string) => void, onCancel: () => void) => React.ReactNode
  renderNewFolderPanel: (parentPath: string, onDone: () => void, onCancel: () => void) => React.ReactNode
  renderUploadPanel: (preview: UploadPreview, onSaved: (path: string) => void, onCancel: () => void) => React.ReactNode
  sidePanel?: React.ReactNode
  allowNewFile?: boolean
  allowNewWorkflow?: boolean
  allowNewFolder?: boolean
  allowUpload?: boolean
  allowFolderRename?: boolean
  allowFolderMove?: boolean
  allowFolderDelete?: boolean
}

function goFolder(set: (p: RightPanel) => void) { set({ kind: 'folder' }) }

export default function FileBrowserShell({
  files, folderPaths, searchResults, searching, fileQuery, onFileQueryChange,
  state, onRenameFile, onRenameWorkflow, onRenameFolder, onMoveTo, onDeleteFile, onDeleteWorkflow, onDeleteFolder,
  onUploadClick, onDrop, isBusy = false, busyLabel, renamePending = false,
  onNavigateFolder, onNavigateFile, onNavigateWorkflow, onFileCreated, onWorkflowCreated, onUploadSaved,
  renderFileView, renderWorkflowView, renderNewFilePanel, renderNewWorkflowPanel, renderNewFolderPanel, renderUploadPanel, sidePanel,
  allowNewFile = true, allowNewWorkflow = true, allowNewFolder = true, allowUpload = true,
  allowFolderRename = true, allowFolderMove = true, allowFolderDelete = true,
}: Props) {
  const [showChat, setShowChat] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const { rightPanel, setRightPanel, currentFolder, multiSelected,
    selectedPath, openFileName, ctrlSelectFile,
    pageDragOver, setPageDragOver, panelWidth, pageRef, onDividerMouseDown } = state
  const newMenuRef = useRef<HTMLDivElement>(null)
  const selectedFile = rightPanel.kind === 'file'
    ? files.find(file => file.path === rightPanel.path) ?? null
    : rightPanel.kind === 'workflow'
      ? files.find(file => file.entryKind === 'workflow' && file.graphId === rightPanel.graphId) ?? null
    : null
  const targetFolder = rightPanel.kind === 'file'
    ? rightPanel.path.split('/').slice(0, -1).join('/')
    : rightPanel.kind === 'workflow'
      ? rightPanel.path.split('/').slice(0, -1).join('/')
    : currentFolder

  const back = () => goFolder(setRightPanel)

  useEffect(() => {
    if (!newMenuOpen) return
    function handleClick(event: MouseEvent) {
      if (!newMenuRef.current?.contains(event.target as Node)) setNewMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [newMenuOpen])

  const hasNewActions = allowNewFile || allowNewWorkflow || allowNewFolder || allowUpload

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 border-b border-gray-200 bg-white px-2 py-1 md:px-3 md:py-1.5 flex items-center gap-2">
        <div className="flex-1 relative max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={fileQuery} onChange={e => onFileQueryChange(e.target.value)} placeholder="Search files…"
            className="w-full border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500" />
          {fileQuery && <button onClick={() => onFileQueryChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>}
          {searching && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
        </div>
        {(rightPanel.kind === 'file' || rightPanel.kind === 'workflow') && (
          <button onClick={() => onNavigateFolder(currentFolder)} title="Back" className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 md:px-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:border-gray-300">
            <ChevronLeft size={14} /><span className="hidden md:inline">Back</span>
          </button>
        )}
      </div>

      <div ref={pageRef} className="relative flex flex-1 overflow-hidden"
        onDragOver={e => { if (allowUpload) e.preventDefault() }}
        onDragEnter={e => { if (allowUpload) { e.preventDefault(); setPageDragOver(true) } }}
        onDragLeave={e => { if (allowUpload && !pageRef.current?.contains(e.relatedTarget as Node)) setPageDragOver(false) }}
        onDrop={e => { if (allowUpload) { setPageDragOver(false); onDrop(e) } }}>

        {allowUpload && pageDragOver && (
          <div className="absolute inset-0 z-50 bg-brand-50/90 flex flex-col items-center justify-center pointer-events-none border-2 border-dashed border-brand-400 m-2 rounded-xl gap-3">
            <Upload size={36} className="text-brand-500" />
            <p className="font-semibold text-brand-700 text-lg">Drop to upload</p>
          </div>
        )}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden bg-white">
            <div className="px-4 py-2 border-b border-gray-100 flex-shrink-0 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Breadcrumb
                  path={currentFolder}
                  onNavigate={onNavigateFolder}
                  file={openFileName}
                  fileType={selectedFile?.file_type}
                  renamePending={renamePending}
                  onRenameFile={openFileName
                    ? (newName) => {
                        if (rightPanel.kind === 'workflow') {
                          onRenameWorkflow(rightPanel.graphId, newName)
                          return
                        }
                        if (rightPanel.kind !== 'file') return
                        const parentPath = rightPanel.path.split('/').slice(0, -1).join('/')
                        const newPath = parentPath ? `${parentPath}/${newName}` : newName
                        onRenameFile(rightPanel.path, newPath)
                      }
                    : undefined}
                  onRenameFolder={!openFileName && currentFolder
                    ? (newName) => onRenameFolder(currentFolder, newName)
                    : undefined}
                />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isBusy && busyLabel && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600">
                    <Loader2 size={12} className="animate-spin" />
                    {busyLabel}
                  </div>
                )}
                {hasNewActions && (
                  <div className="relative" ref={newMenuRef}>
                    <button
                      disabled={isBusy}
                      onClick={() => setNewMenuOpen(v => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus size={14} /><span className="hidden md:inline">New</span><ChevronDown size={13} className="hidden md:inline" />
                    </button>
                    {newMenuOpen && (
                      <div className="absolute right-0 mt-2 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-1.5 z-20">
                        {allowNewFile && (
                          <button
                            onClick={() => { setNewMenuOpen(false); setRightPanel({ kind: 'new', folder: targetFolder }) }}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                          >
                            New File
                          </button>
                        )}
                        {allowNewWorkflow && (
                          <button
                            onClick={() => { setNewMenuOpen(false); setRightPanel({ kind: 'new-workflow', folder: targetFolder }) }}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                          >
                            New Workflow
                          </button>
                        )}
                        {allowNewFolder && (
                          <button
                            onClick={() => { setNewMenuOpen(false); setRightPanel({ kind: 'new-folder', parentPath: targetFolder }) }}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                          >
                            New Folder
                          </button>
                        )}
                        {allowUpload && (
                          <button
                            onClick={() => { setNewMenuOpen(false); onUploadClick(targetFolder) }}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Upload
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {sidePanel && (
                  <button
                    disabled={isBusy}
                    onClick={() => setShowChat(v => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                      showChat ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <MessageSquare size={14} /><span className="hidden md:inline">Chat</span>
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {fileQuery ? (
                <div className="overflow-y-auto p-2">
                  {searchResults.length === 0
                    ? <p className="text-sm text-gray-400 text-center py-8">No files match "{fileQuery}"</p>
                    : searchResults.map(f => (
                        <button
                          key={f.id}
                          onClick={() => {
                            onFileQueryChange('')
                            if (f.entryKind === 'workflow' && f.graphId) onNavigateWorkflow(f.graphId)
                            else onNavigateFile(f.path)
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${selectedPath === f.path ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                          <span className="font-mono text-xs truncate">{f.path}</span>
                        </button>
                      ))
                  }
                </div>
              ) : rightPanel.kind === 'folder' ? (
                <FolderBrowser files={files} folderPaths={folderPaths} currentFolder={currentFolder}
                  selectedPath={selectedPath} multiSelected={multiSelected}
                  onSelectFile={file => {
                    if (file.entryKind === 'workflow' && file.graphId) onNavigateWorkflow(file.graphId)
                    else onNavigateFile(file.path)
                  }} onCtrlSelectFile={ctrlSelectFile} onSelectFolder={onNavigateFolder}
                  onNewFile={folder => setRightPanel({ kind: 'new', folder })}
                  onNewWorkflow={folder => setRightPanel({ kind: 'new-workflow', folder })}
                  onNewFolder={parentPath => setRightPanel({ kind: 'new-folder', parentPath })}
                  allowNewFile={allowNewFile}
                  allowNewWorkflow={allowNewWorkflow}
                  allowNewFolder={allowNewFolder}
                  allowFolderRename={allowFolderRename}
                  allowFolderMove={allowFolderMove}
                  allowFolderDelete={allowFolderDelete}
                  onRenameFile={onRenameFile} onRenameWorkflow={onRenameWorkflow} onRenameFolder={onRenameFolder}
                  onMoveTo={onMoveTo} onDeleteFile={onDeleteFile} onDeleteWorkflow={onDeleteWorkflow} onDeleteFolder={onDeleteFolder} />
              ) : rightPanel.kind === 'file' ? renderFileView(rightPanel.path)
                : rightPanel.kind === 'workflow' ? renderWorkflowView(rightPanel.graphId)
                : rightPanel.kind === 'new' ? renderNewFilePanel(rightPanel.folder, onFileCreated, back)
                : rightPanel.kind === 'new-workflow' ? renderNewWorkflowPanel(rightPanel.folder, onWorkflowCreated, back)
                : rightPanel.kind === 'new-folder' ? renderNewFolderPanel(rightPanel.parentPath, back, back)
                : rightPanel.kind === 'upload' ? renderUploadPanel(rightPanel.preview, onUploadSaved, back)
                : rightPanel.kind === 'video' ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
                    <Video size={40} className="text-gray-300" />
                    <p className="font-semibold text-gray-700">Video files aren't supported yet</p>
                    <button onClick={back} className="text-sm text-brand-600 font-medium">Dismiss</button>
                  </div>
                ) : rightPanel.kind === 'error' ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
                    <AlertCircle size={40} className="text-red-400" />
                    <p className="text-sm text-red-500">{rightPanel.message}</p>
                    <button onClick={back} className="text-sm text-brand-600 font-medium">Dismiss</button>
                  </div>
                ) : null}
            </div>
          </div>
          {showChat && sidePanel && (
            <>
              <div onMouseDown={onDividerMouseDown} className="w-1 flex-shrink-0 bg-gray-200 hover:bg-brand-400 active:bg-brand-500 transition-colors cursor-col-resize" />
              <div style={{ width: panelWidth }} className="flex-shrink-0 bg-white flex flex-col overflow-hidden border-l border-gray-200">
              {sidePanel}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
