import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, FolderPlus, MessageSquare, Pencil, Plus, Save, Send, Sparkles, X } from 'lucide-react'
import { useChannelDecisions, useChannelMessages, usePostChannelMessage } from '@/api/channels'
import { useDeleteGraph, useGraphs, useUpdateGraph } from '@/api/graphs'
import {
  useCreateObjective,
  useCreateProjectDocument,
  useCreateProjectFolder,
  useCreateProjectStatusUpdate,
  useDeleteProjectFolder,
  useDeleteProjectDocument,
  useProjectDashboard,
  useProjectDocuments,
  useProjectFolders,
  useRenameProjectFolder,
  useRenameProjectDocument,
  useUploadProjectFile,
  useUpdateObjective,
} from '@/api/projects'
import { useAuthStore } from '@/store/auth'
import ObjectiveCanvas from '@/components/canvas/ObjectiveCanvas'
import FileBrowserShell from '@/components/file-browser/FileBrowserShell'
import { useFileBrowserState } from '@/components/file-browser/useFileBrowserState'
import type { BrowserFile } from '@/components/file-browser/types'
import type { ContextTarget } from '@/components/handbook/FileContextMenu'
import FileEditor from '@/components/handbook/FileEditor'
import MoveToDialog from '@/components/handbook/MoveToDialog'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import NewWorkflowPanel from '@/components/handbook/NewWorkflowPanel'
import UploadPreviewPanel from '@/components/handbook/UploadPreviewPanel'
import Btn from '@/components/shared/Btn'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import type { Objective } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

type ProjectView = 'objectives' | 'handbook' | 'channel'
type ObjectivePanelTab = 'info' | 'progress'
type ProjectDeleteTarget =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'workflow'; graphId: string; name: string }

function statusVariant(status: string): 'gray' | 'green' | 'orange' | 'red' {
  if (status === 'done' || status === 'completed') return 'green'
  if (status === 'blocked' || status === 'failed') return 'red'
  if (status === 'in_progress' || status === 'running') return 'orange'
  return 'gray'
}

function objectiveLabel(objective: Objective): string {
  return [objective.code, objective.title].filter(Boolean).join(' ')
}

function clampObjectiveTitle(title: string, max = 30): string {
  return title.length > max ? `${title.slice(0, Math.max(0, max - 3))}...` : title
}

function objectiveTreeLabel(objective: Objective): string {
  const shortTitle = clampObjectiveTitle(objective.title, 30)
  return [objective.code, shortTitle].filter(Boolean).join(' ')
}

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

function toBrowserEntry(
  file: {
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
  },
): BrowserFile {
  return {
    ...file,
    file_type: 'md',
    is_editable: true,
    created_at: file.updated_at,
    health_updated_at: null,
    entryKind: 'knowledge',
  }
}

function buildObjectiveTree(objectives: Objective[]) {
  const byParent = new Map<string | null, Objective[]>()
  for (const objective of objectives) {
    const key = objective.parent_objective_id ?? null
    const bucket = byParent.get(key) ?? []
    bucket.push(objective)
    byParent.set(key, bucket)
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title))
  }
  return byParent
}

function collectExpandableObjectiveIds(tree: Map<string | null, Objective[]>) {
  const ids = new Set<string>()
  for (const [parentId, children] of tree.entries()) {
    if (parentId && children.length > 0) ids.add(parentId)
  }
  return ids
}

function useChannelTimeline(workspaceId: string, channelId: string | null) {
  const { data: messages = [] } = useChannelMessages(workspaceId, channelId ?? '')
  const { data: decisions = [] } = useChannelDecisions(workspaceId, channelId ?? '')
  return useMemo(() => {
    const msgItems = messages.map((item) => ({
      id: `m-${item.id}`,
      kind: 'message' as const,
      ts: new Date(item.created_at).getTime(),
      data: item,
    }))
    const decisionItems = decisions.map((item) => ({
      id: `d-${item.id}`,
      kind: 'decision' as const,
      ts: new Date(item.created_at).getTime(),
      data: item,
    }))
    return [...msgItems, ...decisionItems].sort((a, b) => a.ts - b.ts)
  }, [decisions, messages])
}

function ObjectiveTreeList({
  objectives,
  selectedObjectiveId,
  onSelect,
}: {
  objectives: Objective[]
  selectedObjectiveId: string | null
  onSelect: (objectiveId: string) => void
}) {
  const tree = useMemo(() => buildObjectiveTree(objectives), [objectives])
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setCollapsedIds((current) => {
      const next = new Set<string>()
      const validIds = collectExpandableObjectiveIds(tree)
      for (const id of current) {
        if (validIds.has(id)) next.add(id)
      }
      return next
    })
  }, [tree])

  if ((tree.get(null) ?? []).length === 0) return <p className="text-sm text-gray-500">No objectives yet.</p>

  function toggleNode(objectiveId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(objectiveId)) next.delete(objectiveId)
      else next.add(objectiveId)
      return next
    })
  }

  function renderBranch(parentId: string | null, depth: number) {
    const branch = tree.get(parentId) ?? []
    return branch.map((objective) => {
      const children = tree.get(objective.id) ?? []
      const hasChildren = children.length > 0
      const isCollapsed = collapsedIds.has(objective.id)
      return (
        <div key={objective.id} className="space-y-1">
          <div
            className="flex items-start gap-1"
            style={{ paddingLeft: `${8 + depth * 18}px` }}
          >
            <button
              type="button"
              onClick={() => {
                if (hasChildren) toggleNode(objective.id)
              }}
              className={`mt-2 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
                hasChildren
                  ? 'text-stone-500 hover:bg-stone-200'
                  : 'text-transparent pointer-events-none'
              }`}
              aria-label={hasChildren ? (isCollapsed ? 'Expand objective' : 'Collapse objective') : undefined}
            >
              {hasChildren ? (isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />) : <ChevronRight size={14} />}
            </button>
            <button
              type="button"
              onClick={() => onSelect(objective.id)}
              className={`flex-1 rounded-xl px-2 py-2 text-left text-sm hover:bg-stone-100 ${
                selectedObjectiveId === objective.id ? 'bg-stone-100' : ''
              }`}
            >
              <p className={`font-semibold underline decoration-stone-300 underline-offset-4 ${
                selectedObjectiveId === objective.id ? 'text-stone-950' : 'text-stone-700'
              }`}
              >
                {objectiveTreeLabel(objective)}
              </p>
              <p className="mt-0.5 text-xs text-stone-500">
                {objective.progress_percent}% complete
              </p>
            </button>
          </div>
          {hasChildren && !isCollapsed ? renderBranch(objective.id, depth + 1) : null}
        </div>
      )
    })
  }

  return <div className="space-y-1">{renderBranch(null, 0)}</div>
}

function ChatTimeline({
  timeline,
  draft,
  setDraft,
  onSend,
  title,
}: {
  timeline: ReturnType<typeof useChannelTimeline>
  draft: string
  setDraft: (value: string) => void
  onSend: () => void
  title: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-stone-200 bg-[#faf7f1]">
      <div className="border-b border-stone-200 bg-white px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {timeline.length === 0 ? <p className="text-sm text-stone-500">No messages yet.</p> : timeline.map((item) => {
          if (item.kind === 'message') {
            const mine = item.data.role === 'user'
            return (
              <div key={item.id} className={`max-w-[90%] ${mine ? 'ml-auto' : 'mr-auto'}`}>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-stone-400">
                  {item.data.author_name ?? (item.data.author_type === 'human' ? 'You' : 'Agent')}
                </p>
                <div className={`rounded-2xl border px-4 py-2.5 text-sm ${mine ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-800'}`}>
                  {item.data.content}
                </div>
              </div>
            )
          }
          return (
            <div key={item.id} className="max-w-[90%] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-amber-700">Decision</p>
              <p className="text-sm text-amber-900">{item.data.decision_type.replace(/_/g, ' ')}</p>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 border-t border-stone-200 bg-white p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) onSend()
          }}
          placeholder="Type a message..."
          className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
        />
        <Btn size="sm" onClick={onSend} disabled={!draft.trim()}>
          <Send size={14} /> Send
        </Btn>
      </div>
    </div>
  )
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
          {folder ? (
            <p className="mt-0.5 text-xs text-gray-400">
              in <span className="font-mono">{folder}/</span>
            </p>
          ) : null}
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
          {filename ? (
            <p className="mt-1 text-xs text-gray-400">
              Path: <span className="font-mono">{fullPath}</span>
            </p>
          ) : null}
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

        {trimmed ? (
          <p className="text-xs text-gray-400">
            Will create: <span className="font-mono text-gray-600">{fullPath}</span>
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        <div className="flex items-center gap-2 pt-2">
          <Btn onClick={() => { void handleCreate() }} loading={isPending} disabled={!trimmed}>
            Create Folder
          </Btn>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  )
}

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: dashboard, isLoading } = useProjectDashboard(workspaceId, projectId)
  const { data: docs = [] } = useProjectDocuments(workspaceId, projectId)
  const { data: projectFolders = [] } = useProjectFolders(workspaceId, projectId)
  const { data: workflows = [] } = useGraphs(workspaceId, projectId)
  const handbookState = useFileBrowserState()
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const [view, setView] = useState<ProjectView>('objectives')
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null)
  const [hasAutoSelectedObjective, setHasAutoSelectedObjective] = useState(false)
  const [objectivePanelTab, setObjectivePanelTab] = useState<ObjectivePanelTab>('info')
  const [editingObjectiveHeading, setEditingObjectiveHeading] = useState(false)
  const [showObjectiveComposer, setShowObjectiveComposer] = useState(false)
  const [showStatusDialog, setShowStatusDialog] = useState(false)
  const [composerParentId, setComposerParentId] = useState<string | null>(null)
  const [projectStatusDraft, setProjectStatusDraft] = useState('')
  const [fileQuery, setFileQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ProjectDeleteTarget | null>(null)
  const [projectChatDraft, setProjectChatDraft] = useState('')
  const [objectiveChatDraft, setObjectiveChatDraft] = useState('')
  const [objectiveForm, setObjectiveForm] = useState({
    code: '',
    title: '',
    description: '',
    progress_percent: 0,
    status_summary: '',
    key_results_text: '',
    owner_name: '',
    deadline: '',
    status: 'open',
  })
  const [composerForm, setComposerForm] = useState({
    code: '',
    title: '',
    description: '',
  })

  const createObjective = useCreateObjective(workspaceId)
  const updateObjective = useUpdateObjective(workspaceId, selectedObjectiveId ?? '')
  const createProjectDocument = useCreateProjectDocument(workspaceId, projectId)
  const createProjectFolder = useCreateProjectFolder(workspaceId, projectId)
  const renameProjectFolder = useRenameProjectFolder(workspaceId, projectId)
  const deleteProjectFolder = useDeleteProjectFolder(workspaceId, projectId)
  const renameProjectDocument = useRenameProjectDocument(workspaceId, projectId)
  const deleteProjectDocument = useDeleteProjectDocument(workspaceId, projectId)
  const uploadProjectFile = useUploadProjectFile(workspaceId, projectId)
  const createStatus = useCreateProjectStatusUpdate(workspaceId, projectId)
  const updateGraph = useUpdateGraph(workspaceId)
  const deleteGraph = useDeleteGraph(workspaceId)

  const project = dashboard?.project
  const objectives = dashboard?.objectives ?? []
  const selectedObjective = objectives.find((item) => item.id === selectedObjectiveId) ?? null

  useEffect(() => {
    if (!hasAutoSelectedObjective && !selectedObjectiveId && objectives.length > 0) {
      setSelectedObjectiveId(objectives[0].id)
      setHasAutoSelectedObjective(true)
    }
  }, [hasAutoSelectedObjective, objectives, selectedObjectiveId])

  useEffect(() => {
    if (!selectedObjective) return
    setObjectivePanelTab('info')
    setEditingObjectiveHeading(false)
    setObjectiveForm({
      code: selectedObjective.code ?? '',
      title: selectedObjective.title,
      description: selectedObjective.description ?? '',
      progress_percent: selectedObjective.progress_percent ?? 0,
      status_summary: selectedObjective.status_summary ?? '',
      key_results_text: (selectedObjective.key_results ?? []).join('\n'),
      owner_name: selectedObjective.owner_name ?? '',
      deadline: selectedObjective.deadline ?? '',
      status: selectedObjective.status,
    })
  }, [selectedObjective?.id])

  const projectChannelId = project?.project_channel_id ?? null
  const projectTimeline = useChannelTimeline(workspaceId, projectChannelId)
  const objectiveTimeline = useChannelTimeline(workspaceId, selectedObjective?.channel_id ?? null)
  const postProjectMessage = usePostChannelMessage(workspaceId, projectChannelId ?? '')
  const postObjectiveMessage = usePostChannelMessage(workspaceId, selectedObjective?.channel_id ?? '')
  const workflowEntries = useMemo<BrowserFile[]>(
    () => workflows.map((graph) => ({
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
    [workflows],
  )
  const allHandbookEntries = useMemo<BrowserFile[]>(
    () => [
      ...docs.map((doc) => toBrowserEntry(doc)),
      ...workflowEntries,
    ],
    [docs, workflowEntries],
  )
  const handbookFolderPaths = useMemo(
    () => Array.from(new Set([
      ...collectFolderPaths(allHandbookEntries.map((entry) => entry.path)),
      ...projectFolders.map((folder) => folder.path),
    ])).sort((a, b) => a.localeCompare(b)),
    [allHandbookEntries, projectFolders],
  )
  const handbookSearchResults = useMemo(() => {
    const q = fileQuery.trim().toLowerCase()
    if (!q) return []
    return allHandbookEntries.filter((entry) =>
      [entry.title, entry.description, entry.path]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [allHandbookEntries, fileQuery])

  function openProjectFilePath(path: string) {
    handbookState.setCurrentFolder(path.split('/').slice(0, -1).join('/'))
    handbookState.setRightPanel({ kind: 'file', path })
  }

  function openProjectFolderPath(path: string) {
    handbookState.setCurrentFolder(path)
    handbookState.setRightPanel({ kind: 'folder' })
  }

  function handleProjectFolderRename(path: string, newName: string) {
    const segments = path.split('/').filter(Boolean)
    const parent = segments.slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${newName}` : newName
    renameProjectFolder.mutate(
      { path, new_path: nextPath },
      {
        onSuccess: () => {
          if (handbookState.currentFolder === path || handbookState.currentFolder.startsWith(`${path}/`)) {
            const suffix = handbookState.currentFolder.slice(path.length)
            handbookState.setCurrentFolder(`${nextPath}${suffix}`)
          }
          if (handbookState.rightPanel.kind === 'folder') {
            handbookState.setRightPanel({ kind: 'folder' })
          } else if (handbookState.rightPanel.kind === 'file' && handbookState.rightPanel.path.startsWith(`${path}/`)) {
            const suffix = handbookState.rightPanel.path.slice(path.length)
            openProjectFilePath(`${nextPath}${suffix}`)
          }
        },
      },
    )
  }

  function handleProjectFileRename(path: string, newPath: string) {
    renameProjectDocument.mutate(
      { path, new_path: newPath },
      {
        onSuccess: (file) => {
          if (handbookState.rightPanel.kind === 'file' && handbookState.rightPanel.path === path) {
            openProjectFilePath(file.path)
          }
        },
      },
    )
  }

  function handleProjectWorkflowRename(graphId: string, newName: string) {
    updateGraph.mutate({ graphId, name: newName })
  }

  function handleProjectMoveTo(target: ContextTarget) {
    handbookState.setMovingTarget(target)
  }

  function confirmProjectDelete() {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'file') {
      deleteProjectDocument.mutate(deleteTarget.path, {
        onSuccess: () => {
          if (handbookState.rightPanel.kind === 'file' && handbookState.rightPanel.path === deleteTarget.path) {
            handbookState.goBack()
          }
          setDeleteTarget(null)
        },
      })
      return
    }
    if (deleteTarget.kind === 'folder') {
      deleteProjectFolder.mutate(deleteTarget.path, {
        onSuccess: () => {
          if (handbookState.currentFolder === deleteTarget.path || handbookState.currentFolder.startsWith(`${deleteTarget.path}/`)) {
            handbookState.setCurrentFolder(deleteTarget.path.split('/').slice(0, -1).join('/'))
          }
          if (handbookState.rightPanel.kind === 'folder') {
            handbookState.setRightPanel({ kind: 'folder' })
          } else if (handbookState.rightPanel.kind === 'file' && handbookState.rightPanel.path.startsWith(`${deleteTarget.path}/`)) {
            handbookState.goBack()
          }
          setDeleteTarget(null)
        },
      })
      return
    }
    deleteGraph.mutate(deleteTarget.graphId, {
      onSuccess: () => setDeleteTarget(null),
    })
  }

  function handleProjectMoveConfirm(destination: string) {
    if (!handbookState.movingTarget) return
    if (handbookState.movingTarget.kind === 'file') {
      const filename = handbookState.movingTarget.path.split('/').pop() ?? ''
      handleProjectFileRename(
        handbookState.movingTarget.path,
        destination ? `${destination}/${filename}` : filename,
      )
    } else if (handbookState.movingTarget.kind === 'workflow') {
      updateGraph.mutate({ graphId: handbookState.movingTarget.graphId, path: destination })
    }
    handbookState.setMovingTarget(null)
  }

  async function handleProjectFileUpload(file: File, folder = '') {
    const preview = await uploadProjectFile.mutateAsync({ file, folder })
    handbookState.setRightPanel({ kind: 'upload', preview, folder })
  }

  if (isLoading || !project) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  async function submitObjectiveForm() {
    if (!selectedObjective) return
    await updateObjective.mutateAsync({
      code: objectiveForm.code || undefined,
      title: objectiveForm.title,
      description: objectiveForm.description || undefined,
      progress_percent: Number(objectiveForm.progress_percent),
      status_summary: objectiveForm.status_summary || undefined,
      key_results: objectiveForm.key_results_text.split('\n').map((item) => item.trim()).filter(Boolean),
      owner_name: objectiveForm.owner_name || undefined,
      owner_type: objectiveForm.owner_name ? 'human' : undefined,
      deadline: objectiveForm.deadline || undefined,
      status: objectiveForm.status,
    })
  }

  async function createNewObjective() {
    if (!composerForm.title.trim()) return
    const objective = await createObjective.mutateAsync({
      code: composerForm.code.trim() || undefined,
      title: composerForm.title.trim(),
      description: composerForm.description.trim() || undefined,
      project_id: projectId,
      parent_objective_id: composerParentId ?? undefined,
      status_summary: 'New objective. Needs a first update.',
    })
    setShowObjectiveComposer(false)
    setComposerParentId(null)
    setComposerForm({ code: '', title: '', description: '' })
    setSelectedObjectiveId(objective.id)
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-8">
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            void handleProjectFileUpload(file, handbookState.currentFolder)
          }
          e.target.value = ''
        }}
      />
      <div>
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950">{project.title}</h1>
          <Badge variant={statusVariant(project.status)}>{project.status.replace('_', ' ')}</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs uppercase tracking-wide text-stone-500">
          <span>Deadline: {project.deadline ? new Date(project.deadline).toLocaleDateString() : 'None'}</span>
          <span>{objectives.length} objectives</span>
          <span>{project.run_count} runs</span>
        </div>
        <p className="mt-4 max-w-4xl text-sm leading-6 text-stone-700">{project.description}</p>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-stone-200 pt-4">
          <div className="max-w-4xl">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              <Sparkles size={13} /> Current Status
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              {dashboard?.latest_status_update?.summary ?? 'No project summary yet.'}
            </p>
          </div>
          <Btn size="sm" onClick={() => setShowStatusDialog(true)}>
            <Send size={14} /> Update Status
          </Btn>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['objectives', 'handbook', 'channel'] as ProjectView[]).map((item) => (
          <button
            key={item}
            onClick={() => setView(item)}
            className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${
              view === item ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {view === 'objectives' && (
        <div className="min-h-[760px]">
          <Card className="relative overflow-hidden rounded-[32px] border-stone-200 bg-[#e9e4d8] p-4">
            <div className="mb-3 flex items-center justify-between gap-3 px-2">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Objective Tree</p>
                <p className="mt-1 text-sm text-stone-700">Map the project as a hierarchy of objectives.</p>
              </div>
              <Btn
                size="sm"
                onClick={() => {
                  setComposerParentId(null)
                  setShowObjectiveComposer(true)
                }}
              >
                <Plus size={14} /> New Objective
              </Btn>
            </div>
            <div className="h-[700px]">
              <ObjectiveCanvas
                objectives={objectives}
                selectedObjectiveId={selectedObjectiveId}
                onSelectObjective={(objectiveId) => {
                  setSelectedObjectiveId(objectiveId)
                  if (objectiveId) setObjectivePanelTab('info')
                }}
              />
            </div>
            {selectedObjective ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-16 py-10">
                <button
                  type="button"
                  aria-label="Close objective detail"
                  onClick={() => setSelectedObjectiveId(null)}
                  className="pointer-events-auto absolute inset-0 cursor-default"
                />
                <Card className="pointer-events-auto w-full max-w-2xl rounded-[32px] border-stone-200 bg-white/96 p-5 shadow-2xl backdrop-blur">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Objective Detail</p>
                      <div className="mt-3 flex items-start gap-3">
                        {editingObjectiveHeading ? (
                          <div className="grid flex-1 gap-3 md:grid-cols-[120px_1fr]">
                            <input
                              autoFocus
                              value={objectiveForm.code}
                              onChange={(e) => setObjectiveForm((current) => ({ ...current, code: e.target.value.slice(0, 5) }))}
                              className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold uppercase outline-none focus:ring-2 focus:ring-stone-900"
                            />
                            <input
                              value={objectiveForm.title}
                              onChange={(e) => setObjectiveForm((current) => ({ ...current, title: e.target.value }))}
                              className="rounded-xl border border-stone-300 px-3 py-2 text-base font-semibold outline-none focus:ring-2 focus:ring-stone-900"
                            />
                          </div>
                        ) : (
                          <div className="flex-1">
                            <h2 className="text-2xl font-semibold text-stone-950">
                              {[objectiveForm.code || selectedObjective.code, objectiveForm.title || selectedObjective.title].filter(Boolean).join(' · ')}
                            </h2>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingObjectiveHeading((value) => !value)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 text-stone-500 hover:bg-stone-100"
                          title="Edit code and title"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(objectiveForm.status)}>{objectiveForm.status.replace('_', ' ')}</Badge>
                      <button
                        type="button"
                        onClick={() => setSelectedObjectiveId(null)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 text-stone-500 hover:bg-stone-100"
                        title="Close"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    {(['info', 'progress'] as ObjectivePanelTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setObjectivePanelTab(tab)}
                        className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${
                          objectivePanelTab === tab ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {objectivePanelTab === 'info' ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="text-sm text-stone-600 md:col-span-2">
                        Description
                        <textarea
                          rows={4}
                          value={objectiveForm.description}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, description: e.target.value }))}
                          className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                      <label className="text-sm text-stone-600">
                        In Charge
                        <input
                          value={objectiveForm.owner_name}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, owner_name: e.target.value }))}
                          placeholder="Human or agent"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                      <label className="text-sm text-stone-600">
                        Deadline
                        <input
                          type="date"
                          value={objectiveForm.deadline}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, deadline: e.target.value }))}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                      <label className="text-sm text-stone-600 md:col-span-2">
                        Status
                        <select
                          value={objectiveForm.status}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, status: e.target.value }))}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        >
                          <option value="open">open</option>
                          <option value="in_progress">in progress</option>
                          <option value="blocked">blocked</option>
                          <option value="done">done</option>
                        </select>
                      </label>
                      <label className="text-sm text-stone-600 md:col-span-2">
                        Key Results
                        <textarea
                          rows={5}
                          value={objectiveForm.key_results_text}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, key_results_text: e.target.value }))}
                          placeholder="One key result per line"
                          className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="flex items-center justify-between text-sm text-stone-600">
                          <span>Progress</span>
                          <span>{objectiveForm.progress_percent}%</span>
                        </div>
                        <div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-200">
                          <div
                            className="h-full rounded-full bg-stone-900 transition-all"
                            style={{ width: `${objectiveForm.progress_percent}%` }}
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={objectiveForm.progress_percent}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, progress_percent: Number(e.target.value) }))}
                          className="mt-3 w-full"
                        />
                      </div>
                      <label className="block text-sm text-stone-600">
                        Current Status
                        <textarea
                          rows={4}
                          value={objectiveForm.status_summary}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, status_summary: e.target.value }))}
                          className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Btn size="sm" onClick={submitObjectiveForm} loading={updateObjective.isPending}>
                      <Save size={14} /> Save Objective
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setComposerParentId(selectedObjective.id)
                        setShowObjectiveComposer(true)
                      }}
                    >
                      <FolderPlus size={14} /> New Child Objective
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => setView('channel')}
                    >
                      <MessageSquare size={14} /> Open Objective Chat
                    </Btn>
                  </div>
                </Card>
              </div>
            ) : null}
          </Card>

          <Card className="mt-5 rounded-[32px] border-stone-200 bg-white p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Recent Run Activity</p>
            <div className="mt-4 space-y-3">
              {dashboard.recent_runs.length === 0 ? <p className="text-sm text-stone-500">No runs yet.</p> : dashboard.recent_runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => navigate(`/runs/${run.id}`)}
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-left hover:bg-stone-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-stone-900">{run.name || run.id}</p>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {view === 'handbook' && (
        <>
          <div className="h-[760px] overflow-hidden bg-white">
            <FileBrowserShell
              files={allHandbookEntries}
              folderPaths={handbookFolderPaths}
              searchResults={handbookSearchResults}
              searching={false}
              fileQuery={fileQuery}
              onFileQueryChange={setFileQuery}
              state={handbookState}
              onRenameFile={handleProjectFileRename}
              onRenameWorkflow={handleProjectWorkflowRename}
              onRenameFolder={handleProjectFolderRename}
              onMoveTo={handleProjectMoveTo}
              onDeleteFile={(path) => setDeleteTarget({ kind: 'file', path })}
              onDeleteWorkflow={(graphId) => {
                const graph = workflows.find((item) => item.id === graphId)
                if (!graph) return
                setDeleteTarget({ kind: 'workflow', graphId, name: graph.name })
              }}
              onDeleteFolder={(path) => setDeleteTarget({ kind: 'folder', path })}
              isBusy={
                renameProjectDocument.isPending
                || updateGraph.isPending
                || renameProjectFolder.isPending
                || deleteProjectDocument.isPending
                || deleteProjectFolder.isPending
                || deleteGraph.isPending
                || uploadProjectFile.isPending
              }
              busyLabel={
                renameProjectDocument.isPending
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
              }
              renamePending={renameProjectDocument.isPending || renameProjectFolder.isPending || updateGraph.isPending}
              onUploadClick={() => uploadInputRef.current?.click()}
              onDrop={async (e) => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file) await handleProjectFileUpload(file, handbookState.currentFolder)
              }}
              onNavigateFolder={openProjectFolderPath}
              onNavigateFile={openProjectFilePath}
              onNavigateWorkflow={(graphId) => navigate(`/graphs/${graphId}`)}
              onFileCreated={openProjectFilePath}
              onWorkflowCreated={(graphId) => navigate(`/graphs/${graphId}`)}
              onUploadSaved={openProjectFilePath}
              renderFileView={(path) => (
                <FileEditor path={path} workspaceId={workspaceId} projectId={projectId} />
              )}
              renderWorkflowView={() => null}
              renderNewFilePanel={(folder, onCreate, onCancel) => (
                <ProjectNewFilePanel
                  folder={folder}
                  onCreate={onCreate}
                  onCancel={onCancel}
                  isPending={createProjectDocument.isPending}
                  onSubmit={async (path) => {
                    await createProjectDocument.mutateAsync({
                      path,
                      title: path.split('/').pop(),
                      content: '',
                    })
                  }}
                />
              )}
              renderNewWorkflowPanel={(folder, onCreate, onCancel) => (
                <NewWorkflowPanel
                  folder={folder}
                  projectId={projectId}
                  onCreate={onCreate}
                  onCancel={onCancel}
                />
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
                  onSave={async (payload) => {
                    await createProjectDocument.mutateAsync(payload)
                  }}
                  isSaving={createProjectDocument.isPending}
                  saveLabel="Save to Project"
                />
              )}
              allowNewFolder
              allowUpload
              allowFolderRename
              allowFolderMove={false}
              allowFolderDelete
            />
          </div>

          {handbookState.movingTarget ? (
            <MoveToDialog
              title={`Move "${handbookState.movingTarget.path.split('/').pop()}"`}
              movingTargetKind={handbookState.movingTarget.kind}
              movingTargetPath={handbookState.movingTarget.path}
              browserFiles={allHandbookEntries}
              folderPaths={handbookFolderPaths}
              onConfirm={handleProjectMoveConfirm}
              onCancel={() => handbookState.setMovingTarget(null)}
              isPending={renameProjectDocument.isPending || updateGraph.isPending}
            />
          ) : null}

          {deleteTarget ? (
            <ConfirmDialog
              title={
                deleteTarget.kind === 'file'
                  ? 'Delete File'
                  : deleteTarget.kind === 'folder'
                    ? 'Delete Folder'
                    : 'Archive or Delete Workflow'
              }
              message={
                deleteTarget.kind === 'file'
                  ? `Delete "${deleteTarget.path}"?`
                  : deleteTarget.kind === 'folder'
                    ? `Delete folder "${deleteTarget.path}" and its contents?`
                    : `Archive or delete "${deleteTarget.name}"?`
              }
              warning={
                deleteTarget.kind === 'file'
                  ? 'This action cannot be undone.'
                  : deleteTarget.kind === 'folder'
                    ? 'All files and sub-folders inside this folder will be deleted.'
                    : 'Workflows with runs are archived. Workflows without runs are deleted.'
              }
              confirmLabel={deleteTarget.kind === 'workflow' ? 'Continue' : 'Delete'}
              confirmVariant="danger"
              isPending={
                deleteTarget.kind === 'file'
                  ? deleteProjectDocument.isPending
                  : deleteTarget.kind === 'folder'
                    ? deleteProjectFolder.isPending
                    : deleteGraph.isPending
              }
              onCancel={() => setDeleteTarget(null)}
              onConfirm={confirmProjectDelete}
            />
          ) : null}
        </>
      )}

      {view === 'channel' && (
        <div className="grid min-h-[720px] gap-5 lg:grid-cols-[320px_1fr]">
          <Card className="rounded-[32px] border-stone-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Objectives</p>
              <Btn size="sm" variant="ghost" onClick={() => setSelectedObjectiveId(null)}>
                Project
              </Btn>
            </div>
            <button
              onClick={() => setSelectedObjectiveId(null)}
              className={`mt-4 w-full rounded-2xl px-3 py-3 text-left text-sm ${
                selectedObjectiveId === null ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              <p className="font-semibold">Project Channel</p>
              <p className={`mt-1 text-xs ${selectedObjectiveId === null ? 'text-stone-300' : 'text-stone-500'}`}>General coordination and updates</p>
            </button>
            <div className="mt-4 max-h-[600px] overflow-y-auto">
              <ObjectiveTreeList
                objectives={objectives}
                selectedObjectiveId={selectedObjectiveId}
                onSelect={(objectiveId) => setSelectedObjectiveId(objectiveId)}
              />
            </div>
          </Card>

          {selectedObjectiveId && selectedObjective ? (
            <ChatTimeline
              title={`Objective Chat · ${objectiveLabel(selectedObjective)}`}
              timeline={objectiveTimeline}
              draft={objectiveChatDraft}
              setDraft={setObjectiveChatDraft}
              onSend={() => {
                if (!selectedObjective.channel_id || !objectiveChatDraft.trim()) return
                postObjectiveMessage.mutate(
                  { content: objectiveChatDraft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
                  { onSuccess: () => setObjectiveChatDraft('') },
                )
              }}
            />
          ) : (
            <ChatTimeline
              title="Project Channel"
              timeline={projectTimeline}
              draft={projectChatDraft}
              setDraft={setProjectChatDraft}
              onSend={() => {
                if (!projectChannelId || !projectChatDraft.trim()) return
                postProjectMessage.mutate(
                  { content: projectChatDraft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
                  { onSuccess: () => setProjectChatDraft('') },
                )
              }}
            />
          )}
        </div>
      )}

      {showObjectiveComposer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-[32px] bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-stone-950">
              {composerParentId ? 'New Child Objective' : 'New Objective'}
            </h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void createNewObjective()
              }}
            >
              <div className="grid gap-4 md:grid-cols-[120px_1fr]">
                <label className="text-sm text-stone-600">
                  Code
                  <input
                    value={composerForm.code}
                    onChange={(e) => setComposerForm((current) => ({ ...current, code: e.target.value.slice(0, 5) }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </label>
                <label className="text-sm text-stone-600">
                  Title
                  <input
                    autoFocus
                    value={composerForm.title}
                    onChange={(e) => setComposerForm((current) => ({ ...current, title: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </label>
              </div>
              <label className="block text-sm text-stone-600">
                Description
                <textarea
                  rows={4}
                  value={composerForm.description}
                  onChange={(e) => setComposerForm((current) => ({ ...current, description: e.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Btn type="button" variant="ghost" size="sm" onClick={() => setShowObjectiveComposer(false)}>Cancel</Btn>
                <Btn type="submit" size="sm" loading={createObjective.isPending}>Create Objective</Btn>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStatusDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-[32px] bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-stone-950">Update Project Status</h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (!projectStatusDraft.trim()) return
                createStatus.mutate(
                  { summary: projectStatusDraft.trim(), author_name: 'You' },
                  {
                    onSuccess: () => {
                      setProjectStatusDraft('')
                      setShowStatusDialog(false)
                    },
                  },
                )
              }}
            >
              <textarea
                rows={6}
                value={projectStatusDraft}
                onChange={(e) => setProjectStatusDraft(e.target.value)}
                placeholder="Write a concise project status update."
                className="w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
              />
              <div className="flex justify-end gap-2">
                <Btn type="button" variant="ghost" size="sm" onClick={() => setShowStatusDialog(false)}>Cancel</Btn>
                <Btn type="submit" size="sm" loading={createStatus.isPending}>
                  <Send size={14} /> Save Status
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
