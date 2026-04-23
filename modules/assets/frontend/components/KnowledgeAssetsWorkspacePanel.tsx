import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDeleteGraph, useGraphs, useUpdateGraph } from "@modules/workflows/frontend/api/graphs"
import {
  useCreateKnowledgeFile,
  useDeleteKnowledgeFile,
  useKnowledgeFiles,
  useRenameKnowledgeFile,
  useSearchKnowledgeFiles,
  useUploadFile,
  useUploadRawFile,
} from "@modules/assets/frontend/api/knowledge"
import { useDeleteFolder, useKnowledgeFolders, useRenameFolder } from "@modules/assets/frontend/api/folders"
import { useFileBrowserState } from '@modules/assets/frontend/components/file-browser/useFileBrowserState'
import FileBrowserShell from '@modules/assets/frontend/components/file-browser/FileBrowserShell'
import AssetChatToggleButton from '@modules/assets/frontend/components/file-browser/AssetChatToggleButton'
import type { BrowserFile } from '@modules/assets/frontend/components/file-browser/types'
import FileEditor from '@modules/assets/frontend/components/handbook/FileEditor'
import MoveToDialog from '@modules/assets/frontend/components/handbook/MoveToDialog'
import NewFilePanel from '@modules/assets/frontend/components/handbook/NewFilePanel'
import NewFolderPanel from '@modules/assets/frontend/components/handbook/NewFolderPanel'
import NewPresentationPanel from '@modules/assets/frontend/components/handbook/NewPresentationPanel'
import NewWorkflowPanel from '@modules/assets/frontend/components/handbook/NewWorkflowPanel'
import UploadPreviewPanel from '@modules/assets/frontend/components/handbook/UploadPreviewPanel'
import ConfirmDialog from '@ui/components/ConfirmDialog'
import Spinner from '@ui/components/Spinner'
import GraphEditorWorkspace from '@modules/workflows/frontend/components/GraphEditorWorkspace'
import { getAssetParentFolder, getGraphAssetPath, normalizeAssetPath } from '@modules/workflows/frontend/lib/assetPath'
import { assetChatReturnHref, buildAssetChatNavigateOptions, readAssetChatReturnTarget } from '@app-shell/assetChatNavigation'
import { useShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
import { knowledgeFilePath, knowledgeFolderPath, knowledgeWorkflowPath } from '@app-shell/paths'
import { useAssetWorkspaceStore } from '@app-shell/state/assetWorkspace'

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp'])
const BINARY_EXTS = new Set(['.pdf', '.doc', '.docx'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'])

function getExt(name: string) {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

type DeleteTarget =
  | { kind: 'file'; path: string }
  | { kind: 'workflow'; graphId: string; name: string }
  | { kind: 'folder'; path: string }

export default function KnowledgeAssetsWorkspacePanel({
  workspaceId,
  railActions,
  assetChatVisible = false,
  assetChatPanel,
}: {
  workspaceId: string
  railActions?: React.ReactNode
  assetChatVisible?: boolean
  assetChatPanel?: React.ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const selection = useAssetWorkspaceStore((state) => state.selection)
  const assetChatOpen = useAssetWorkspaceStore((state) => state.isAssetChatOpen)
  const setSelection = useAssetWorkspaceStore((state) => state.setSelection)
  const { snapshot } = useShellTopBarSlots()
  const { data: files = [], isLoading, error, refetch } = useKnowledgeFiles()
  const { data: graphs = [], isLoading: graphsLoading } = useGraphs(workspaceId)
  const { data: folders = [] } = useKnowledgeFolders()
  const deleteFolder = useDeleteFolder()
  const renameFolder = useRenameFolder()
  const updateGraph = useUpdateGraph(workspaceId)
  const deleteGraph = useDeleteGraph(workspaceId)
  const renameFile = useRenameKnowledgeFile()
  const deleteFile = useDeleteKnowledgeFile()
  const createFile = useCreateKnowledgeFile()
  const uploadMutation = useUploadFile()
  const uploadRawMutation = useUploadRawFile()

  const [fileQuery, setFileQuery] = useState('')
  const { data: knowledgeSearchResults = [], isFetching: searching } = useSearchKnowledgeFiles(fileQuery)
  const [convertPrompt, setConvertPrompt] = useState<{ file: File; folder: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const locationSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const urlAssetPath = locationSearchParams.get('path')
  const urlHasFolder = locationSearchParams.has('folder')
  const urlFolder = urlHasFolder ? (locationSearchParams.get('folder') ?? '') : null
  const returnTarget = readAssetChatReturnTarget(location)
  const assetChatNavigateOptions = buildAssetChatNavigateOptions(
    null,
    snapshot,
  )

  const initialFolder = urlAssetPath
    ? urlAssetPath.split('/').slice(0, -1).join('/')
    : urlHasFolder
      ? (urlFolder ?? '')
      : selection?.scopeKind === 'knowledge'
        ? (selection.assetType === 'folder' ? selection.path : selection.path.split('/').slice(0, -1).join('/'))
        : ''
  const initialFilePath = urlAssetPath ?? (
    selection?.scopeKind === 'knowledge' && (selection.assetType === 'file' || selection.assetType === 'knowledge-file')
      ? selection.path
      : null
  )
  const state = useFileBrowserState({
    initialFolder,
    initialFilePath,
  })

  const workflowEntries = useMemo<BrowserFile[]>(() => graphs.map((graph) => ({
    id: `workflow-${graph.id}`,
    workspace_id: graph.workspace_id,
    path: getGraphAssetPath(graph),
    title: graph.name,
    raw_token_count: 0,
    resolved_token_count: 0,
    linked_paths: [],
    current_version_id: graph.latest_version?.id ?? null,
    health_score: null,
    health_updated_at: null,
    file_type: 'workflow',
    is_editable: false,
    created_at: graph.created_at,
    updated_at: graph.updated_at,
    entryKind: 'workflow',
    description: graph.description,
    graphId: graph.id,
  })), [graphs])
  const allEntries = useMemo<BrowserFile[]>(
    () => [...files.map((file) => ({ ...file, entryKind: 'knowledge' as const })), ...workflowEntries],
    [files, workflowEntries],
  )
  const searchResults = useMemo<BrowserFile[]>(() => {
    const query = fileQuery.trim().toLowerCase()
    if (!query) return []
    const workflowMatches = workflowEntries.filter((workflow) =>
      [workflow.title, workflow.description, workflow.path].filter(Boolean).join(' ').toLowerCase().includes(query))
    return [...knowledgeSearchResults.map((file) => ({ ...file, entryKind: 'knowledge' as const })), ...workflowMatches]
  }, [fileQuery, knowledgeSearchResults, workflowEntries])
  const folderPaths = useMemo(
    () => Array.from(new Set([...folders.map((folder) => folder.path), ...graphs.map((graph) => graph.path).filter(Boolean)])),
    [folders, graphs],
  )

  const { currentFolder, rightPanel, setCurrentFolder, setRightPanel } = state
  const actionFolder = rightPanel.kind === 'file' ? rightPanel.path.split('/').slice(0, -1).join('/') : currentFolder
  const activeChatTarget = useMemo(() => {
    if (rightPanel.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === rightPanel.graphId)
      return workflow
        ? { assetType: 'workflow' as const, path: workflow.path, label: workflow.title }
        : null
    }
    return rightPanel.kind === 'file'
      ? { assetType: 'file' as const, path: rightPanel.path, label: rightPanel.path }
      : { assetType: 'folder' as const, path: currentFolder, label: currentFolder || 'Knowledge' }
  }, [currentFolder, rightPanel, workflowEntries])

  function handleAssetChatToggle() {
    if (assetChatOpen) {
      if (returnTarget) {
        navigate(assetChatReturnHref(returnTarget), { replace: true })
        return
      }
      const nextSearchParams = new URLSearchParams(location.search)
      nextSearchParams.delete('assetChat')
      const nextSearch = nextSearchParams.toString()
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: true },
      )
      return
    }
    if (!activeChatTarget) return
    navigate(
      activeChatTarget.assetType === 'folder'
        ? knowledgeFolderPath(activeChatTarget.path, { assetChat: true })
        : activeChatTarget.assetType === 'workflow'
          ? knowledgeWorkflowPath(activeChatTarget.path, { assetChat: true })
          : knowledgeFilePath(activeChatTarget.path, { assetChat: true }),
      assetChatNavigateOptions,
    )
  }

  useEffect(() => {
    if (urlAssetPath || urlHasFolder) return
    if (selection?.scopeKind !== 'knowledge' || selection.assetType !== 'workflow') return
    const workflow = workflowEntries.find((entry) => entry.graphId === selection.graphId)
    if (!workflow) return
    const folderPath = workflow.path.split('/').slice(0, -1).join('/')
    if (currentFolder !== folderPath) setCurrentFolder(folderPath)
    if (rightPanel.kind !== 'workflow' || rightPanel.graphId !== workflow.graphId || rightPanel.path !== workflow.path) {
      setRightPanel({ kind: 'workflow', graphId: workflow.graphId!, path: workflow.path })
    }
  }, [currentFolder, rightPanel, selection, setCurrentFolder, setRightPanel, urlAssetPath, urlHasFolder, workflowEntries])

  useEffect(() => {
    if (rightPanel.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === rightPanel.graphId)
      if (!workflow) return
      setSelection({
        scopeKind: 'knowledge',
        workspaceId,
        assetType: 'workflow',
        path: workflow.path,
        label: workflow.title,
        graphId: workflow.graphId,
      })
      return
    }
    if (rightPanel.kind === 'file' || rightPanel.kind === 'knowledge-file') {
      setSelection({
        scopeKind: 'knowledge',
        workspaceId,
        assetType: 'knowledge-file',
        path: rightPanel.path,
        label: rightPanel.path,
      })
      return
    }
    setSelection({
      scopeKind: 'knowledge',
      workspaceId,
      assetType: 'folder',
      path: currentFolder,
      label: currentFolder || 'Knowledge',
    })
  }, [currentFolder, rightPanel, setSelection, workflowEntries, workspaceId])

  useEffect(() => {
    const matchedWorkflow = urlAssetPath
      ? workflowEntries.find((entry) => entry.path === normalizeAssetPath(urlAssetPath)) ?? null
      : null

    if (urlAssetPath && matchedWorkflow) {
      const folder = getAssetParentFolder(matchedWorkflow.path)
      if (currentFolder !== folder) setCurrentFolder(folder)
      if (
        (rightPanel.kind === 'file' || rightPanel.kind === 'folder' || rightPanel.kind === 'workflow')
        && (rightPanel.kind !== 'workflow' || rightPanel.graphId !== matchedWorkflow.graphId || rightPanel.path !== matchedWorkflow.path)
      ) {
        setRightPanel({ kind: 'workflow', graphId: matchedWorkflow.graphId!, path: matchedWorkflow.path })
      }
      return
    }

    if (urlAssetPath && !graphsLoading) {
      const folder = urlAssetPath.split('/').slice(0, -1).join('/')
      if (currentFolder !== folder) setCurrentFolder(folder)
      if (
        (rightPanel.kind === 'file' || rightPanel.kind === 'folder' || rightPanel.kind === 'workflow')
        && (rightPanel.kind !== 'file' || rightPanel.path !== urlAssetPath)
      ) {
        setRightPanel({ kind: 'file', path: urlAssetPath })
      }
      return
    }

    if (!urlHasFolder) return

    if (currentFolder !== urlFolder) setCurrentFolder(urlFolder ?? '')
    if (rightPanel.kind === 'file' || rightPanel.kind === 'workflow') {
      setRightPanel({ kind: 'folder' })
    }
  }, [currentFolder, graphsLoading, rightPanel, setCurrentFolder, setRightPanel, urlAssetPath, urlFolder, urlHasFolder, workflowEntries])

  function navigateKnowledgeAssetSelection(selection: { kind: 'file' | 'folder' | 'workflow'; path: string }) {
    const nextSearchParams = new URLSearchParams(location.search)
    nextSearchParams.delete('path')
    nextSearchParams.delete('folder')
    if (selection.kind === 'file' || selection.kind === 'workflow') {
      nextSearchParams.set('path', selection.path)
    } else {
      nextSearchParams.set('folder', selection.path)
    }
    const nextSearch = nextSearchParams.toString()
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { state: location.state },
    )
  }

  function openFilePath(path: string) {
    navigateKnowledgeAssetSelection({ kind: 'file', path })
  }

  function openFolderPath(path: string) {
    navigateKnowledgeAssetSelection({ kind: 'folder', path })
  }

  function openWorkflowPanel(graphId: string) {
    const workflow = workflowEntries.find((entry) => entry.graphId === graphId)
    if (!workflow) return
    navigateKnowledgeAssetSelection({ kind: 'workflow', path: workflow.path })
  }

  async function handleFileUpload(file: File, folder = '') {
    const ext = getExt(file.name)
    if (VIDEO_EXTS.has(ext)) { state.setRightPanel({ kind: 'video', filename: file.name }); return }
    if (file.size > 10 * 1024 * 1024) { state.setRightPanel({ kind: 'error', message: 'File is too large (max 10 MB).' }); return }
    if (IMAGE_EXTS.has(ext)) {
      try { await uploadRawMutation.mutateAsync({ file, folder }) } catch { state.setRightPanel({ kind: 'error', message: 'Upload failed.' }) }
      return
    }
    if (BINARY_EXTS.has(ext)) { setConvertPrompt({ file, folder }); return }
    try {
      const preview = await uploadMutation.mutateAsync({ file, folder })
      state.setRightPanel({ kind: 'upload', preview, folder })
    } catch {
      state.setRightPanel({ kind: 'error', message: 'Upload failed. Please try again.' })
    }
  }

  async function handleConvertChoice(convert: boolean) {
    if (!convertPrompt) return
    const { file, folder } = convertPrompt
    setConvertPrompt(null)
    if (convert) {
      try {
        const preview = await uploadMutation.mutateAsync({ file, folder })
        state.setRightPanel({ kind: 'upload', preview, folder })
      } catch {
        state.setRightPanel({ kind: 'error', message: 'Upload failed.' })
      }
      return
    }
    try { await uploadRawMutation.mutateAsync({ file, folder }) } catch { state.setRightPanel({ kind: 'error', message: 'Upload failed.' }) }
  }

  function handleRenameFile(path: string, newPath: string) {
    renameFile.mutate({ path, new_path: newPath }, {
      onSuccess: (file) => {
        if (state.rightPanel.kind === 'file' && state.rightPanel.path === path) openFilePath(file.path)
      },
    })
  }

  function handleRenameFolder(path: string, newName: string) {
    const parent = path.split('/').slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${newName}` : newName
    renameFolder.mutate({ path, new_path: nextPath }, {
      onSuccess: () => {
        if (currentFolder === path) openFolderPath(nextPath)
      },
    })
  }

  function handleMoveTo(destination: string) {
    if (!state.movingTarget) return
    if (state.movingTarget.kind === 'file') {
      const filename = state.movingTarget.path.split('/').pop() ?? ''
      handleRenameFile(state.movingTarget.path, destination ? `${destination}/${filename}` : filename)
    } else if (state.movingTarget.kind === 'workflow') {
      updateGraph.mutate({ graphId: state.movingTarget.graphId, path: destination })
    } else {
      const folderName = state.movingTarget.path.split('/').pop() ?? ''
      renameFolder.mutate({ path: state.movingTarget.path, new_path: destination ? `${destination}/${folderName}` : folderName })
    }
    state.setMovingTarget(null)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'file') {
      deleteFile.mutate(deleteTarget.path, {
        onSuccess: () => {
          if (state.rightPanel.kind === 'file' && state.rightPanel.path === deleteTarget.path) state.goBack()
          setDeleteTarget(null)
        },
      })
      return
    }
    if (deleteTarget.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === deleteTarget.graphId)
      deleteGraph.mutate(deleteTarget.graphId, {
        onSuccess: () => {
          if (state.rightPanel.kind === 'workflow' && state.rightPanel.graphId === deleteTarget.graphId) {
            openFolderPath(workflow?.path.split('/').slice(0, -1).join('/') ?? currentFolder)
          }
          setDeleteTarget(null)
        },
      })
      return
    }
    deleteFolder.mutate(deleteTarget.path, { onSuccess: () => setDeleteTarget(null) })
  }

  const busyLabel = renameFile.isPending || renameFolder.isPending || updateGraph.isPending
    ? 'Renaming…'
    : uploadMutation.isPending || uploadRawMutation.isPending
      ? 'Uploading…'
      : deleteGraph.isPending
        ? 'Updating workflow…'
        : undefined

  if (isLoading) return <div className="flex h-full items-center justify-center"><Spinner size="lg" /></div>
  if (error) return <div className="flex h-full items-center justify-center px-6 text-sm text-red-500">Failed to load knowledge assets.</div>

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFileUpload(file, actionFolder)
          event.target.value = ''
        }}
      />

      <FileBrowserShell
        files={allEntries}
        folderPaths={folderPaths}
        searchResults={searchResults}
        searching={searching}
        fileQuery={fileQuery}
        onFileQueryChange={setFileQuery}
        rootLabel="Knowledge"
        railActions={railActions}
        state={state}
        onRenameFile={handleRenameFile}
        onRenameWorkflow={(graphId, name) => updateGraph.mutate({ graphId, name })}
        onRenameFolder={handleRenameFolder}
        onMoveTo={(target) => state.setMovingTarget(target)}
        onDeleteFile={(path) => setDeleteTarget({ kind: 'file', path })}
        onDeleteWorkflow={(graphId) => {
          const workflow = graphs.find((item) => item.id === graphId)
          if (!workflow) return
          setDeleteTarget({ kind: 'workflow', graphId, name: workflow.name })
        }}
        onDeleteFolder={(path) => setDeleteTarget({ kind: 'folder', path })}
        isBusy={Boolean(busyLabel)}
        busyLabel={busyLabel}
        renamePending={renameFile.isPending || renameFolder.isPending || updateGraph.isPending}
        onUploadClick={() => uploadInputRef.current?.click()}
        onDrop={async (event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file) await handleFileUpload(file, actionFolder)
        }}
        onNavigateFolder={openFolderPath}
        onNavigateFile={openFilePath}
        onNavigateWorkflow={openWorkflowPanel}
        onFileCreated={(path) => { void refetch(); openFilePath(path) }}
        onWorkflowCreated={openWorkflowPanel}
        onUploadSaved={(path) => { void refetch(); openFilePath(path) }}
        renderFileView={(path) => <FileEditor path={path} />}
        renderWorkflowView={(graphId) => <GraphEditorWorkspace graphId={graphId} allowWorkflowChat={false} />}
        renderNewTextPanel={(folder, onCreate, onCancel) => <NewFilePanel folder={folder} onCreate={onCreate} onCancel={onCancel} />}
        renderNewPresentationPanel={(folder, onCreate, onCancel) => <NewPresentationPanel folder={folder} onCreate={onCreate} onCancel={onCancel} />}
        renderNewWorkflowPanel={(folder, onCreate, onCancel) => <NewWorkflowPanel folder={folder} onCreate={onCreate} onCancel={onCancel} />}
        renderNewFolderPanel={(parentPath, onDone, onCancel) => <NewFolderPanel parentPath={parentPath} onCreate={() => onDone()} onCancel={onCancel} />}
        renderUploadPanel={(preview, onSaved, onCancel) => (
          <UploadPreviewPanel
            preview={preview}
            onSaved={onSaved}
            onCancel={onCancel}
            onSave={async (payload) => { await createFile.mutateAsync(payload) }}
            isSaving={createFile.isPending}
          />
        )}
        sidePanel={assetChatPanel}
        controlledSidePanelOpen={assetChatVisible}
        showToolbarChatButton={false}
        breadcrumbActions={activeChatTarget ? (
          <AssetChatToggleButton
            active={assetChatOpen}
            onClick={handleAssetChatToggle}
            label={`Open chat for ${activeChatTarget.label}`}
          />
        ) : undefined}
      />

      {state.movingTarget ? (
        <MoveToDialog
          title={`Move "${state.movingTarget.path.split('/').pop()}"`}
          movingTargetKind={state.movingTarget.kind}
          movingTargetPath={state.movingTarget.path}
          browserFiles={allEntries}
          folderPaths={folderPaths}
          onConfirm={handleMoveTo}
          onCancel={() => state.setMovingTarget(null)}
          isPending={renameFile.isPending || renameFolder.isPending || updateGraph.isPending}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={deleteTarget.kind === 'file' ? 'Delete File' : deleteTarget.kind === 'workflow' ? 'Archive or Delete Workflow' : 'Delete Folder'}
          message={deleteTarget.kind === 'file'
            ? `Delete "${deleteTarget.path}"?`
            : deleteTarget.kind === 'workflow'
              ? `Archive or delete "${deleteTarget.name}"?`
              : `Delete empty folder "${deleteTarget.path}"?`}
          warning={deleteTarget.kind === 'file'
            ? 'This action cannot be undone.'
            : deleteTarget.kind === 'workflow'
              ? 'Workflows with runs are archived. Workflows without runs are deleted.'
              : 'Only empty folders can be deleted. This action cannot be undone.'}
          confirmLabel={deleteTarget.kind === 'workflow' ? 'Continue' : 'Delete'}
          confirmVariant="danger"
          isPending={deleteTarget.kind === 'file' ? deleteFile.isPending : deleteTarget.kind === 'workflow' ? deleteGraph.isPending : deleteFolder.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {convertPrompt ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <p className="font-semibold text-gray-900">How to import this file?</p>
            <p className="truncate font-mono text-sm text-gray-500">{convertPrompt.file.name}</p>
            <div className="space-y-2">
              <button
                onClick={() => handleConvertChoice(true)}
                className="w-full rounded-xl border-2 border-brand-500 bg-brand-50 px-4 py-3 text-left text-sm font-medium text-brand-800 transition-colors hover:bg-brand-100"
              >
                Convert to Markdown
                <span className="mt-0.5 block text-xs font-normal text-brand-600">Editable text, best for AI context.</span>
              </button>
              <button
                onClick={() => handleConvertChoice(false)}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Keep as original file
                <span className="mt-0.5 block text-xs font-normal text-gray-400">View-only, rendered in browser.</span>
              </button>
            </div>
            <button onClick={() => setConvertPrompt(null)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        </div>
      ) : null}
    </>
  )
}
