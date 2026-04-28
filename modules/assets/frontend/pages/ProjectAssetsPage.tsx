import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { FolderPlus } from 'lucide-react'
import { useDeleteGraph, useGraphs, useUpdateGraph } from "@modules/workflows/frontend/api/graphs"
import { useKnowledgeFiles } from "@modules/assets/frontend/api/knowledge"
import {
  useCreateProjectAssetFile,
  useCreateProjectFolder,
  useDeleteProjectAssetFile,
  useDeleteProjectFolder,
  useProjectAssetFiles,
  useProjectFolders,
  useRenameProjectAssetFile,
  useRenameProjectFolder,
  useUploadProjectFile,
} from "@modules/assets/frontend/api/projectAssets"
import FileBrowserShell from '@modules/assets/frontend/components/file-browser/FileBrowserShell'
import AssetChatToggleButton from '@modules/assets/frontend/components/file-browser/AssetChatToggleButton'
import type { BrowserFile } from '@modules/assets/frontend/components/file-browser/types'
import { useFileBrowserState } from '@modules/assets/frontend/components/file-browser/useFileBrowserState'
import type { ContextTarget } from '@modules/assets/frontend/components/handbook/FileContextMenu'
import FileEditor from '@modules/assets/frontend/components/handbook/FileEditor'
import MoveToDialog from '@modules/assets/frontend/components/handbook/MoveToDialog'
import NewWorkflowPanel from '@modules/assets/frontend/components/handbook/NewWorkflowPanel'
import {
  createDefaultPresentationDocument,
  presentationDocumentToString,
  slugToTitle,
} from '@modules/assets/frontend/components/handbook/presentationDocument'
import UploadPreviewPanel from '@modules/assets/frontend/components/handbook/UploadPreviewPanel'
import Btn from '@ui/components/Btn'
import ConfirmDialog from '@ui/components/ConfirmDialog'
import GraphEditorWorkspace from '@modules/workflows/frontend/components/GraphEditorWorkspace'
import { getAssetParentFolder, getGraphAssetPath, normalizeAssetPath } from '@modules/workflows/frontend/lib/assetPath'
import { knowledgeFilePath, projectAssetFilePath, projectAssetFolderPath, projectAssetsPath, projectAssetWorkflowPath } from '@app-shell/paths'
import { isSameAssetScope, useAssetWorkspaceStore } from '@app-shell/state/assetWorkspace'
import type { ProjectOutletContext } from '@modules/projects/frontend/pages/ProjectDetailPage'

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
  file_type: string
  is_editable: boolean
  updated_at: string
}): BrowserFile {
  return {
    ...file,
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

function ProjectNewPresentationPanel({
  folder,
  onCreate,
  onCancel,
  onSubmit,
  isPending,
}: {
  folder: string
  onCreate: (path: string) => void
  onCancel: () => void
  onSubmit: (path: string, title: string, content: string) => Promise<void>
  isPending: boolean
}) {
  const [filename, setFilename] = useState('')
  const [error, setError] = useState<string | null>(null)
  const resolvedName = filename.endsWith('.pptx') ? filename : `${filename}.pptx`
  const fullPath = folder ? `${folder}/${resolvedName}` : resolvedName

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!filename.trim()) return
    setError(null)
    try {
      const title = slugToTitle(resolvedName)
      await onSubmit(fullPath, title, presentationDocumentToString(createDefaultPresentationDocument(title)))
      onCreate(fullPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create presentation.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 pb-3 pt-5">
        <div>
          <h2 className="font-semibold text-gray-900">New Presentation</h2>
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
            onChange={(event) => setFilename(event.target.value)}
            required
            placeholder="status-update.pptx"
          />
          {filename ? <p className="mt-1 text-xs text-gray-400">Path: <span className="font-mono">{fullPath}</span></p> : null}
        </div>
        <p className="text-xs text-gray-400">Creates an editable presentation you can export as `.pptx`.</p>
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
  const { workspaceId, projectId, projectSlug, project } = useOutletContext<ProjectOutletContext>()
  const assetChatOpen = useAssetWorkspaceStore((state) => state.isAssetChatOpen)
  const assetWorkspaceScope = useAssetWorkspaceStore((state) => state.scope)
  const setSelection = useAssetWorkspaceStore((state) => state.setSelection)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlAssetPath = searchParams.get('path')
  const urlFolder = searchParams.get('folder') ?? ''
  const { data: docs = [] } = useProjectAssetFiles(workspaceId, projectSlug)
  const { data: projectFolders = [] } = useProjectFolders(workspaceId, projectSlug)
  const { data: workflows = [], isLoading: workflowsLoading } = useGraphs(workspaceId, projectId)
  const { data: workspaceWorkflows = [] } = useGraphs(workspaceId)
  const { data: knowledgeFiles = [] } = useKnowledgeFiles()
  const browserState = useFileBrowserState({
    initialFolder: urlAssetPath
      ? urlAssetPath.split('/').slice(0, -1).join('/')
      : urlFolder,
    initialFilePath: urlAssetPath,
  })
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const [fileQuery, setFileQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ProjectDeleteTarget | null>(null)
  const projectScope = useMemo(
    () => ({ kind: 'project', workspaceId, projectSlug } as const),
    [projectSlug, workspaceId],
  )
  const scopeMatchesProject = isSameAssetScope(assetWorkspaceScope, projectScope)

  const createProjectAssetFile = useCreateProjectAssetFile(workspaceId, projectSlug)
  const createProjectFolder = useCreateProjectFolder(workspaceId, projectSlug)
  const renameProjectFolder = useRenameProjectFolder(workspaceId, projectSlug)
  const deleteProjectFolder = useDeleteProjectFolder(workspaceId, projectSlug)
  const renameProjectAssetFile = useRenameProjectAssetFile(workspaceId, projectSlug)
  const deleteProjectAssetFile = useDeleteProjectAssetFile(workspaceId, projectSlug)
  const uploadProjectFile = useUploadProjectFile(workspaceId, projectSlug)
  const updateGraph = useUpdateGraph(workspaceId)
  const deleteGraph = useDeleteGraph(workspaceId)

  const workflowEntries = useMemo<BrowserFile[]>(() => workflows.map((graph) => ({
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
    const panel = browserState.rightPanel
    if (panel.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === panel.graphId)
      return workflow
        ? {
            assetType: 'workflow' as const,
            asset_id: workflow.graphId ?? null,
            path: workflow.path,
            project_id: projectId,
            label: workflow.title,
          }
        : null
    }
    if (panel.kind === 'file') {
      const projectDoc = docs.find((doc) => doc.path === panel.path)
      return {
        assetType: 'file' as const,
        asset_id: projectDoc?.id ?? null,
        path: panel.path,
        project_id: projectId,
        label: panel.path,
      }
    }
    if (panel.kind === 'knowledge-file') {
      const knowledgeFile = knowledgeFiles.find((file) => file.path === panel.path)
      return {
        assetType: 'file' as const,
        asset_id: knowledgeFile?.id ?? null,
        path: panel.path,
        project_id: null,
        label: panel.path,
      }
    }
    const currentProjectFolder = projectFolders.find((folder) => folder.path === browserState.currentFolder)
    return {
      assetType: 'folder' as const,
      asset_id: currentProjectFolder?.id ?? null,
      path: browserState.currentFolder,
      project_id: projectId,
      label: browserState.currentFolder || 'Project assets',
    }
  }, [browserState.currentFolder, browserState.rightPanel, docs, knowledgeFiles, projectFolders, projectId, workflowEntries])
  const { currentFolder, rightPanel, setCurrentFolder, setRightPanel } = browserState

  useEffect(() => {
    if (rightPanel.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === rightPanel.graphId)
      if (!workflow) return
      setSelection({
        scopeKind: 'project',
        workspaceId,
        projectSlug,
        assetType: 'workflow',
        path: workflow.path,
        label: workflow.title,
        graphId: workflow.graphId,
      })
      return
    }
    if (rightPanel.kind === 'file' || rightPanel.kind === 'knowledge-file') {
      setSelection({
        scopeKind: 'project',
        workspaceId,
        projectSlug,
        assetType: rightPanel.kind === 'knowledge-file' ? 'knowledge-file' : 'file',
        path: rightPanel.path,
        label: rightPanel.path,
      })
      return
    }
    setSelection({
      scopeKind: 'project',
      workspaceId,
      projectSlug,
      assetType: 'folder',
      path: currentFolder,
      label: currentFolder || 'Project assets',
    })
  }, [currentFolder, projectSlug, rightPanel, setSelection, workflowEntries, workspaceId])

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

    if (urlAssetPath && !workflowsLoading) {
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

    if (currentFolder !== urlFolder) setCurrentFolder(urlFolder)
    if (rightPanel.kind === 'file' || rightPanel.kind === 'workflow') setRightPanel({ kind: 'folder' })
  }, [currentFolder, rightPanel, setCurrentFolder, setRightPanel, urlAssetPath, urlFolder, workflowEntries, workflowsLoading])

  function navigateProjectAssetSelection(selection: { kind: 'file' | 'folder' | 'workflow'; path: string }, replace = false) {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('path')
    nextSearchParams.delete('folder')
    if (selection.kind === 'file' || selection.kind === 'workflow') {
      nextSearchParams.set('path', selection.path)
    } else if (selection.path) {
      nextSearchParams.set('folder', selection.path)
    }
    const nextSearch = nextSearchParams.toString()
    navigate(
      nextSearch ? `${projectAssetsPath(projectSlug)}?${nextSearch}` : projectAssetsPath(projectSlug),
      replace ? { replace: true } : undefined,
    )
  }

  function openProjectFilePath(path: string) {
    navigateProjectAssetSelection({ kind: 'file', path })
  }

  function openProjectFolderPath(path: string) {
    navigateProjectAssetSelection({ kind: 'folder', path })
  }

  function openWorkflow(graphId: string) {
    const workflow = workflowEntries.find((entry) => entry.graphId === graphId)
    if (!workflow) return
    navigateProjectAssetSelection({ kind: 'workflow', path: workflow.path })
  }

  function handleAssetChatClick() {
    if (assetChatOpen && scopeMatchesProject) {
      if (rightPanel.kind === 'workflow' && rightPanel.graphId) {
        navigate(projectAssetWorkflowPath(projectSlug, rightPanel.path), { replace: true })
        return
      }
      if (rightPanel.kind === 'file' || rightPanel.kind === 'knowledge-file') {
        navigateProjectAssetSelection({ kind: 'file', path: rightPanel.path }, true)
        return
      }
      navigateProjectAssetSelection({ kind: 'folder', path: currentFolder }, true)
      return
    }
    if (!activeAssetChat) return
    if (activeAssetChat.project_id == null) {
      navigate(knowledgeFilePath(activeAssetChat.path, { assetChat: true }))
      return
    }
    navigate(
      activeAssetChat.assetType === 'folder'
        ? projectAssetFolderPath(projectSlug, activeAssetChat.path, { assetChat: true })
        : activeAssetChat.assetType === 'workflow'
          ? projectAssetWorkflowPath(projectSlug, activeAssetChat.path, { assetChat: true })
          : projectAssetFilePath(projectSlug, activeAssetChat.path, { assetChat: true }),
    )
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
    renameProjectAssetFile.mutate({ path, new_path: newPath }, {
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
      deleteProjectAssetFile.mutate(deleteTarget.path, {
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
    const workflow = workflowEntries.find((entry) => entry.graphId === deleteTarget.graphId)
    deleteGraph.mutate(deleteTarget.graphId, {
      onSuccess: () => {
        if (browserState.rightPanel.kind === 'workflow' && browserState.rightPanel.graphId === deleteTarget.graphId) {
          openProjectFolderPath(workflow?.path.split('/').slice(0, -1).join('/') ?? browserState.currentFolder)
        }
        setDeleteTarget(null)
      },
    })
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
          rootLabel={project.title}
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
          isBusy={renameProjectAssetFile.isPending || updateGraph.isPending || renameProjectFolder.isPending || deleteProjectAssetFile.isPending || deleteProjectFolder.isPending || deleteGraph.isPending || uploadProjectFile.isPending}
          busyLabel={renameProjectAssetFile.isPending ? 'Renaming…' : renameProjectFolder.isPending ? 'Renaming folder…' : updateGraph.isPending ? 'Updating workflow…' : deleteProjectAssetFile.isPending || deleteProjectFolder.isPending || deleteGraph.isPending ? 'Deleting…' : uploadProjectFile.isPending ? 'Uploading…' : undefined}
          renamePending={renameProjectAssetFile.isPending || renameProjectFolder.isPending || updateGraph.isPending}
          onUploadClick={() => uploadInputRef.current?.click()}
          onDrop={async (e) => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file) await handleProjectFileUpload(file, browserState.currentFolder)
          }}
          onNavigateFolder={openProjectFolderPath}
          onNavigateFile={openProjectFilePath}
          onNavigateWorkflow={openWorkflow}
          onFileCreated={openProjectFilePath}
          onWorkflowCreated={openWorkflow}
          onUploadSaved={openProjectFilePath}
          renderKnowledgeFileView={(path) => <FileEditor path={path} />}
          renderFileView={(path) => <FileEditor path={path} workspaceId={workspaceId} projectId={projectSlug} />}
          renderWorkflowView={(graphId) => <GraphEditorWorkspace graphId={graphId} allowWorkflowChat={false} />}
          renderNewTextPanel={(folder, onCreate, onCancel) => (
            <ProjectNewFilePanel
              folder={folder}
              onCreate={onCreate}
              onCancel={onCancel}
              isPending={createProjectAssetFile.isPending}
              onSubmit={async (path) => {
                await createProjectAssetFile.mutateAsync({ path, title: path.split('/').pop(), content: '' })
              }}
            />
          )}
          renderNewPresentationPanel={(folder, onCreate, onCancel) => (
            <ProjectNewPresentationPanel
              folder={folder}
              onCreate={onCreate}
              onCancel={onCancel}
              isPending={createProjectAssetFile.isPending}
              onSubmit={async (path, title, content) => {
                await createProjectAssetFile.mutateAsync({ path, title, content, file_type: 'presentation' })
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
              isSaving={createProjectAssetFile.isPending}
              saveLabel="Save to Project"
              onSave={async (payload) => {
                await createProjectAssetFile.mutateAsync(payload)
              }}
            />
          )}
          allowNewFolder
          allowUpload
          allowFolderRename
          allowFolderMove={false}
          allowFolderDelete
          showToolbarChatButton={false}
          breadcrumbActions={activeAssetChat
            ? (
                <AssetChatToggleButton
                  active={assetChatOpen && scopeMatchesProject}
                  onClick={handleAssetChatClick}
                  label={`Open chat for ${activeAssetChat.label}`}
                />
              )
            : undefined}
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
          isPending={renameProjectAssetFile.isPending || updateGraph.isPending}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={deleteTarget.kind === 'file' ? 'Delete File' : deleteTarget.kind === 'folder' ? 'Delete Folder' : 'Archive or Delete Workflow'}
          message={deleteTarget.kind === 'file' ? `Delete "${deleteTarget.path}"?` : deleteTarget.kind === 'folder' ? `Delete folder "${deleteTarget.path}" and its contents?` : `Archive or delete "${deleteTarget.name}"?`}
          warning={deleteTarget.kind === 'file' ? 'This action cannot be undone.' : deleteTarget.kind === 'folder' ? 'All files and sub-folders inside this folder will be deleted.' : 'Workflows with runs are archived. Workflows without runs are deleted.'}
          confirmLabel={deleteTarget.kind === 'workflow' ? 'Continue' : 'Delete'}
          confirmVariant="danger"
          isPending={deleteTarget.kind === 'file' ? deleteProjectAssetFile.isPending : deleteTarget.kind === 'folder' ? deleteProjectFolder.isPending : deleteGraph.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmProjectDelete}
        />
      ) : null}
    </>
  )
}
