import { useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { FolderPlus } from 'lucide-react'
import { useAssetChatChannel, usePostChannelMessage } from '@/api/channels'
import { useDeleteGraph, useGraphs, useUpdateGraph } from '@/api/graphs'
import { useKnowledgeFiles } from '@/api/knowledge'
import {
  useCreateProjectDocument,
  useCreateProjectFolder,
  useDeleteProjectDocument,
  useDeleteProjectFolder,
  useProjectDocuments,
  useProjectFolders,
  useRenameProjectDocument,
  useRenameProjectFolder,
  useUploadProjectFile,
} from '@/api/projects'
import { ChannelShell, ChannelTimeline } from '@/components/channel/ChannelFrame'
import WorkflowSlashComposer from '@/components/channel/WorkflowSlashComposer'
import { useChannelTimeline } from '@/components/channel/useChannelTimeline'
import { useMentionDetection } from '@/components/channel/useMentionDetection'
import FileBrowserShell from '@/components/file-browser/FileBrowserShell'
import type { BrowserFile } from '@/components/file-browser/types'
import { useFileBrowserState } from '@/components/file-browser/useFileBrowserState'
import type { ContextTarget } from '@/components/handbook/FileContextMenu'
import FileEditor from '@/components/handbook/FileEditor'
import MoveToDialog from '@/components/handbook/MoveToDialog'
import NewWorkflowPanel from '@/components/handbook/NewWorkflowPanel'
import UploadPreviewPanel from '@/components/handbook/UploadPreviewPanel'
import Btn from '@/components/shared/Btn'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import type { ProjectOutletContext } from './ProjectDetailPage'

type ProjectDeleteTarget =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'workflow'; graphId: string; name: string }

function collectFolderPaths(paths: string[]): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'))
    }
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b))
}

function toBrowserEntry(file: {
  id: string
  workspace_id: string
  path: string
  title: string
  raw_token_count: number
  resolved_token_count: number
  linked_paths: string[]
  current_version_id: string | null
  health_score: number | null
  updated_at: string
}): BrowserFile {
  return {
    ...file,
    file_type: 'md',
    is_editable: true,
    created_at: file.updated_at,
    health_updated_at: null,
    entryKind: 'knowledge',
  }
}

function ProjectNewFilePanel({
  folder,
  onCreate,
  onCancel,
  onSubmit,
  isPending,
}: {
  folder: string
  onCreate: (path: string) => void
  onCancel: () => void
  onSubmit: (path: string) => Promise<void>
  isPending: boolean
}) {
  const [filename, setFilename] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fullPath = folder
    ? `${folder}/${filename.endsWith('.md') ? filename : `${filename}.md`}`
    : (filename.endsWith('.md') ? filename : `${filename}.md`)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!filename.trim()) return
    setError(null)
    try {
      await onSubmit(fullPath)
      onCreate(fullPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create file.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 pb-3 pt-5">
        <div>
          <h2 className="font-semibold text-gray-900">New File</h2>
          {folder ? <p className="mt-0.5 text-xs text-gray-400">in <span className="font-mono">{folder}/</span></p> : null}
        </div>
      </div>
      <form onSubmit={submit} className="flex-1 space-y-4 p-5">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Filename</label>
          <input
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            required
            placeholder="brief.md"
          />
          {filename ? <p className="mt-1 text-xs text-gray-400">Path: <span className="font-mono">{fullPath}</span></p> : null}
        </div>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <div className="flex gap-2 pt-2">
          <Btn type="submit" size="sm" loading={isPending}>Create</Btn>
          <Btn type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </form>
    </div>
  )
}

function ProjectNewFolderPanel({
  parentPath,
  onCreate,
  onCancel,
  onSubmit,
  isPending,
}: {
  parentPath: string
  onCreate: (path: string) => void
  onCancel: () => void
  onSubmit: (path: string) => Promise<void>
  isPending: boolean
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim().replace(/\//g, '-')
  const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed

  async function handleCreate() {
    if (!trimmed) return
    setError(null)
    try {
      await onSubmit(fullPath)
      onCreate(fullPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
        <FolderPlus size={18} className="flex-shrink-0 text-amber-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">New Folder</h2>
          {parentPath ? <p className="mt-0.5 text-xs text-gray-400">in {parentPath}</p> : null}
        </div>
      </div>
      <div className="flex-1 space-y-4 p-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Folder name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') onCancel()
            }}
            placeholder="e.g. legal, marketing"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {trimmed ? <p className="text-xs text-gray-400">Will create: <span className="font-mono text-gray-600">{fullPath}</span></p> : null}
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <div className="flex items-center gap-2 pt-2">
          <Btn onClick={() => { void handleCreate() }} loading={isPending} disabled={!trimmed}>Create Folder</Btn>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  )
}

export default function ProjectAssetsPage() {
  const { workspaceId, projectId, projectSlug } = useOutletContext<ProjectOutletContext>()
  const navigate = useNavigate()
  const { data: docs = [] } = useProjectDocuments(workspaceId, projectSlug)
  const { data: projectFolders = [] } = useProjectFolders(workspaceId, projectSlug)
  const { data: workflows = [] } = useGraphs(workspaceId, projectId)
  const { data: workspaceWorkflows = [] } = useGraphs(workspaceId)
  const { data: knowledgeFiles = [] } = useKnowledgeFiles()
  const browserState = useFileBrowserState()
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)

  const [fileQuery, setFileQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ProjectDeleteTarget | null>(null)
  const [chatDraft, setChatDraft] = useState('')

  const createProjectDocument = useCreateProjectDocument(workspaceId, projectSlug)
  const createProjectFolder = useCreateProjectFolder(workspaceId, projectSlug)
  const renameProjectFolder = useRenameProjectFolder(workspaceId, projectSlug)
  const deleteProjectFolder = useDeleteProjectFolder(workspaceId, projectSlug)
  const renameProjectDocument = useRenameProjectDocument(workspaceId, projectSlug)
  const deleteProjectDocument = useDeleteProjectDocument(workspaceId, projectSlug)
  const uploadProjectFile = useUploadProjectFile(workspaceId, projectSlug)
  const updateGraph = useUpdateGraph(workspaceId)
  const deleteGraph = useDeleteGraph(workspaceId)

  const workflowEntries = useMemo<BrowserFile[]>(() => workflows.map((graph) => ({
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
    sourceScope: 'project',
  })), [workflows])

  const allEntries = useMemo<BrowserFile[]>(
    () => [...docs.map((doc) => ({ ...toBrowserEntry(doc), sourceScope: 'project' as const })), ...workflowEntries],
    [docs, workflowEntries],
  )
  const knowledgeSearchEntries = useMemo<BrowserFile[]>(() => [
    ...knowledgeFiles.map((file) => ({ ...file, entryKind: 'knowledge' as const, sourceScope: 'knowledge' as const })),
    ...workspaceWorkflows
      .filter((graph) => graph.project_id == null || graph.project_id !== projectId)
      .map((graph) => ({
        id: `knowledge-workflow-${graph.id}`,
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
        entryKind: 'workflow' as const,
        description: graph.description,
        graphId: graph.id,
        sourceScope: 'knowledge' as const,
      })),
  ], [knowledgeFiles, projectId, workspaceWorkflows])
  const folderPaths = useMemo(
    () => Array.from(new Set([...collectFolderPaths(allEntries.map((entry) => entry.path)), ...projectFolders.map((folder) => folder.path)])).sort((a, b) => a.localeCompare(b)),
    [allEntries, projectFolders],
  )
  const searchResults = useMemo(() => {
    const query = fileQuery.trim().toLowerCase()
    if (!query) return []
    return [...allEntries, ...knowledgeSearchEntries].filter((entry) =>
      [entry.title, entry.description, entry.path].filter(Boolean).join(' ').toLowerCase().includes(query))
  }, [allEntries, fileQuery, knowledgeSearchEntries])

  const activeAssetChat = useMemo(() => {
    if (browserState.rightPanel.kind === 'file') {
      const projectDoc = docs.find((doc) => doc.path === browserState.rightPanel.path)
      return {
        assetType: 'file' as const,
        asset_id: projectDoc?.id ?? null,
        path: browserState.rightPanel.path,
        project_id: projectId,
        label: browserState.rightPanel.path,
      }
    }
    if (browserState.rightPanel.kind === 'knowledge-file') {
      const knowledgeFile = knowledgeFiles.find((file) => file.path === browserState.rightPanel.path)
      return {
        assetType: 'file' as const,
        asset_id: knowledgeFile?.id ?? null,
        path: browserState.rightPanel.path,
        project_id: null,
        label: browserState.rightPanel.path,
      }
    }
    const currentProjectFolder = projectFolders.find((folder) => folder.path === browserState.currentFolder)
    return {
      assetType: 'folder' as const,
      asset_id: currentProjectFolder?.id ?? null,
      path: browserState.currentFolder,
      project_id: projectId,
      label: browserState.currentFolder || 'Project Assets',
    }
  }, [browserState.currentFolder, browserState.rightPanel, docs, knowledgeFiles, projectFolders, projectId])
  const { data: assetChatChannel = null } = useAssetChatChannel(workspaceId, activeAssetChat.assetType, {
    path: activeAssetChat.path,
    asset_id: activeAssetChat.asset_id,
    project_id: activeAssetChat.project_id,
  })
  const { items: assetTimeline } = useChannelTimeline(workspaceId, assetChatChannel?.id ?? '')
  const postAssetMessage = usePostChannelMessage(workspaceId, assetChatChannel?.id ?? '')
  const { mentionMenuNode } = useMentionDetection(workspaceId, chatDraft, setChatDraft, chatInputRef)

  function openProjectFilePath(path: string) {
    browserState.setCurrentFolder(path.split('/').slice(0, -1).join('/'))
    browserState.setRightPanel({ kind: 'file', path })
  }

  function openProjectFolderPath(path: string) {
    browserState.setCurrentFolder(path)
    browserState.setRightPanel({ kind: 'folder' })
  }

  function handleProjectFolderRename(path: string, newName: string) {
    const segments = path.split('/').filter(Boolean)
    const parent = segments.slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${newName}` : newName
    renameProjectFolder.mutate({ path, new_path: nextPath }, {
      onSuccess: () => {
        if (browserState.currentFolder === path || browserState.currentFolder.startsWith(`${path}/`)) {
          const suffix = browserState.currentFolder.slice(path.length)
          browserState.setCurrentFolder(`${nextPath}${suffix}`)
        }
        if (browserState.rightPanel.kind === 'file' && browserState.rightPanel.path.startsWith(`${path}/`)) {
          const suffix = browserState.rightPanel.path.slice(path.length)
          openProjectFilePath(`${nextPath}${suffix}`)
        }
      },
    })
  }

  function handleProjectFileRename(path: string, newPath: string) {
    renameProjectDocument.mutate({ path, new_path: newPath }, {
      onSuccess: (file) => {
        if (browserState.rightPanel.kind === 'file' && browserState.rightPanel.path === path) {
          openProjectFilePath(file.path)
        }
      },
    })
  }

  function handleProjectMoveTo(target: ContextTarget) {
    browserState.setMovingTarget(target)
  }

  function handleProjectMoveConfirm(destination: string) {
    if (!browserState.movingTarget) return
    if (browserState.movingTarget.kind === 'file') {
      const filename = browserState.movingTarget.path.split('/').pop() ?? ''
      handleProjectFileRename(
        browserState.movingTarget.path,
        destination ? `${destination}/${filename}` : filename,
      )
    } else if (browserState.movingTarget.kind === 'workflow') {
      updateGraph.mutate({ graphId: browserState.movingTarget.graphId, path: destination })
    }
    browserState.setMovingTarget(null)
  }

  async function handleProjectFileUpload(file: File, folder = '') {
    const preview = await uploadProjectFile.mutateAsync({ file, folder })
    browserState.setRightPanel({ kind: 'upload', preview, folder })
  }

  function confirmProjectDelete() {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'file') {
      deleteProjectDocument.mutate(deleteTarget.path, {
        onSuccess: () => {
          if (browserState.rightPanel.kind === 'file' && browserState.rightPanel.path === deleteTarget.path) {
            browserState.goBack()
          }
          setDeleteTarget(null)
        },
      })
      return
    }
    if (deleteTarget.kind === 'folder') {
      deleteProjectFolder.mutate(deleteTarget.path, {
        onSuccess: () => {
          if (browserState.currentFolder === deleteTarget.path || browserState.currentFolder.startsWith(`${deleteTarget.path}/`)) {
            browserState.setCurrentFolder(deleteTarget.path.split('/').slice(0, -1).join('/'))
          }
          setDeleteTarget(null)
        },
      })
      return
    }
    deleteGraph.mutate(deleteTarget.graphId, { onSuccess: () => setDeleteTarget(null) })
  }

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleProjectFileUpload(file, browserState.currentFolder)
          e.target.value = ''
        }}
      />

      <div className="flex-1 overflow-hidden bg-white">
        <FileBrowserShell
          files={allEntries}
          folderPaths={folderPaths}
          searchResults={searchResults}
          searching={false}
          fileQuery={fileQuery}
          onFileQueryChange={setFileQuery}
          state={browserState}
          onRenameFile={handleProjectFileRename}
          onRenameWorkflow={(graphId, newName) => updateGraph.mutate({ graphId, name: newName })}
          onRenameFolder={handleProjectFolderRename}
          onMoveTo={handleProjectMoveTo}
          onDeleteFile={(path) => setDeleteTarget({ kind: 'file', path })}
          onDeleteWorkflow={(graphId) => {
            const graph = workflows.find((workflow) => workflow.id === graphId)
            if (!graph) return
            setDeleteTarget({ kind: 'workflow', graphId, name: graph.name })
          }}
          onDeleteFolder={(path) => setDeleteTarget({ kind: 'folder', path })}
          isBusy={renameProjectDocument.isPending || updateGraph.isPending || renameProjectFolder.isPending || deleteProjectDocument.isPending || deleteProjectFolder.isPending || deleteGraph.isPending || uploadProjectFile.isPending}
          busyLabel={renameProjectDocument.isPending ? 'Renaming…' : renameProjectFolder.isPending ? 'Renaming folder…' : updateGraph.isPending ? 'Updating workflow…' : deleteProjectDocument.isPending || deleteProjectFolder.isPending || deleteGraph.isPending ? 'Deleting…' : uploadProjectFile.isPending ? 'Uploading…' : undefined}
          renamePending={renameProjectDocument.isPending || renameProjectFolder.isPending || updateGraph.isPending}
          onUploadClick={() => uploadInputRef.current?.click()}
          onDrop={async (e) => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file) await handleProjectFileUpload(file, browserState.currentFolder)
          }}
          onNavigateFolder={openProjectFolderPath}
          onNavigateFile={openProjectFilePath}
          onNavigateWorkflow={(graphId) => navigate(`/graphs/${graphId}`)}
          onFileCreated={openProjectFilePath}
          onWorkflowCreated={(graphId) => navigate(`/graphs/${graphId}`)}
          onUploadSaved={openProjectFilePath}
          renderKnowledgeFileView={(path) => <FileEditor path={path} />}
          renderFileView={(path) => <FileEditor path={path} workspaceId={workspaceId} projectId={projectSlug} />}
          renderWorkflowView={() => null}
          renderNewFilePanel={(folder, onCreate, onCancel) => (
            <ProjectNewFilePanel
              folder={folder}
              onCreate={onCreate}
              onCancel={onCancel}
              isPending={createProjectDocument.isPending}
              onSubmit={async (path) => {
                await createProjectDocument.mutateAsync({ path, title: path.split('/').pop(), content: '' })
              }}
            />
          )}
          renderNewWorkflowPanel={(folder, onCreate, onCancel) => (
            <NewWorkflowPanel folder={folder} projectId={projectId} onCreate={onCreate} onCancel={onCancel} />
          )}
          renderNewFolderPanel={(parentPath, onDone, onCancel) => (
            <ProjectNewFolderPanel
              parentPath={parentPath}
              onCreate={(path) => {
                openProjectFolderPath(path)
                onDone()
              }}
              onCancel={onCancel}
              isPending={createProjectFolder.isPending}
              onSubmit={async (path) => {
                await createProjectFolder.mutateAsync(path)
              }}
            />
          )}
          renderUploadPanel={(preview, onSaved, onCancel) => (
            <UploadPreviewPanel
              preview={preview}
              onSaved={onSaved}
              onCancel={onCancel}
              isSaving={createProjectDocument.isPending}
              saveLabel="Save to Project"
              onSave={async (payload) => {
                await createProjectDocument.mutateAsync(payload)
              }}
            />
          )}
          allowNewFolder
          allowUpload
          allowFolderRename
          allowFolderMove={false}
          allowFolderDelete
          sidePanel={(
            <ChannelShell
              title={activeAssetChat.label}
              parentLabel={projectSlug}
            >
              <ChannelTimeline items={assetTimeline} emptyState="No messages yet. Start a discussion about this asset." />
              <WorkflowSlashComposer
                workspaceId={workspaceId}
                workflows={workflows}
                channelId={assetChatChannel?.id ?? null}
                draft={chatDraft}
                setDraft={setChatDraft}
                onSend={() => postAssetMessage.mutate(
                  { content: chatDraft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
                  { onSuccess: () => setChatDraft('') },
                )}
                pending={postAssetMessage.isPending}
                placeholder="Discuss this asset in context…"
                inputRef={chatInputRef}
                beforeInput={mentionMenuNode}
              />
            </ChannelShell>
          )}
        />
      </div>

      {browserState.movingTarget ? (
        <MoveToDialog
          title={`Move "${browserState.movingTarget.path.split('/').pop()}"`}
          movingTargetKind={browserState.movingTarget.kind}
          movingTargetPath={browserState.movingTarget.path}
          browserFiles={allEntries}
          folderPaths={folderPaths}
          onConfirm={handleProjectMoveConfirm}
          onCancel={() => browserState.setMovingTarget(null)}
          isPending={renameProjectDocument.isPending || updateGraph.isPending}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={deleteTarget.kind === 'file' ? 'Delete File' : deleteTarget.kind === 'folder' ? 'Delete Folder' : 'Archive or Delete Workflow'}
          message={deleteTarget.kind === 'file' ? `Delete "${deleteTarget.path}"?` : deleteTarget.kind === 'folder' ? `Delete folder "${deleteTarget.path}" and its contents?` : `Archive or delete "${deleteTarget.name}"?`}
          warning={deleteTarget.kind === 'file' ? 'This action cannot be undone.' : deleteTarget.kind === 'folder' ? 'All files and sub-folders inside this folder will be deleted.' : 'Workflows with runs are archived. Workflows without runs are deleted.'}
          confirmLabel={deleteTarget.kind === 'workflow' ? 'Continue' : 'Delete'}
          confirmVariant="danger"
          isPending={deleteTarget.kind === 'file' ? deleteProjectDocument.isPending : deleteTarget.kind === 'folder' ? deleteProjectFolder.isPending : deleteGraph.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmProjectDelete}
        />
      ) : null}
    </>
  )
}
