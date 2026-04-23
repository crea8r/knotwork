/**
 * FileBrowserShell — reusable folder-browser layout.
 * Handles toolbar, breadcrumb, search, drag-drop, and content routing.
 * Feature-specific content injected via render props.
 * Note: imports FolderBrowser/Breadcrumb from handbook/ — move those to
 * file-browser/ when building the next file-management feature.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, Loader2, MessageSquare, Plus, Search, Upload, Video, X } from 'lucide-react'
import type { UploadPreview } from "@modules/assets/frontend/api/knowledge"
import type { FileBrowserState } from './useFileBrowserState'
import type { BrowserFile, RightPanel } from './types'
import type { ContextTarget } from '@modules/assets/frontend/components/handbook/FileContextMenu'
import Breadcrumb from '@modules/assets/frontend/components/handbook/Breadcrumb'
import FolderBrowser from '@modules/assets/frontend/components/handbook/FolderBrowser'
import { EditorSidePanel } from '@ui/components/EditorWorkspace'
import { readNamespacedStorage, writeNamespacedStorage } from '@storage'
import {
  SHELL_ACTION_BUTTON_ACTIVE_CLASS,
  SHELL_ACTION_BUTTON_CLASS,
  SHELL_ICON_BUTTON_CLASS,
  SHELL_RAIL_CLASS,
  SHELL_RAIL_INNER_CLASS,
} from '@app-shell/layoutChrome'

const SIDE_PANEL_TRANSITION_MS = 200

interface Props {
  files: BrowserFile[]
  folderPaths: string[]
  searchResults: BrowserFile[]
  searching: boolean
  fileQuery: string
  onFileQueryChange: (q: string) => void
  rootLabel?: string
  railActions?: React.ReactNode
  headerActions?: React.ReactNode
  breadcrumbActions?: React.ReactNode | ((controls: { showChat: boolean; toggleChat: () => void }) => React.ReactNode)
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
  renderKnowledgeFileView?: (path: string) => React.ReactNode
  renderWorkflowView: (graphId: string) => React.ReactNode
  renderNewTextPanel: (folder: string, onCreate: (path: string) => void, onCancel: () => void) => React.ReactNode
  renderNewPresentationPanel: (folder: string, onCreate: (path: string) => void, onCancel: () => void) => React.ReactNode
  renderNewWorkflowPanel: (folder: string, onCreate: (graphId: string) => void, onCancel: () => void) => React.ReactNode
  renderNewFolderPanel: (parentPath: string, onDone: () => void, onCancel: () => void) => React.ReactNode
  renderUploadPanel: (preview: UploadPreview, onSaved: (path: string) => void, onCancel: () => void) => React.ReactNode
  sidePanel?: React.ReactNode
  openSidePanel?: boolean
  controlledSidePanelOpen?: boolean
  sidePanelStorageKey?: string
  showToolbarChatButton?: boolean
  allowNewFile?: boolean
  allowNewWorkflow?: boolean
  allowNewFolder?: boolean
  allowUpload?: boolean
  allowFolderRename?: boolean
  allowFolderMove?: boolean
  allowFolderDelete?: boolean
}

function goFolder(set: (p: RightPanel) => void) { set({ kind: 'folder' }) }

function searchResultTitle(file: BrowserFile): string {
  return file.title || file.path.split('/').pop() || file.path
}

function searchResultScope(file: BrowserFile): string | null {
  if (file.sourceScope === 'knowledge') return 'Knowledge'
  if (file.sourceScope === 'project') return 'Project'
  return null
}

export default function FileBrowserShell({
  files, folderPaths, searchResults, searching, fileQuery, onFileQueryChange,
  rootLabel = 'Knowledge',
  railActions,
  headerActions,
  breadcrumbActions,
  state, onRenameFile, onRenameWorkflow, onRenameFolder, onMoveTo, onDeleteFile, onDeleteWorkflow, onDeleteFolder,
  onUploadClick, onDrop, isBusy = false, busyLabel, renamePending = false,
  onNavigateFolder, onNavigateFile, onNavigateWorkflow, onFileCreated, onWorkflowCreated, onUploadSaved,
  renderFileView, renderKnowledgeFileView, renderWorkflowView, renderNewTextPanel, renderNewPresentationPanel, renderNewWorkflowPanel, renderNewFolderPanel, renderUploadPanel, sidePanel,
  openSidePanel = false,
  controlledSidePanelOpen,
  sidePanelStorageKey,
  showToolbarChatButton = true,
  allowNewFile = true, allowNewWorkflow = true, allowNewFolder = true, allowUpload = true,
  allowFolderRename = true, allowFolderMove = true, allowFolderDelete = true,
}: Props) {
  const hasSidePanel = !!sidePanel
  const [showChat, setShowChat] = useState(() => {
    if (controlledSidePanelOpen !== undefined) return controlledSidePanelOpen
    if (typeof window === 'undefined' || !sidePanelStorageKey) return false
    return readNamespacedStorage(sidePanelStorageKey) === '1'
  })
  const [renderSidePanel, setRenderSidePanel] = useState(() => hasSidePanel && showChat)
  const [sidePanelVisible, setSidePanelVisible] = useState(() => hasSidePanel && showChat)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { rightPanel, setRightPanel, currentFolder, multiSelected,
    selectedPath, openFileName, ctrlSelectFile,
    pageDragOver, setPageDragOver, panelWidth, pageRef, onDividerMouseDown } = state
  const newMenuRef = useRef<HTMLDivElement>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)
  const spotlightId = useId()
  const toggleChat = () => setShowChat((value) => !value)
  const resolvedBreadcrumbActions = typeof breadcrumbActions === 'function'
    ? breadcrumbActions({ showChat, toggleChat })
    : breadcrumbActions
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
  const trimmedFileQuery = fileQuery.trim()

  function closeSearchOverlay({
    clearQuery = true,
    restoreFocus = true,
  }: {
    clearQuery?: boolean
    restoreFocus?: boolean
  } = {}) {
    setSearchOpen(false)
    if (clearQuery) onFileQueryChange('')
    if (restoreFocus && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => searchTriggerRef.current?.focus())
    }
  }

  function handleSearchResultSelect(file: BrowserFile) {
    closeSearchOverlay({ restoreFocus: false })
    if (file.entryKind === 'workflow' && file.graphId) {
      onNavigateWorkflow(file.graphId)
      return
    }
    if (file.sourceScope === 'knowledge') {
      setRightPanel({ kind: 'knowledge-file', path: file.path })
      return
    }
    onNavigateFile(file.path)
  }

  function handleSpotlightKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchOverlay()
      return
    }
    if (event.key !== 'Tab' || !spotlightRef.current) return

    const focusable = spotlightRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const activeElement = document.activeElement

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  function handleFileCreated(path: string) {
    const nextFolder = path.split('/').slice(0, -1).join('/')
    state.setCurrentFolder(nextFolder)
    setRightPanel({ kind: 'file', path })
    onFileCreated(path)
  }

  const back = () => goFolder(setRightPanel)

  useEffect(() => {
    if (controlledSidePanelOpen !== undefined) return
    if (typeof window === 'undefined' || !sidePanelStorageKey) return
    writeNamespacedStorage(sidePanelStorageKey, showChat ? '1' : '0')
  }, [controlledSidePanelOpen, showChat, sidePanelStorageKey])

  useEffect(() => {
    if (controlledSidePanelOpen === undefined) return
    setShowChat(controlledSidePanelOpen)
  }, [controlledSidePanelOpen])

  useEffect(() => {
    if (!openSidePanel) return
    setShowChat(true)
  }, [openSidePanel])

  useEffect(() => {
    if (!hasSidePanel) {
      setRenderSidePanel(false)
      setSidePanelVisible(false)
      return
    }
    if (showChat) {
      setRenderSidePanel(true)
      const frame = window.requestAnimationFrame(() => setSidePanelVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }
    setSidePanelVisible(false)
    const timeout = window.setTimeout(() => setRenderSidePanel(false), SIDE_PANEL_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [hasSidePanel, showChat])

  useEffect(() => {
    if (!searchOpen) return
    setNewMenuOpen(false)
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [searchOpen])

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
    <div data-ui="shell.asset.workspace" className="relative flex h-full flex-col overflow-hidden">
      <div data-ui="shell.asset.header" className={`flex-shrink-0 ${SHELL_RAIL_CLASS}`}>
        <div data-ui="shell.asset.header.inner" className={`${SHELL_RAIL_INNER_CLASS} min-w-0`}>
          {railActions ? (
            <div data-ui="shell.asset.header.leading" className="flex shrink-0 items-center gap-2">
              {railActions}
            </div>
          ) : null}
          <div data-ui="shell.asset.header.breadcrumb" className="min-w-0 flex-1">
            <Breadcrumb
              path={currentFolder}
              rootLabel={rootLabel}
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
              afterCurrent={resolvedBreadcrumbActions}
            />
          </div>
          <div data-ui="shell.asset.header.actions" className="ml-auto flex shrink-0 items-center gap-2">
            {headerActions}
            {isBusy && busyLabel && (
              <div data-ui="shell.asset.status" className="inline-flex h-8 items-center gap-2 rounded-lg border border-stone-200 px-2.5 text-[13px] leading-4 text-stone-600">
                <Loader2 size={12} className="animate-spin" />
                {busyLabel}
              </div>
            )}
            {hasNewActions && (
              <div data-ui="shell.asset.new" className="relative" ref={newMenuRef}>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setNewMenuOpen(v => !v)}
                  data-ui="shell.asset.new.trigger"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Create new asset"
                  aria-haspopup="menu"
                  aria-expanded={newMenuOpen}
                  title="New"
                >
                  <Plus size={13} />
                </button>
                {newMenuOpen && (
                  <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg">
                    {allowNewFile && (
                      <button
                        onClick={() => { setNewMenuOpen(false); setRightPanel({ kind: 'new-text', folder: targetFolder }) }}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                      >
                        New Text
                      </button>
                    )}
                    {allowNewFile && (
                      <button
                        onClick={() => { setNewMenuOpen(false); setRightPanel({ kind: 'new-presentation', folder: targetFolder }) }}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                      >
                        New Presentation
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
            {showToolbarChatButton && sidePanel && (
              <button
                disabled={isBusy}
                onClick={toggleChat}
                data-ui="shell.asset.chat.toggle"
                className={`${SHELL_ACTION_BUTTON_CLASS} ${
                  showChat ? SHELL_ACTION_BUTTON_ACTIVE_CLASS : ''
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <MessageSquare size={14} /><span className="hidden md:inline">Chat</span>
              </button>
            )}
            <div data-ui="shell.asset.search">
              <button
                ref={searchTriggerRef}
                type="button"
                data-ui="shell.asset.search.trigger"
                className={SHELL_ICON_BUTTON_CLASS}
                aria-label="Open search"
                aria-controls={spotlightId}
                aria-expanded={searchOpen}
                aria-haspopup="dialog"
                onClick={() => setSearchOpen(true)}
                title="Search"
              >
                <Search size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div data-ui="shell.asset.content" ref={pageRef} className="relative flex flex-1 overflow-hidden"
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
            <div className="flex-1 overflow-hidden">
              {rightPanel.kind === 'folder' ? (
                <FolderBrowser files={files} folderPaths={folderPaths} currentFolder={currentFolder}
                  selectedPath={selectedPath} multiSelected={multiSelected}
                  onSelectFile={file => {
                    if (file.entryKind === 'workflow' && file.graphId) onNavigateWorkflow(file.graphId)
                    else onNavigateFile(file.path)
                  }} onCtrlSelectFile={ctrlSelectFile} onSelectFolder={onNavigateFolder}
                  onNewFile={folder => setRightPanel({ kind: 'new-text', folder })}
                  onNewPresentation={folder => setRightPanel({ kind: 'new-presentation', folder })}
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
                : rightPanel.kind === 'knowledge-file' ? renderKnowledgeFileView?.(rightPanel.path) ?? null
                : rightPanel.kind === 'workflow' ? renderWorkflowView(rightPanel.graphId)
                : rightPanel.kind === 'new-text' ? renderNewTextPanel(rightPanel.folder, handleFileCreated, back)
                : rightPanel.kind === 'new-presentation' ? renderNewPresentationPanel(rightPanel.folder, handleFileCreated, back)
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
          {renderSidePanel && sidePanel && (
            <>
              <div
                data-ui="shell.asset.side-panel.desktop"
                className="hidden shrink-0 overflow-hidden md:flex motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-in-out motion-reduce:transition-none"
                style={{ width: sidePanelVisible ? panelWidth + 4 : 0 }}
                aria-hidden={!sidePanelVisible}
              >
                <div
                  data-ui="shell.asset.side-panel.divider"
                  onMouseDown={sidePanelVisible ? onDividerMouseDown : undefined}
                  className={`w-1 flex-shrink-0 cursor-col-resize bg-gray-200 motion-safe:transition-colors motion-safe:duration-200 hover:bg-brand-400 active:bg-brand-500 ${
                    sidePanelVisible ? '' : 'pointer-events-none'
                  }`}
                />
                <EditorSidePanel
                  width={panelWidth}
                  className={`hidden md:flex motion-safe:transition-[transform,opacity] motion-safe:duration-200 ${
                    sidePanelVisible
                      ? 'translate-x-0 opacity-100 motion-safe:ease-out'
                      : 'pointer-events-none translate-x-4 opacity-0 motion-safe:ease-in motion-reduce:translate-x-0'
                  }`}
                >
                  {sidePanel}
                </EditorSidePanel>
              </div>
              <div
                data-ui="shell.asset.side-panel.mobile"
                className={`absolute inset-0 z-20 bg-white md:hidden motion-safe:transition-[transform,opacity] motion-safe:duration-200 ${
                  sidePanelVisible
                    ? 'translate-x-0 opacity-100 motion-safe:ease-out'
                    : 'pointer-events-none translate-x-4 opacity-0 motion-safe:ease-in motion-reduce:translate-x-0'
                }`}
                aria-hidden={!sidePanelVisible}
              >
                {sidePanel}
              </div>
            </>
          )}
        </div>
      </div>

      {searchOpen && (
        <div data-ui="shell.asset.spotlight" className="absolute inset-0 z-40 flex items-start justify-center p-3 sm:p-4">
          <button
            type="button"
            data-ui="shell.asset.spotlight.overlay"
            className="absolute inset-0 bg-stone-950/20 backdrop-blur-[2px]"
            onClick={() => closeSearchOverlay()}
            aria-label="Close search"
          />
          <div
            id={spotlightId}
            ref={spotlightRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search files and workflows"
            data-ui="shell.asset.spotlight.dialog"
            onKeyDown={handleSpotlightKeyDown}
            className="relative z-10 flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-2xl"
          >
            <div data-ui="shell.asset.spotlight.header" className="border-b border-stone-200 p-3">
              <div className="flex items-center gap-2">
                <div data-ui="shell.asset.spotlight.input.wrap" className="relative min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    ref={searchInputRef}
                    value={fileQuery}
                    onChange={(event) => onFileQueryChange(event.target.value)}
                    placeholder="Search files and workflows"
                    data-ui="shell.asset.search.input"
                    className="h-12 w-full rounded-2xl border border-stone-200 bg-stone-50 pl-11 pr-20 text-sm leading-5 text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-500"
                  />
                  {trimmedFileQuery && !searching ? (
                    <button
                      type="button"
                      data-ui="shell.asset.search.clear"
                      onClick={() => onFileQueryChange('')}
                      className="absolute right-1.5 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                  {trimmedFileQuery && searching ? (
                    <Loader2 size={15} className="absolute right-5 top-1/2 -translate-y-1/2 animate-spin text-stone-400" />
                  ) : null}
                </div>
                <button
                  type="button"
                  data-ui="shell.asset.spotlight.close"
                  className={`${SHELL_ICON_BUTTON_CLASS} h-10 w-10 rounded-xl`}
                  onClick={() => closeSearchOverlay()}
                  aria-label="Close search"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div data-ui="shell.asset.spotlight.results" className="min-h-0 flex-1 overflow-y-auto p-2">
              {!trimmedFileQuery ? (
                <div data-ui="shell.asset.spotlight.empty" className="flex min-h-44 flex-col items-center justify-center gap-2 px-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 text-stone-500">
                    <Search size={18} />
                  </div>
                  <p className="text-sm font-medium text-stone-900">Search files and workflows</p>
                  <p className="max-w-sm text-sm leading-6 text-stone-500">
                    Jump straight to the asset you need without leaving the current workspace.
                  </p>
                </div>
              ) : searching && searchResults.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-sm text-stone-500">
                  <Loader2 size={18} className="animate-spin text-stone-400" />
                  <p>Searching for “{trimmedFileQuery}”</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-6 text-center">
                  <p className="text-sm font-medium text-stone-900">No matches found</p>
                  <p className="max-w-sm text-sm leading-6 text-stone-500">
                    Try a filename, path, or workflow name instead.
                  </p>
                </div>
              ) : (
                <div data-ui="shell.asset.search.results" className="space-y-1">
                  {searchResults.map((file) => {
                    const scopeLabel = searchResultScope(file)
                    const isWorkflow = file.entryKind === 'workflow'
                    return (
                      <button
                        key={file.id}
                        type="button"
                        data-ui="shell.asset.spotlight.result"
                        onClick={() => handleSearchResultSelect(file)}
                        className={`flex min-h-12 w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                          selectedPath === file.path ? 'bg-brand-50 text-brand-700' : 'text-stone-700 hover:bg-stone-50'
                        }`}
                      >
                        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                          selectedPath === file.path
                            ? 'border-brand-200 bg-brand-100 text-brand-700'
                            : 'border-stone-200 bg-stone-50 text-stone-500'
                        }`}>
                          <Search size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate text-sm font-medium">{searchResultTitle(file)}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                              {isWorkflow ? 'Workflow' : 'File'}
                            </span>
                            {scopeLabel ? (
                              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                                {scopeLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate font-mono text-xs text-stone-500">{file.path}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
