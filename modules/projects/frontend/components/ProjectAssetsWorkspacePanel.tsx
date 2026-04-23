import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDeleteGraph, useGraphs, useUpdateGraph } from "@modules/workflows/frontend/api/graphs"
import { useKnowledgeFiles } from "@modules/assets/frontend/api/knowledge"
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
} from "@modules/projects/frontend/api/projects"
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
import { assetChatReturnHref, buildAssetChatNavigateOptions, readAssetChatReturnTarget } from '@app-shell/assetChatNavigation'
import { useShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
import { knowledgeFilePath, projectAssetFilePath, projectAssetFolderPath, projectAssetWorkflowPath } from '@app-shell/paths'
import { useAssetWorkspaceStore } from '@app-shell/state/assetWorkspace'

type ProjectDeleteTarget =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'workflow'; graphId: string; name: string }

function collectFolderPaths(paths: string[]): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) folders.add(parts.slice(0, index).join('/'))
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

function ProjectNewFilePanel({ folder, onCreate, onCancel, onSubmit, isPending }: {
  folder: string
  onCreate: (path: string) => void
  onCancel: () => void
  onSubmit: (path: string) => Promise<void>
  isPending: boolean
}) {
  const [filename, setFilename] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fullPath = folder ? `${folder}/${filename.endsWith('.md') ? filename : `${filename}.md`}` : (filename.endsWith('.md') ? filename : `${filename}.md`)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!filename.trim()) return
    setError(null)
    try { await onSubmit(fullPath); onCreate(fullPath) } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create file.') }
  }
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 pb-3 pt-5"><h2 className="font-semibold text-gray-900">New File</h2>{folder ? <p className="mt-0.5 text-xs text-gray-400">in <span className="font-mono">{folder}/</span></p> : null}</div>
      <form onSubmit={submit} className="flex-1 space-y-4 p-5">
        <label className="block text-xs text-gray-500">
          Filename
          <input autoFocus className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500" value={filename} onChange={(event) => setFilename(event.target.value)} required placeholder="brief.md" />
        </label>
        {filename ? <p className="text-xs text-gray-400">Path: <span className="font-mono">{fullPath}</span></p> : null}
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <div className="flex gap-2 pt-2"><Btn type="submit" size="sm" loading={isPending}>Create</Btn><Btn type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn></div>
      </form>
    </div>
  )
}

function ProjectNewPresentationPanel({ folder, onCreate, onCancel, onSubmit, isPending }: {
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
      <div className="border-b px-5 pb-3 pt-5"><h2 className="font-semibold text-gray-900">New Presentation</h2>{folder ? <p className="mt-0.5 text-xs text-gray-400">in <span className="font-mono">{folder}/</span></p> : null}</div>
      <form onSubmit={submit} className="flex-1 space-y-4 p-5">
        <label className="block text-xs text-gray-500">
          Filename
          <input autoFocus className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500" value={filename} onChange={(event) => setFilename(event.target.value)} required placeholder="status-update.pptx" />
        </label>
        {filename ? <p className="text-xs text-gray-400">Path: <span className="font-mono">{fullPath}</span></p> : null}
        <p className="text-xs text-gray-400">Creates an editable presentation you can export as `.pptx`.</p>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <div className="flex gap-2 pt-2"><Btn type="submit" size="sm" loading={isPending}>Create</Btn><Btn type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn></div>
      </form>
    </div>
  )
}

function ProjectNewFolderPanel({ parentPath, onCreate, onCancel, onSubmit, isPending }: {
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
    try { await onSubmit(fullPath); onCreate(fullPath) } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create folder.') }
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4"><FolderPlus size={18} className="flex-shrink-0 text-amber-500" /><div><h2 className="text-sm font-semibold text-gray-900">New Folder</h2>{parentPath ? <p className="mt-0.5 text-xs text-gray-400">in {parentPath}</p> : null}</div></div>
      <div className="flex-1 space-y-4 p-6">
        <label className="block text-xs font-medium text-gray-600">
          Folder name
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleCreate(); if (event.key === 'Escape') onCancel() }} placeholder="e.g. legal, marketing" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500" />
        </label>
        {trimmed ? <p className="text-xs text-gray-400">Will create: <span className="font-mono text-gray-600">{fullPath}</span></p> : null}
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <div className="flex items-center gap-2 pt-2"><Btn onClick={() => { void handleCreate() }} loading={isPending} disabled={!trimmed}>Create Folder</Btn><Btn variant="ghost" onClick={onCancel}>Cancel</Btn></div>
      </div>
    </div>
  )
}

export default function ProjectAssetsWorkspacePanel({
  workspaceId,
  projectId,
  projectSlug,
  projectTitle,
  railActions,
  assetChatVisible = false,
  assetChatPanel,
}: {
  workspaceId: string
  projectId: string
  projectSlug: string
  projectTitle: string
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
  const locationSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const urlAssetPath = locationSearchParams.get('path')
  const urlHasFolder = locationSearchParams.has('folder')
  const urlFolder = urlHasFolder ? (locationSearchParams.get('folder') ?? '') : null
  const initialFolder = urlAssetPath
    ? urlAssetPath.split('/').slice(0, -1).join('/')
    : urlHasFolder
      ? (urlFolder ?? '')
      : selection?.scopeKind === 'project' && selection.projectSlug === projectSlug
        ? (selection.assetType === 'folder' ? selection.path : selection.path.split('/').slice(0, -1).join('/'))
        : ''
  const initialFilePath = urlAssetPath ?? (
    selection?.scopeKind === 'project' && selection.projectSlug === projectSlug && (selection.assetType === 'file' || selection.assetType === 'knowledge-file')
      ? selection.path
      : null
  )
  const { data: docs = [] } = useProjectDocuments(workspaceId, projectSlug)
  const { data: projectFolders = [] } = useProjectFolders(workspaceId, projectSlug)
  const { data: workflows = [], isLoading: workflowsLoading } = useGraphs(workspaceId, projectId)
  const { data: workspaceWorkflows = [] } = useGraphs(workspaceId)
  const { data: knowledgeFiles = [] } = useKnowledgeFiles()
  const browserState = useFileBrowserState({
    initialFolder,
    initialFilePath,
  })
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [fileQuery, setFileQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ProjectDeleteTarget | null>(null)
  const returnTarget = readAssetChatReturnTarget(location)
  const assetChatNavigateOptions = buildAssetChatNavigateOptions(
    null,
    snapshot,
  )

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

  const { currentFolder, rightPanel, setCurrentFolder, setRightPanel } = browserState
  const activeAssetChat = useMemo(() => {
    if (rightPanel.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === rightPanel.graphId)
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
    if (rightPanel.kind === 'file') {
      const projectDoc = docs.find((doc) => doc.path === rightPanel.path)
      return {
        assetType: 'file' as const,
        asset_id: projectDoc?.id ?? null,
        path: rightPanel.path,
        project_id: projectId,
        label: rightPanel.path,
      }
    }
    if (rightPanel.kind === 'knowledge-file') {
      const knowledgeFile = knowledgeFiles.find((file) => file.path === rightPanel.path)
      return {
        assetType: 'file' as const,
        asset_id: knowledgeFile?.id ?? null,
        path: rightPanel.path,
        project_id: null,
        label: rightPanel.path,
      }
    }
    const currentProjectFolder = projectFolders.find((folder) => folder.path === currentFolder)
    return {
      assetType: 'folder' as const,
      asset_id: currentProjectFolder?.id ?? null,
      path: currentFolder,
      project_id: projectId,
      label: currentFolder || projectTitle,
    }
  }, [currentFolder, docs, knowledgeFiles, projectFolders, projectId, projectTitle, rightPanel])

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
    if (!activeAssetChat) return
    if (activeAssetChat.project_id == null) {
      navigate(knowledgeFilePath(activeAssetChat.path, { assetChat: true }), assetChatNavigateOptions)
      return
    }
    navigate(
      activeAssetChat.assetType === 'folder'
        ? projectAssetFolderPath(projectSlug, activeAssetChat.path, { assetChat: true })
        : activeAssetChat.assetType === 'workflow'
          ? projectAssetWorkflowPath(projectSlug, activeAssetChat.path, { assetChat: true })
          : projectAssetFilePath(projectSlug, activeAssetChat.path, { assetChat: true }),
      assetChatNavigateOptions,
    )
  }
  useEffect(() => {
    if (urlAssetPath || urlHasFolder) return
    if (selection?.scopeKind !== 'project' || selection.projectSlug !== projectSlug || selection.assetType !== 'workflow') return
    const workflow = workflowEntries.find((entry) => entry.graphId === selection.graphId)
    if (!workflow) return
    const folderPath = workflow.path.split('/').slice(0, -1).join('/')
    if (currentFolder !== folderPath) setCurrentFolder(folderPath)
    if (rightPanel.kind !== 'workflow' || rightPanel.graphId !== workflow.graphId || rightPanel.path !== workflow.path) {
      setRightPanel({ kind: 'workflow', graphId: workflow.graphId!, path: workflow.path })
    }
  }, [currentFolder, projectSlug, rightPanel, selection, setCurrentFolder, setRightPanel, urlAssetPath, urlHasFolder, workflowEntries])

  useEffect(() => {
    if (rightPanel.kind === 'workflow') {
      const workflow = workflowEntries.find((entry) => entry.graphId === rightPanel.graphId)
      if (!workflow) return
      setSelection({
        scopeKind: 'project',
        workspaceId,
        projectSlug,
        projectTitle,
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
        projectTitle,
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
      projectTitle,
      assetType: 'folder',
      path: currentFolder,
      label: currentFolder || projectTitle,
    })
  }, [currentFolder, projectSlug, projectTitle, rightPanel, setSelection, workflowEntries, workspaceId])

  useEffect(() => {
    const matchedWorkflow = urlAssetPath
      ? workflowEntries.find((entry) => entry.path === normalizeAssetPath(urlAssetPath)) ?? null
      : null

    if (urlAssetPath && matchedWorkflow) {
      const folder = getAssetParentFolder(matchedWorkflow.path)
      if (currentFolder !== folder) setCurrentFolder(folder)
      if (
        (rightPanel.kind === 'file' || rightPanel.kind === 'folder' || rightPanel.kind === 'workflow' || rightPanel.kind === 'knowledge-file')
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
        (rightPanel.kind === 'file' || rightPanel.kind === 'folder' || rightPanel.kind === 'workflow' || rightPanel.kind === 'knowledge-file')
        && (rightPanel.kind !== 'file' || rightPanel.path !== urlAssetPath)
      ) {
        setRightPanel({ kind: 'file', path: urlAssetPath })
      }
      return
    }

    if (!urlHasFolder) return

    if (currentFolder !== urlFolder) setCurrentFolder(urlFolder ?? '')
    if (rightPanel.kind === 'file' || rightPanel.kind === 'workflow' || rightPanel.kind === 'knowledge-file') {
      setRightPanel({ kind: 'folder' })
    }
  }, [currentFolder, rightPanel, setCurrentFolder, setRightPanel, urlAssetPath, urlFolder, urlHasFolder, workflowEntries, workflowsLoading])

  function navigateProjectAssetSelection(selection: { kind: 'file' | 'folder' | 'workflow'; path: string }) {
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

  function openProjectFilePath(path: string) {
    navigateProjectAssetSelection({ kind: 'file', path })
  }

  function openProjectFolderPath(path: string) {
    navigateProjectAssetSelection({ kind: 'folder', path })
  }

  function openWorkflowPanel(graphId: string) {
    const workflow = workflowEntries.find((entry) => entry.graphId === graphId)
    if (!workflow) return
    navigateProjectAssetSelection({ kind: 'workflow', path: workflow.path })
  }

  function handleProjectFolderRename(path: string, newName: string) {
    const segments = path.split('/').filter(Boolean)
    const parent = segments.slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${newName}` : newName
    renameProjectFolder.mutate({ path, new_path: nextPath }, {
      onSuccess: () => {
        if (browserState.rightPanel.kind === 'file' && browserState.rightPanel.path.startsWith(`${path}/`)) {
          const suffix = browserState.rightPanel.path.slice(path.length)
          openProjectFilePath(`${nextPath}${suffix}`)
          return
        }
        if (browserState.currentFolder === path || browserState.currentFolder.startsWith(`${path}/`)) {
          const suffix = browserState.currentFolder.slice(path.length)
          openProjectFolderPath(`${nextPath}${suffix}`)
        }
      },
    })
  }

  function handleProjectFileRename(path: string, newPath: string) {
    renameProjectDocument.mutate({ path, new_path: newPath }, {
      onSuccess: (file) => {
        if (browserState.rightPanel.kind === 'file' && browserState.rightPanel.path === path) openProjectFilePath(file.path)
      },
    })
  }

  function handleProjectMoveConfirm(destination: string) {
    if (!browserState.movingTarget) return
    if (browserState.movingTarget.kind === 'file') {
      const filename = browserState.movingTarget.path.split('/').pop() ?? ''
      handleProjectFileRename(browserState.movingTarget.path, destination ? `${destination}/${filename}` : filename)
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
            openProjectFolderPath(deleteTarget.path.split('/').slice(0, -1).join('/'))
          }
          setDeleteTarget(null)
        },
      })
      return
    }
    if (deleteTarget.kind === 'folder') {
      deleteProjectFolder.mutate(deleteTarget.path, {
        onSuccess: () => {
          const parentFolder = deleteTarget.path.split('/').slice(0, -1).join('/')
          const affectsCurrentFolder = browserState.currentFolder === deleteTarget.path || browserState.currentFolder.startsWith(`${deleteTarget.path}/`)
          const affectsOpenFile = (
            (browserState.rightPanel.kind === 'file' || browserState.rightPanel.kind === 'knowledge-file')
            && browserState.rightPanel.path.startsWith(`${deleteTarget.path}/`)
          )
          if (affectsCurrentFolder || affectsOpenFile) {
            openProjectFolderPath(parentFolder)
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

  const busy = renameProjectDocument.isPending || updateGraph.isPending || renameProjectFolder.isPending || deleteProjectDocument.isPending || deleteProjectFolder.isPending || deleteGraph.isPending || uploadProjectFile.isPending
  const busyLabel = renameProjectDocument.isPending
    ? 'Renaming…'
    : renameProjectFolder.isPending
      ? 'Renaming folder…'
      : updateGraph.isPending
        ? 'Updating workflow…'
        : deleteProjectDocument.isPending || deleteProjectFolder.isPending || deleteGraph.isPending
          ? 'Deleting…'
          : uploadProjectFile.isPending
            ? 'Uploading…'
            : undefined

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleProjectFileUpload(file, browserState.currentFolder)
          event.target.value = ''
        }}
      />

      <FileBrowserShell
        files={allEntries}
        folderPaths={folderPaths}
        searchResults={searchResults}
        searching={false}
        fileQuery={fileQuery}
        onFileQueryChange={setFileQuery}
        rootLabel={projectTitle}
        railActions={railActions}
        state={browserState}
        onRenameFile={handleProjectFileRename}
        onRenameWorkflow={(graphId, name) => updateGraph.mutate({ graphId, name })}
        onRenameFolder={handleProjectFolderRename}
        onMoveTo={(target: ContextTarget) => browserState.setMovingTarget(target)}
        onDeleteFile={(path) => setDeleteTarget({ kind: 'file', path })}
        onDeleteWorkflow={(graphId) => {
          const workflow = workflows.find((item) => item.id === graphId)
          if (!workflow) return
          setDeleteTarget({ kind: 'workflow', graphId, name: workflow.name })
        }}
        onDeleteFolder={(path) => setDeleteTarget({ kind: 'folder', path })}
        isBusy={busy}
        busyLabel={busyLabel}
        renamePending={renameProjectDocument.isPending || renameProjectFolder.isPending || updateGraph.isPending}
        onUploadClick={() => uploadInputRef.current?.click()}
        onDrop={async (event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file) await handleProjectFileUpload(file, browserState.currentFolder)
        }}
        onNavigateFolder={openProjectFolderPath}
        onNavigateFile={openProjectFilePath}
        onNavigateWorkflow={openWorkflowPanel}
        onFileCreated={openProjectFilePath}
        onWorkflowCreated={openWorkflowPanel}
        onUploadSaved={openProjectFilePath}
        renderKnowledgeFileView={(path) => <FileEditor path={path} />}
        renderFileView={(path) => <FileEditor path={path} workspaceId={workspaceId} projectId={projectSlug} />}
        renderWorkflowView={(graphId) => <GraphEditorWorkspace graphId={graphId} allowWorkflowChat={false} />}
        renderNewTextPanel={(folder, onCreate, onCancel) => (
          <ProjectNewFilePanel
            folder={folder}
            onCreate={onCreate}
            onCancel={onCancel}
            isPending={createProjectDocument.isPending}
            onSubmit={async (path) => { await createProjectDocument.mutateAsync({ path, title: path.split('/').pop(), content: '' }) }}
          />
        )}
        renderNewPresentationPanel={(folder, onCreate, onCancel) => (
          <ProjectNewPresentationPanel
            folder={folder}
            onCreate={onCreate}
            onCancel={onCancel}
            isPending={createProjectDocument.isPending}
            onSubmit={async (path, title, content) => { await createProjectDocument.mutateAsync({ path, title, content, file_type: 'presentation' }) }}
          />
        )}
        renderNewWorkflowPanel={(folder, onCreate, onCancel) => <NewWorkflowPanel folder={folder} projectId={projectId} onCreate={onCreate} onCancel={onCancel} />}
        renderNewFolderPanel={(parentPath, onDone, onCancel) => (
          <ProjectNewFolderPanel
            parentPath={parentPath}
            onCreate={(path) => { openProjectFolderPath(path); onDone() }}
            onCancel={onCancel}
            isPending={createProjectFolder.isPending}
            onSubmit={async (path) => { await createProjectFolder.mutateAsync(path) }}
          />
        )}
        renderUploadPanel={(preview, onSaved, onCancel) => (
          <UploadPreviewPanel
            preview={preview}
            onSaved={onSaved}
            onCancel={onCancel}
            isSaving={createProjectDocument.isPending}
            saveLabel="Save to Project"
            onSave={async (payload) => { await createProjectDocument.mutateAsync(payload) }}
          />
        )}
        allowNewFolder
        allowUpload
        allowFolderRename
        allowFolderMove={false}
        allowFolderDelete
        sidePanel={assetChatPanel}
        controlledSidePanelOpen={assetChatVisible}
        showToolbarChatButton={false}
        breadcrumbActions={activeAssetChat ? (
          <AssetChatToggleButton active={assetChatOpen} onClick={handleAssetChatToggle} label={`Open chat for ${activeAssetChat.label}`} />
        ) : undefined}
      />

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
