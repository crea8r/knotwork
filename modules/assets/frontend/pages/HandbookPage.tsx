/**
 * HandbookPage — workspace knowledge asset management using the reusable FileBrowserShell.
 * All layout and navigation logic lives in FileBrowserShell + useFileBrowserState.
 * This page only owns API calls, upload flow, and workspace-knowledge-specific modals.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useKnowledgeFiles, useSearchKnowledgeFiles, useUploadFile, useUploadRawFile, useRenameKnowledgeFile, useDeleteKnowledgeFile, useCreateKnowledgeFile } from "@modules/assets/frontend/api/knowledge"
import { useDeleteGraph, useGraphs, useUpdateGraph } from "@modules/workflows/frontend/api/graphs"
import { useKnowledgeFolders, useDeleteFolder, useRenameFolder } from "@modules/assets/frontend/api/folders"
import { useAuthStore } from '@auth'
import { useFileBrowserState } from '@modules/assets/frontend/components/file-browser/useFileBrowserState'
import FileBrowserShell from '@modules/assets/frontend/components/file-browser/FileBrowserShell'
import AssetChatToggleButton from '@modules/assets/frontend/components/file-browser/AssetChatToggleButton'
import FileEditor from '@modules/assets/frontend/components/handbook/FileEditor'
import NewFilePanel from '@modules/assets/frontend/components/handbook/NewFilePanel'
import NewPresentationPanel from '@modules/assets/frontend/components/handbook/NewPresentationPanel'
import NewFolderPanel from '@modules/assets/frontend/components/handbook/NewFolderPanel'
import NewWorkflowPanel from '@modules/assets/frontend/components/handbook/NewWorkflowPanel'
import UploadPreviewPanel from '@modules/assets/frontend/components/handbook/UploadPreviewPanel'
import MoveToDialog from '@modules/assets/frontend/components/handbook/MoveToDialog'
import ConfirmDialog from '@ui/components/ConfirmDialog'
import Spinner from '@ui/components/Spinner'
import GraphEditorWorkspace from '@modules/workflows/frontend/components/GraphEditorWorkspace'
import { getAssetParentFolder, getGraphAssetPath, normalizeAssetPath } from '@modules/workflows/frontend/lib/assetPath'
import { knowledgeFilePath, knowledgeFolderPath, knowledgeWorkflowPath } from '@app-shell/paths'
import type { BrowserFile } from '@modules/assets/frontend/components/file-browser/types'
import { isSameAssetScope, useAssetWorkspaceStore } from '@app-shell/state/assetWorkspace'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp'])
const BINARY_EXTS = new Set(['.pdf', '.doc', '.docx'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'])

function getExt(name: string) { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : '' }

type DeleteTarget =
  | { kind: 'file'; path: string }
  | { kind: 'workflow'; graphId: string; name: string }
  | { kind: 'folder'; path: string }

export default function HandbookPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const workspaceId = useAuthStore(s => s.workspaceId) ?? DEV_WORKSPACE
  const assetChatOpen = useAssetWorkspaceStore((state) => state.isAssetChatOpen)
  const assetWorkspaceScope = useAssetWorkspaceStore((state) => state.scope)
  const setSelection = useAssetWorkspaceStore((state) => state.setSelection)
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
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const urlAssetPath = searchParams.get('path')
  const urlFolder = searchParams.get('folder') ?? ''
  const urlNew = searchParams.get('new')
  const [convertPrompt, setConvertPrompt] = useState<{ file: File; folder: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const knowledgeScope = useMemo(
    () => ({ kind: 'knowledge', workspaceId } as const),
    [workspaceId],
  )
  const scopeMatchesKnowledge = isSameAssetScope(assetWorkspaceScope, knowledgeScope)
  const state = useFileBrowserState({
    initialFolder: urlAssetPath
      ? urlAssetPath.split('/').slice(0, -1).join('/')
      : urlFolder,
    initialFilePath: urlAssetPath,
  })
  const workflowEntries = useMemo<BrowserFile[]>(
    () => graphs.map((graph) => ({
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
    })),
    [graphs],
  )
  const allEntries = useMemo<BrowserFile[]>(
    () => [
      ...files.map((file) => ({ ...file, entryKind: 'knowledge' as const })),
      ...workflowEntries,
    ],
    [files, workflowEntries],
  )
  const searchResults = useMemo<BrowserFile[]>(() => {
    const q = fileQuery.trim().toLowerCase()
    if (!q) return []
    const workflowMatches = workflowEntries.filter((workflow) =>
      [workflow.title, workflow.description, workflow.path]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
    return [...knowledgeSearchResults.map((file) => ({ ...file, entryKind: 'knowledge' as const })), ...workflowMatches]
  }, [fileQuery, knowledgeSearchResults, workflowEntries])
  const folderPaths = useMemo(
    () => Array.from(new Set([...folders.map(f => f.path), ...graphs.map(g => g.path).filter(Boolean)])),
    [folders, graphs],
  )
  const { currentFolder, rightPanel, setCurrentFolder, setRightPanel } = state
  const actionFolder = rightPanel.kind === 'file'
    ? rightPanel.path.split('/').slice(0, -1).join('/')
    : currentFolder
  const activeAssetChat = useMemo(() => {
    if (rightPanel.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === rightPanel.graphId)
      return workflow
        ? { assetType: 'workflow' as const, path: workflow.path, label: workflow.title }
        : null
    }
    return rightPanel.kind === 'file' || rightPanel.kind === 'knowledge-file'
      ? { assetType: 'file' as const, path: rightPanel.path, label: rightPanel.path }
      : { assetType: 'folder' as const, path: currentFolder, label: currentFolder || 'Knowledge' }
  }, [currentFolder, rightPanel, workflowEntries])

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
      if ((rightPanel.kind === 'file' || rightPanel.kind === 'folder' || rightPanel.kind === 'workflow')
        && (rightPanel.kind !== 'file' || rightPanel.path !== urlAssetPath)) {
        setRightPanel({ kind: 'file', path: urlAssetPath })
      }
      return
    }

    if (currentFolder !== urlFolder) setCurrentFolder(urlFolder)
    if (rightPanel.kind === 'file' || rightPanel.kind === 'workflow') setRightPanel({ kind: 'folder' })
  }, [currentFolder, graphsLoading, rightPanel, setCurrentFolder, setRightPanel, urlAssetPath, urlFolder, workflowEntries])

  useEffect(() => {
    if (!urlNew || urlAssetPath) return

    if (urlNew === 'file' || urlNew === 'text') {
      setRightPanel({ kind: 'new-text', folder: urlFolder })
    } else if (urlNew === 'presentation') {
      setRightPanel({ kind: 'new-presentation', folder: urlFolder })
    } else if (urlNew === 'folder') {
      setRightPanel({ kind: 'new-folder', parentPath: urlFolder })
    } else if (urlNew === 'workflow') {
      setRightPanel({ kind: 'new-workflow', folder: urlFolder })
    } else if (urlNew === 'upload') {
      requestAnimationFrame(() => uploadInputRef.current?.click())
    }

    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, setRightPanel, setSearchParams, urlAssetPath, urlFolder, urlNew])

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

  function openFilePath(path: string) {
    navigateKnowledgeAssetSelection({ kind: 'file', path })
  }

  function openWorkflow(graphId: string) {
    const workflow = workflowEntries.find((entry) => entry.graphId === graphId)
    if (!workflow) return
    navigateKnowledgeAssetSelection({ kind: 'workflow', path: workflow.path })
  }

  function openFolderPath(path: string) {
    navigateKnowledgeAssetSelection({ kind: 'folder', path })
  }

  function navigateKnowledgeAssetSelection(selection: { kind: 'file' | 'folder' | 'workflow'; path: string }, replace = false) {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('new')
    nextSearchParams.delete('path')
    nextSearchParams.delete('folder')
    if (selection.kind === 'file' || selection.kind === 'workflow') {
      nextSearchParams.set('path', selection.path)
    } else if (selection.path) {
      nextSearchParams.set('folder', selection.path)
    }
    const nextSearch = nextSearchParams.toString()
    navigate(nextSearch ? `/knowledge?${nextSearch}` : '/knowledge', replace ? { replace: true } : undefined)
  }

  function handleAssetChatClick() {
    if (assetChatOpen && scopeMatchesKnowledge) {
      if (rightPanel.kind === 'workflow' && rightPanel.graphId) {
        navigate(knowledgeWorkflowPath(rightPanel.path), { replace: true })
        return
      }
      if (rightPanel.kind === 'file' || rightPanel.kind === 'knowledge-file') {
        navigateKnowledgeAssetSelection({ kind: 'file', path: rightPanel.path }, true)
        return
      }
      navigateKnowledgeAssetSelection({ kind: 'folder', path: currentFolder }, true)
      return
    }
    if (!activeAssetChat) return
    if (activeAssetChat.assetType === 'workflow') {
      navigate(knowledgeWorkflowPath(activeAssetChat.path, { assetChat: true }))
      return
    }
    navigate(
      activeAssetChat.assetType === 'folder'
        ? knowledgeFolderPath(activeAssetChat.path, { assetChat: true })
        : knowledgeFilePath(activeAssetChat.path, { assetChat: true }),
    )
  }

  // ── Upload flow ──────────────────────────────────────────────────────────────

  async function handleFileUpload(file: File, folder = '') {
    const ext = getExt(file.name)
    if (VIDEO_EXTS.has(ext)) { state.setRightPanel({ kind: 'video', filename: file.name }); return }
    if (file.size > 10 * 1024 * 1024) { state.setRightPanel({ kind: 'error', message: 'File is too large (max 10 MB).' }); return }
    if (IMAGE_EXTS.has(ext)) {
      try { await uploadRawMutation.mutateAsync({ file, folder }) }
      catch { state.setRightPanel({ kind: 'error', message: 'Upload failed.' }) }
      return
    }
    if (BINARY_EXTS.has(ext)) { setConvertPrompt({ file, folder }); return }
    try {
      const preview = await uploadMutation.mutateAsync({ file, folder })
      state.setRightPanel({ kind: 'upload', preview, folder })
    } catch { state.setRightPanel({ kind: 'error', message: 'Upload failed. Please try again.' }) }
  }

  async function handleConvertChoice(convert: boolean) {
    if (!convertPrompt) return
    const { file, folder } = convertPrompt
    setConvertPrompt(null)
    if (convert) {
      try { const preview = await uploadMutation.mutateAsync({ file, folder }); state.setRightPanel({ kind: 'upload', preview, folder }) }
      catch { state.setRightPanel({ kind: 'error', message: 'Upload failed.' }) }
    } else {
      try { await uploadRawMutation.mutateAsync({ file, folder }) }
      catch { state.setRightPanel({ kind: 'error', message: 'Upload failed.' }) }
    }
  }

  // ── File/folder ops ──────────────────────────────────────────────────────────

  function handleRenameFile(oldPath: string, newPath: string) {
    renameFile.mutate({ path: oldPath, new_path: newPath }, {
      onSuccess: f => {
        if (state.rightPanel.kind === 'file' && state.rightPanel.path === oldPath) openFilePath(f.path)
      },
    })
  }

  function handleRenameFolder(path: string, newName: string) {
    const parentPath = path.split('/').slice(0, -1).join('/')
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    renameFolder.mutate({ path, new_path: newPath }, {
      onSuccess: () => {
        if (state.rightPanel.kind === 'folder' && currentFolder === path) openFolderPath(newPath)
      },
    })
  }

  function handleRenameWorkflow(graphId: string, newName: string) {
    const graph = graphs.find((item) => item.id === graphId)
    if (!graph) return
    updateGraph.mutate({ graphId, name: newName })
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
      const newFolderPath = destination ? `${destination}/${folderName}` : folderName
      renameFolder.mutate({ path: state.movingTarget.path, new_path: newFolderPath })
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
      deleteGraph.mutate(deleteTarget.graphId, {
        onSuccess: () => {
          if (state.rightPanel.kind === 'workflow' && state.rightPanel.graphId === deleteTarget.graphId) {
            const workflow = workflowEntries.find((entry) => entry.graphId === deleteTarget.graphId)
            openFolderPath(workflow?.path.split('/').slice(0, -1).join('/') ?? currentFolder)
          }
          setDeleteTarget(null)
        },
      })
      return
    }

    deleteFolder.mutate(deleteTarget.path, {
      onSuccess: () => setDeleteTarget(null),
    })
  }

  const busyLabel = renameFile.isPending || renameFolder.isPending || updateGraph.isPending
    ? 'Renaming…'
    : deleteGraph.isPending
      ? 'Updating workflow…'
    : uploadMutation.isPending || uploadRawMutation.isPending
      ? 'Uploading…'
      : undefined

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) return <div className="p-8 text-red-500">Failed to load knowledge assets.</div>

  return (
    <>
      <input ref={uploadInputRef} type="file" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { void handleFileUpload(f, actionFolder) } e.target.value = '' }} />

      <FileBrowserShell
        files={allEntries} folderPaths={folderPaths}
        searchResults={searchResults} searching={searching}
        fileQuery={fileQuery} onFileQueryChange={setFileQuery}
        rootLabel="Knowledge"
        state={state}
        onRenameFile={handleRenameFile}
        onRenameWorkflow={handleRenameWorkflow}
        onRenameFolder={handleRenameFolder}
        onMoveTo={t => state.setMovingTarget(t)}
        onDeleteFile={path => setDeleteTarget({ kind: 'file', path })}
        onDeleteWorkflow={graphId => {
          const graph = graphs.find((item) => item.id === graphId)
          if (!graph) return
          setDeleteTarget({ kind: 'workflow', graphId, name: graph.name })
        }}
        onDeleteFolder={path => setDeleteTarget({ kind: 'folder', path })}
        isBusy={Boolean(busyLabel)}
        busyLabel={busyLabel}
        renamePending={renameFile.isPending || renameFolder.isPending || updateGraph.isPending}
        onUploadClick={() => uploadInputRef.current?.click()}
        onDrop={async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) await handleFileUpload(f, actionFolder) }}
        onNavigateFolder={openFolderPath}
        onNavigateFile={openFilePath}
        onNavigateWorkflow={openWorkflow}
        onFileCreated={path => { void refetch(); openFilePath(path) }}
        onWorkflowCreated={openWorkflow}
        onUploadSaved={path => { void refetch(); openFilePath(path) }}
        renderFileView={path => <FileEditor path={path} />}
        renderWorkflowView={(graphId) => <GraphEditorWorkspace graphId={graphId} allowWorkflowChat={false} />}
        renderNewTextPanel={(folder, onCreate, onCancel) => <NewFilePanel folder={folder} onCreate={onCreate} onCancel={onCancel} />}
        renderNewPresentationPanel={(folder, onCreate, onCancel) => (
          <NewPresentationPanel folder={folder} onCreate={onCreate} onCancel={onCancel} />
        )}
        renderNewWorkflowPanel={(folder, onCreate, onCancel) => (
          <NewWorkflowPanel folder={folder} onCreate={onCreate} onCancel={onCancel} />
        )}
        renderNewFolderPanel={(parentPath, onDone, onCancel) => (
          <NewFolderPanel parentPath={parentPath} onCreate={() => onDone()} onCancel={onCancel} />
        )}
        renderUploadPanel={(preview, onSaved, onCancel) => (
          <UploadPreviewPanel
            preview={preview}
            onSaved={onSaved}
            onCancel={onCancel}
            onSave={async (payload) => {
              await createFile.mutateAsync(payload)
            }}
            isSaving={createFile.isPending}
          />
        )}
        showToolbarChatButton={false}
        breadcrumbActions={activeAssetChat ? (
          <AssetChatToggleButton
            active={assetChatOpen && scopeMatchesKnowledge}
            onClick={handleAssetChatClick}
            label={`Open chat for ${activeAssetChat.label}`}
          />
        ) : undefined}
      />

      {state.movingTarget && (
        <MoveToDialog title={`Move "${state.movingTarget.path.split('/').pop()}"`}
          movingTargetKind={state.movingTarget.kind}
          movingTargetPath={state.movingTarget.path}
          browserFiles={allEntries}
          folderPaths={folderPaths}
          onConfirm={handleMoveTo} onCancel={() => state.setMovingTarget(null)}
          isPending={renameFile.isPending || renameFolder.isPending || updateGraph.isPending} />
      )}

      {deleteTarget && (
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
      )}

      {convertPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <p className="font-semibold text-gray-900">How to import this file?</p>
            <p className="text-sm text-gray-500 font-mono truncate">{convertPrompt.file.name}</p>
            <div className="space-y-2">
              <button onClick={() => handleConvertChoice(true)}
                className="w-full text-left px-4 py-3 rounded-xl border-2 border-brand-500 bg-brand-50 text-brand-800 text-sm font-medium hover:bg-brand-100 transition-colors">
                Convert to Markdown
                <span className="block text-xs font-normal text-brand-600 mt-0.5">Editable text — best for AI context</span>
              </button>
              <button onClick={() => handleConvertChoice(false)}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors">
                Keep as original file
                <span className="block text-xs font-normal text-gray-400 mt-0.5">View-only — PDF/DOCX rendered in browser</span>
              </button>
            </div>
            <button onClick={() => setConvertPrompt(null)} className="text-xs text-gray-400 hover:text-gray-600 w-full text-center">Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
