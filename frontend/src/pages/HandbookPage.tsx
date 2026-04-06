/**
 * HandbookPage — Handbook file management using the reusable FileBrowserShell.
 * All layout and navigation logic lives in FileBrowserShell + useFileBrowserState.
 * This page only owns API calls, upload flow, and handbook-specific modals.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useKnowledgeFiles, useSearchKnowledgeFiles, useUploadFile, useUploadRawFile, useRenameKnowledgeFile, useDeleteKnowledgeFile, useCreateKnowledgeFile } from '@/api/knowledge'
import { useDeleteGraph, useGraphs, useUpdateGraph } from '@/api/graphs'
import { useKnowledgeFolders, useDeleteFolder, useRenameFolder } from '@/api/folders'
import { useAssetChatChannel, usePostChannelMessage } from '@/api/channels'
import { useAuthStore } from '@/store/auth'
import { ChannelShell, ChannelTimeline } from '@/components/channel/ChannelFrame'
import WorkflowSlashComposer from '@/components/channel/WorkflowSlashComposer'
import { useChannelTimeline } from '@/components/channel/useChannelTimeline'
import { useMentionDetection } from '@/components/channel/useMentionDetection'
import { useFileBrowserState } from '@/components/file-browser/useFileBrowserState'
import FileBrowserShell from '@/components/file-browser/FileBrowserShell'
import FileEditor from '@/components/handbook/FileEditor'
import NewFilePanel from '@/components/handbook/NewFilePanel'
import NewFolderPanel from '@/components/handbook/NewFolderPanel'
import NewWorkflowPanel from '@/components/handbook/NewWorkflowPanel'
import UploadPreviewPanel from '@/components/handbook/UploadPreviewPanel'
import MoveToDialog from '@/components/handbook/MoveToDialog'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Spinner from '@/components/shared/Spinner'
import type { BrowserFile } from '@/components/file-browser/types'

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
  const { data: files = [], isLoading, error, refetch } = useKnowledgeFiles()
  const { data: graphs = [] } = useGraphs(workspaceId)
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
  const handbookChatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [handbookChatDraft, setHandbookChatDraft] = useState('')
  const urlFilePath = searchParams.get('path')
  const urlFolder = searchParams.get('folder') ?? ''
  const urlNew = searchParams.get('new')
  const urlChat = searchParams.get('chat') === '1'
  const highlightedMessageId = searchParams.get('message') ? `m-${searchParams.get('message')}` : null
  const activeChatTarget = useMemo(
    () => (urlFilePath
      ? { assetType: 'file' as const, path: urlFilePath }
      : { assetType: 'folder' as const, path: urlFolder }),
    [urlFilePath, urlFolder],
  )
  const { data: handbookChannel = null } = useAssetChatChannel(workspaceId, activeChatTarget.assetType, { path: activeChatTarget.path })
  const { items: handbookTimeline } = useChannelTimeline(workspaceId, handbookChannel?.id ?? '')
  const postHandbookMessage = usePostChannelMessage(workspaceId, handbookChannel?.id ?? '')
  const { mentionMenuNode: handbookMentionMenu } = useMentionDetection(workspaceId, handbookChatDraft, setHandbookChatDraft, handbookChatInputRef)
  const [convertPrompt, setConvertPrompt] = useState<{ file: File; folder: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const state = useFileBrowserState({
    initialFolder: urlFolder,
    initialFilePath: urlFilePath,
    panelWidthStorageKey: 'kw-handbook-asset-chat-width',
  })
  const workflowEntries = useMemo<BrowserFile[]>(
    () => graphs.map((graph) => ({
      id: `workflow-${graph.id}`,
      workspace_id: graph.workspace_id,
      path: graph.path ? `${graph.path}/${graph.name}` : graph.name,
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

  useEffect(() => {
    if (urlFilePath) {
      const folder = urlFilePath.split('/').slice(0, -1).join('/')
      if (currentFolder !== folder) setCurrentFolder(folder)
      if ((rightPanel.kind === 'file' || rightPanel.kind === 'folder')
        && (rightPanel.kind !== 'file' || rightPanel.path !== urlFilePath)) {
        setRightPanel({ kind: 'file', path: urlFilePath })
      }
      return
    }

    if (currentFolder !== urlFolder) setCurrentFolder(urlFolder)
    if (rightPanel.kind === 'file') setRightPanel({ kind: 'folder' })
  }, [currentFolder, rightPanel, setCurrentFolder, setRightPanel, urlFilePath, urlFolder])

  useEffect(() => {
    if (!urlNew || urlFilePath) return

    if (urlNew === 'file') {
      setRightPanel({ kind: 'new', folder: urlFolder })
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
  }, [searchParams, setRightPanel, setSearchParams, urlFilePath, urlFolder, urlNew])

  function openFilePath(path: string) {
    navigate(`/knowledge?path=${encodeURIComponent(path)}`)
  }

  function openWorkflow(graphId: string) {
    navigate(`/graphs/${graphId}`)
  }

  function openFolderPath(path: string) {
    navigate(path ? `/knowledge?folder=${encodeURIComponent(path)}` : '/knowledge')
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
        onSuccess: () => setDeleteTarget(null),
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
  if (error) return <div className="p-8 text-red-500">Failed to load Handbook.</div>

  return (
    <>
      <input ref={uploadInputRef} type="file" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { void handleFileUpload(f, actionFolder) } e.target.value = '' }} />

      <FileBrowserShell
        files={allEntries} folderPaths={folderPaths}
        searchResults={searchResults} searching={searching}
        fileQuery={fileQuery} onFileQueryChange={setFileQuery}
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
        renderWorkflowView={() => null}
        renderNewFilePanel={(folder, onCreate, onCancel) => <NewFilePanel folder={folder} onCreate={onCreate} onCancel={onCancel} />}
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
        openSidePanel={urlChat}
        sidePanelStorageKey="kw-handbook-asset-chat-open"
        sidePanel={
          <ChannelShell title="Handbook Chat" parentLabel="Knowledge channel" shellClassName="rounded-none border-0">
            <ChannelTimeline
              items={handbookTimeline}
              emptyState="No messages yet. Ask agents to help with handbook content."
              highlightedItemId={highlightedMessageId}
              scrollToLatest
            />
            <WorkflowSlashComposer
              workspaceId={workspaceId}
              workflows={graphs}
              channelId={handbookChannel?.id ?? null}
              draft={handbookChatDraft}
              setDraft={setHandbookChatDraft}
              onSend={() => postHandbookMessage.mutate(
                { content: handbookChatDraft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
                { onSuccess: () => setHandbookChatDraft('') },
              )}
              pending={postHandbookMessage.isPending}
              placeholder="Ask agents to help with handbook content, tag with @…"
              inputRef={handbookChatInputRef}
              beforeInput={handbookMentionMenu}
            />
          </ChannelShell>
        }
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
