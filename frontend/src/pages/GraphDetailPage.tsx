import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronLeft,
  Copy,
  GitBranch,
  Globe,
  Loader2,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  ChevronDown,
  Search,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import {
  useArchiveVersion,
  useDeleteGraph,
  useDeleteVersion,
  useForkVersion,
  useGraph,
  useGraphs,
  useGraphVersions,
  usePromoteDraft,
  usePromoteRootDraft,
  useRenameVersion,
  useSetProduction,
  useUnarchiveVersion,
  useUpdateGraph,
  useUpsertRootDraft,
  useUpsertVersionDraft,
} from '@/api/graphs'
import { useRuns } from '@/api/runs'
import { useSearchKnowledgeFiles } from '@/api/knowledge'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import NodeConfigPanel from '@/components/designer/NodeConfigPanel'
import DesignerChat from '@/components/designer/DesignerChat'
import PublicLinksModal from '@/components/operator/PublicLinksModal'
import Sidebar from '@/components/layout/Sidebar'
import Breadcrumb from '@/components/handbook/Breadcrumb'
import Badge from '@/components/shared/Badge'
import Btn from '@/components/shared/Btn'
import { useCanvasStore } from '@/store/canvas'
import { useAuthStore } from '@/store/auth'
import { isDraftRun, type GraphDefinition, type GraphVersion, type InputFieldDef, type NodeDef, type NodeType, type Run } from '@/types'
import { validateGraph } from '@/utils/validateGraph'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: 'agent', label: 'Agent' },
]

type AutosaveState = 'idle' | 'saving' | 'saved' | 'error'
type WorkflowTab = 'editor' | 'history' | 'usage'
type HistorySelection =
  | { kind: 'root-draft'; id: string }
  | { kind: 'version'; id: string }
  | { kind: 'draft'; id: string; parentVersionId: string | null }

function formatVersionName(version: GraphVersion | null | undefined) {
  if (!version) return 'root draft'
  if (version.version_name) return version.version_name
  if (version.version_id) return version.version_id
  return 'draft'
}

function formatVersionStamp(iso: string | null | undefined) {
  if (!iso) return 'just now'
  return new Date(iso).toLocaleString()
}

function compareUpdatedDesc(a: GraphVersion, b: GraphVersion) {
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
}

function compareRunsDesc(a: Run, b: Run) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

function formatRunVersionLabel(run: Run, versionNameById: Map<string, string>) {
  if (isDraftRun(run) || run.graph_version_id === null) {
    if (run.draft_parent_version_id) {
      return `Draft from ${versionNameById.get(run.draft_parent_version_id) ?? 'version'}`
    }
    return 'Draft'
  }
  return versionNameById.get(run.graph_version_id) ?? run.graph_version_id
}

function getRunSearchText(run: Run) {
  return [
    run.id,
    run.name,
    run.status,
    run.output_summary,
    run.error,
    JSON.stringify(run.input ?? {}),
    JSON.stringify(run.output ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function HistoryTreeNode({
  label,
  meta,
  badges,
  depth,
  selected,
  onClick,
}: {
  label: string
  meta: string
  badges: React.ReactNode
  depth: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
        selected ? 'border-brand-300 bg-brand-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
      style={{ marginLeft: depth * 18 }}
    >
      <div className="flex items-center gap-2">
        <GitBranch size={14} className={selected ? 'text-brand-600' : 'text-gray-300'} />
        <p className="truncate text-sm font-semibold text-gray-900">{label}</p>
        {badges}
      </div>
      <p className="mt-1 text-xs text-gray-500">{meta}</p>
    </button>
  )
}

function HistoryDetailCard({
  version,
  graphProductionVersionId,
  isActiveDraftBase,
  isPending,
  onEdit,
  onRename,
  onSetProduction,
  onFork,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  version: GraphVersion
  graphProductionVersionId: string | null
  isActiveDraftBase: boolean
  isPending: boolean
  onEdit: (version: GraphVersion) => void
  onRename: (version: GraphVersion) => void
  onSetProduction: (version: GraphVersion) => void
  onFork: (version: GraphVersion) => void
  onArchive: (version: GraphVersion) => void
  onUnarchive: (version: GraphVersion) => void
  onDelete: (version: GraphVersion) => void
  isDraft?: boolean
}) {
  const isProduction = graphProductionVersionId === version.id
  const isArchived = !!version.archived_at

  return (
    <div className={`rounded-xl border p-4 ${isProduction ? 'border-green-300 bg-green-50/60' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-gray-900">{formatVersionName(version)}</p>
            <Badge variant="blue">{version.version_id}</Badge>
            {isProduction && <Badge variant="green">Production</Badge>}
            {isActiveDraftBase && <Badge variant="orange">Editing</Badge>}
            {version.draft && <Badge variant="orange">Draft attached</Badge>}
            {isArchived && <Badge variant="gray">Archived</Badge>}
            {version.is_public && <Badge variant="purple">Public</Badge>}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Created {formatVersionStamp(version.version_created_at)} · {version.run_count} run(s)
          </p>
          {version.draft && (
            <p className="mt-1 text-xs text-amber-700">
              Draft updated {formatVersionStamp(version.draft.updated_at)}
            </p>
          )}
        </div>
        <GitBranch size={14} className="mt-0.5 flex-shrink-0 text-gray-300" />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Btn size="sm" variant="secondary" disabled={isPending} onClick={() => onEdit(version)}>
          <Pencil size={12} /> {version.draft ? 'Open draft' : 'Edit'}
        </Btn>
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onRename(version)}>
          Rename
        </Btn>
        <Btn
          size="sm"
          variant={isProduction ? 'ghost' : 'secondary'}
          disabled={isPending || isProduction}
          onClick={() => onSetProduction(version)}
        >
          <Star size={12} /> {isProduction ? 'Production' : 'Set production'}
        </Btn>
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onFork(version)}>
          Copy as new workflow
        </Btn>
        {isArchived ? (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onUnarchive(version)}>
            Unarchive
          </Btn>
        ) : (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onArchive(version)}>
            <Archive size={12} /> Archive
          </Btn>
        )}
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onDelete(version)}>
          <Trash2 size={12} /> Delete
        </Btn>
      </div>
    </div>
  )
}

function UsagePanel({
  runs,
  query,
  onQueryChange,
  versionFilter,
  onVersionFilterChange,
  versionOptions,
  versionNameById,
  onOpenRun,
}: {
  runs: Run[]
  query: string
  onQueryChange: (value: string) => void
  versionFilter: string
  onVersionFilterChange: (value: string) => void
  versionOptions: Array<{ value: string; label: string }>
  versionNameById: Map<string, string>
  onOpenRun: (runId: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search run detail…"
            className="min-w-[220px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            value={versionFilter}
            onChange={(e) => onVersionFilterChange(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          >
            {versionOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {runs.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No runs match the current filters.
          </p>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => onOpenRun(run.id)}
                className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {run.name?.trim() || `Run ${run.id.slice(0, 8)}`}
                      </p>
                      <Badge variant={run.status === 'completed' ? 'green' : run.status === 'failed' ? 'orange' : 'blue'}>
                        {run.status}
                      </Badge>
                      <Badge variant="gray">{formatRunVersionLabel(run, versionNameById)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(run.created_at).toLocaleString()}
                    </p>
                    {(run.output_summary || run.error) && (
                      <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                        {run.error ?? run.output_summary}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    {run.total_tokens ? `${run.total_tokens} tok` : 'No token data'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function GraphDetailPage() {
  const { graphId } = useParams<{ graphId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const role = useAuthStore((s) => s.role)

  const { data: graph, isLoading } = useGraph(workspaceId, graphId!)
  const { data: allGraphs = [] } = useGraphs(workspaceId)
  const [showArchivedVersions, setShowArchivedVersions] = useState(false)
  const { data: versions = [], isLoading: versionsLoading } = useGraphVersions(
    workspaceId,
    graphId!,
    showArchivedVersions,
  )
  const deleteGraph = useDeleteGraph(workspaceId)
  const deleteVersion = useDeleteVersion(workspaceId, graphId!)
  const archiveVersion = useArchiveVersion(workspaceId, graphId!)
  const unarchiveVersion = useUnarchiveVersion(workspaceId, graphId!)
  const renameVersion = useRenameVersion(workspaceId, graphId!)
  const setProduction = useSetProduction(workspaceId, graphId!)
  const forkVersion = useForkVersion(workspaceId, graphId!)
  const updateGraph = useUpdateGraph(workspaceId)
  const upsertRootDraft = useUpsertRootDraft(workspaceId, graphId!)
  const upsertVersionDraft = useUpsertVersionDraft(workspaceId, graphId!, '')
  const promoteRootDraft = usePromoteRootDraft(workspaceId, graphId!)
  const promoteDraft = usePromoteDraft(workspaceId, graphId!)
  const { data: runs = [] } = useRuns(workspaceId)

  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const addNode = useCanvasStore((s) => s.addNode)
  const addEdge = useCanvasStore((s) => s.addEdge)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const storeDefinition = useCanvasStore((s) => s.definition)
  const storeGraphId = useCanvasStore((s) => s.graphId)
  const setGraph = useCanvasStore((s) => s.setGraph)
  const updateNodeConfig = useCanvasStore((s) => s.updateNodeConfig)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const removeEdge = useCanvasStore((s) => s.removeEdge)
  const updateEdge = useCanvasStore((s) => s.updateEdge)
  const setInputSchema = useCanvasStore((s) => s.setInputSchema)
  const markSaved = useCanvasStore((s) => s.markSaved)

  const sessionId = useId()
  const [addingNode, setAddingNode] = useState(false)
  const [newNodeName, setNewNodeName] = useState('')
  const [newNodeType, setNewNodeType] = useState<NodeType>('agent')
  const [showChat, setShowChat] = useState(searchParams.get('chat') === '1')
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle')
  const [autosaveError, setAutosaveError] = useState('')
  const [showPublicLinks, setShowPublicLinks] = useState(false)
  const [activeParentVersionId, setActiveParentVersionId] = useState<string | null | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<WorkflowTab>('editor')
  const [editorMode, setEditorMode] = useState<'view' | 'edit'>('view')
  const [usageQuery, setUsageQuery] = useState('')
  const [usageVersionFilter, setUsageVersionFilter] = useState('all')
  const [historySelection, setHistorySelection] = useState<HistorySelection | null>(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { data: knowledgeResults = [], isFetching: searchingLibrary } = useSearchKnowledgeFiles(libraryQuery)
  const newMenuRef = useRef<HTMLDivElement>(null)

  const versionBaseKeyRef = useRef<string | null>(null)
  const savingDraftRef = useRef(false)
  const seededInitialDraftRef = useRef(false)

  useEffect(() => {
    if (searchParams.get('chat') === '1') setShowChat(true)
  }, [searchParams])

  useEffect(() => {
    if (!newMenuOpen) return
    function handleClick(event: MouseEvent) {
      if (!newMenuRef.current?.contains(event.target as Node)) setNewMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [newMenuOpen])

  useEffect(() => {
    if (activeTab !== 'editor') {
      setEditorMode('view')
      setAddingNode(false)
      setShowChat(false)
      selectNode(null)
    }
  }, [activeTab, selectNode])

  useEffect(() => {
    if (editorMode === 'view') {
      setAddingNode(false)
    }
  }, [editorMode])

  useEffect(() => {
    setActiveParentVersionId(undefined)
    versionBaseKeyRef.current = null
    seededInitialDraftRef.current = false
    setAutosaveState('idle')
    setAutosaveError('')
  }, [graphId])

  const namedVersions = useMemo(
    () => versions.filter((version) => version.version_id !== null),
    [versions],
  )
  const allDrafts = useMemo(
    () => versions.filter((version) => version.version_id === null),
    [versions],
  )
  const newestDraft = useMemo(
    () => [...allDrafts].sort(compareUpdatedDesc)[0] ?? null,
    [allDrafts],
  )
  const latestNamedVersion = namedVersions[0] ?? null

  useEffect(() => {
    if (activeParentVersionId !== undefined) return
    if (newestDraft) {
      setActiveParentVersionId(newestDraft.parent_version_id ?? null)
      return
    }
    if (latestNamedVersion) {
      setActiveParentVersionId(latestNamedVersion.id)
      return
    }
    setActiveParentVersionId(null)
  }, [activeParentVersionId, newestDraft, latestNamedVersion])

  const resolvedParentVersionId = activeParentVersionId === undefined
    ? newestDraft?.parent_version_id ?? latestNamedVersion?.id ?? null
    : activeParentVersionId

  const versionById = useMemo(
    () => new Map(namedVersions.map((version) => [version.id, version])),
    [namedVersions],
  )

  const activeParentVersion = resolvedParentVersionId ? versionById.get(resolvedParentVersionId) ?? null : null
  const activeDraft = resolvedParentVersionId === null
    ? (allDrafts.find((draft) => draft.parent_version_id === null) ?? null)
    : (activeParentVersion?.draft ?? null)

  useEffect(() => {
    if (activeTab !== 'history') return
    if (activeDraft) {
      setHistorySelection(
        activeDraft.parent_version_id === null
          ? { kind: 'root-draft', id: activeDraft.id }
          : { kind: 'draft', id: activeDraft.id, parentVersionId: activeDraft.parent_version_id },
      )
      return
    }
    if (namedVersions[0]) {
      setHistorySelection({ kind: 'version', id: namedVersions[0].id })
    }
  }, [activeDraft, activeTab, namedVersions])

  useEffect(() => {
    if (
      !graphId
      || versionsLoading
      || seededInitialDraftRef.current
      || allDrafts.length > 0
      || !latestNamedVersion
    ) {
      return
    }
    seededInitialDraftRef.current = true
    void upsertVersionDraft.mutateAsync(latestNamedVersion.definition).then(() => {
      setActiveParentVersionId(latestNamedVersion.id)
    }).catch((error: any) => {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot initialize draft'
      setAutosaveState('error')
      setAutosaveError(String(message))
      seededInitialDraftRef.current = false
    })
  }, [
    allDrafts.length,
    graphId,
    latestNamedVersion,
    upsertVersionDraft,
    versionsLoading,
  ])

  const serverDefinition = activeDraft?.definition
    ?? activeParentVersion?.definition
    ?? graph?.latest_version?.definition
    ?? { nodes: [], edges: [] }

  const serverDefinitionKey = useMemo(() => JSON.stringify(serverDefinition), [serverDefinition])
  const definition: GraphDefinition = isDirty ? storeDefinition : serverDefinition
  const selectedNode = definition.nodes.find((n: NodeDef) => n.id === selectedNodeId) ?? null

  useEffect(() => {
    if (!graphId || !graph) return
    const nextBaseKey = activeDraft?.id ?? activeParentVersion?.id ?? graph.latest_version?.id ?? 'root'
    if (storeGraphId !== graphId || (!isDirty && versionBaseKeyRef.current !== nextBaseKey)) {
      setGraph(graphId, serverDefinition)
      versionBaseKeyRef.current = nextBaseKey
    }
  }, [
    activeDraft?.id,
    activeParentVersion?.id,
    graph,
    graphId,
    isDirty,
    serverDefinition,
    serverDefinitionKey,
    setGraph,
    storeGraphId,
  ])

  useEffect(() => {
    if (!isDirty) {
      window.onbeforeunload = null
      return
    }
    window.onbeforeunload = () => 'You have unsaved changes. Leave anyway?'
    return () => { window.onbeforeunload = null }
  }, [isDirty])

  const validationErrors = validateGraph(definition)
  const hasValidationErrors = validationErrors.length > 0

  const currentVersionLabel = activeParentVersion
    ? `${formatVersionName(activeParentVersion)} (${activeParentVersion.version_id})`
    : 'root draft'

  async function syncDraftNow(nextDefinition = definition) {
    if (!graphId || savingDraftRef.current) return activeDraft
    if (!isDirty && activeDraft) return activeDraft

    savingDraftRef.current = true
    setAutosaveState('saving')
    setAutosaveError('')
    try {
      const saved = resolvedParentVersionId === null
        ? await upsertRootDraft.mutateAsync(nextDefinition)
        : await upsertVersionDraft.mutateAsync(nextDefinition)
      markSaved()
      setAutosaveState('saved')
      return saved
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot save draft'
      setAutosaveState('error')
      setAutosaveError(String(message))
      throw error
    } finally {
      savingDraftRef.current = false
    }
  }

  useEffect(() => {
    if (!graphId || !isDirty || resolvedParentVersionId === undefined) return
    const timer = window.setTimeout(() => {
      void syncDraftNow()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [definition, graphId, isDirty, resolvedParentVersionId])

  async function ensureCleanSwitch(targetLabel: string) {
    if (!isDirty) return true
    return window.confirm(`Discard unsaved changes and switch to ${targetLabel}?`)
  }

  function loadDefinition(parentVersionId: string | null, nextDefinition: GraphDefinition, baseKey: string) {
    if (!graphId) return
    setActiveParentVersionId(parentVersionId)
    versionBaseKeyRef.current = baseKey
    setGraph(graphId, nextDefinition)
    setAutosaveState('idle')
    setAutosaveError('')
  }

  async function handleOpenVersion(version: GraphVersion) {
    if (!(await ensureCleanSwitch(formatVersionName(version)))) return
    if (version.draft) {
      loadDefinition(version.id, version.draft.definition, version.draft.id)
      setActiveTab('editor')
      setEditorMode('edit')
      return
    }
    try {
      const draft = await upsertVersionDraft.mutateAsync(version.definition)
      loadDefinition(version.id, draft.definition, draft.id)
      setActiveTab('editor')
      setEditorMode('edit')
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot open draft'
      window.alert(String(message))
    }
  }

  async function handlePromoteCurrentDraft() {
    try {
      await syncDraftNow()
      const version = resolvedParentVersionId === null
        ? await promoteRootDraft.mutateAsync()
        : await promoteDraft.mutateAsync(resolvedParentVersionId!)
      loadDefinition(version.id, version.definition, version.id)
      setActiveTab('history')
      setEditorMode('view')
      setAutosaveState('saved')
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot create version'
      window.alert(String(message))
    }
  }

  async function handleRenameVersion(version: GraphVersion) {
    const nextName = window.prompt('Rename version', version.version_name ?? version.version_id ?? '')
    if (!nextName || nextName.trim() === (version.version_name ?? '').trim()) return
    try {
      await renameVersion.mutateAsync({ versionRowId: version.id, name: nextName.trim() })
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot rename version'
      window.alert(String(message))
    }
  }

  async function handleSetProduction(version: GraphVersion) {
    try {
      await setProduction.mutateAsync(version.id)
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot set production version'
      window.alert(String(message))
    }
  }

  async function handleArchiveVersion(version: GraphVersion) {
    const ok = window.confirm(`Archive ${formatVersionName(version)}?`)
    if (!ok) return
    try {
      await archiveVersion.mutateAsync(version.id)
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot archive version'
      window.alert(String(message))
    }
  }

  async function handleUnarchiveVersion(version: GraphVersion) {
    try {
      await unarchiveVersion.mutateAsync(version.id)
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot unarchive version'
      window.alert(String(message))
    }
  }

  async function handleDeleteVersion(version: GraphVersion) {
    const ok = window.confirm(`Delete ${formatVersionName(version)}? This only works if it has no runs and no public page.`)
    if (!ok) return
    try {
      await deleteVersion.mutateAsync(version.id)
      if (resolvedParentVersionId === version.id) {
        setActiveParentVersionId(latestNamedVersion?.id ?? null)
      }
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot delete version'
      window.alert(String(message))
    }
  }

  async function handleForkVersion(version: GraphVersion) {
    const proposedName = `${graph?.name ?? 'Workflow'} copy`
    const nextName = window.prompt('Name for the new workflow', proposedName)
    if (!nextName || !nextName.trim()) return
    try {
      const created = await forkVersion.mutateAsync({ versionRowId: version.id, name: nextName.trim() })
      navigate(`/graphs/${created.id}`)
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Cannot fork version'
      window.alert(String(message))
    }
  }

  function handleAddNode(e: React.FormEvent) {
    e.preventDefault()
    if (!newNodeName.trim()) return
    if (!isDirty) setGraph(graphId!, serverDefinition)
    const id = newNodeType === 'start' || newNodeType === 'end'
      ? newNodeType
      : `${newNodeType}-${Date.now()}`
    const node: NodeDef = {
      id,
      type: newNodeType,
      name: newNodeName.trim(),
      config: {},
      ...(newNodeType === 'agent' ? { agent_ref: 'openclaw', trust_level: 0.5 } : {}),
    }
    addNode(node)
    const nodes = isDirty ? storeDefinition.nodes : serverDefinition.nodes
    if (nodes.length > 0) {
      const prev = nodes[nodes.length - 1]
      addEdge({ id: `e-${prev.id}-${id}`, source: prev.id, target: id, type: 'direct' })
    }
    setNewNodeName('')
    setAddingNode(false)
  }

  async function handleRetireWorkflow() {
    if (!graph) return
    const hasRuns = (graph.run_count ?? 0) > 0
    const ok = window.confirm(
      hasRuns
        ? `Archive "${graph.name}"? It has ${graph.run_count} run(s), so it cannot be deleted.`
        : `Delete "${graph.name}" permanently?`,
    )
    if (!ok) return
    try {
      await deleteGraph.mutateAsync(graph.id)
      navigate('/graphs')
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? error?.message ?? 'Action failed'
      window.alert(`Cannot update workflow: ${message}`)
    }
  }

  async function copyVersionLink(version: GraphVersion) {
    await navigator.clipboard.writeText(version.version_id ?? version.id)
  }

  const versionActionPending = (
    archiveVersion.isPending
    || unarchiveVersion.isPending
    || deleteVersion.isPending
    || renameVersion.isPending
    || setProduction.isPending
    || forkVersion.isPending
    || promoteDraft.isPending
    || promoteRootDraft.isPending
  )
  const versionNameById = useMemo(
    () => new Map(namedVersions.map((version) => [version.id, formatVersionName(version)])),
    [namedVersions],
  )
  const graphRuns = useMemo(
    () => runs.filter((run) => run.graph_id === graphId).sort(compareRunsDesc),
    [graphId, runs],
  )
  const historyVersionMap = useMemo(
    () => new Map(namedVersions.map((version) => [version.id, version])),
    [namedVersions],
  )
  const historyTreeVersions = useMemo(() => {
    const roots: GraphVersion[] = []
    const childMap = new Map<string, GraphVersion[]>()
    for (const version of namedVersions) {
      if (!version.parent_version_id) {
        roots.push(version)
        continue
      }
      const current = childMap.get(version.parent_version_id) ?? []
      current.push(version)
      childMap.set(version.parent_version_id, current)
    }
    for (const versions of childMap.values()) versions.sort(compareUpdatedDesc)
    roots.sort(compareUpdatedDesc)
    return { roots, childMap }
  }, [namedVersions])
  const usageVersionOptions = useMemo(
    () => [
      { value: 'all', label: 'All versions' },
      { value: 'draft', label: 'Draft' },
      ...namedVersions.map((version) => ({
        value: version.id,
        label: `${formatVersionName(version)} (${version.version_id})`,
      })),
    ],
    [namedVersions],
  )
  const filteredRuns = useMemo(() => {
    const needle = usageQuery.trim().toLowerCase()
    return graphRuns.filter((run) => {
      const matchesQuery = !needle || getRunSearchText(run).includes(needle)
      if (!matchesQuery) return false
      if (usageVersionFilter === 'all') return true
      if (usageVersionFilter === 'draft') {
        return isDraftRun(run) || run.graph_version_id === null
      }
      return run.graph_version_id === usageVersionFilter || run.draft_parent_version_id === usageVersionFilter
    })
  }, [graphRuns, usageQuery, usageVersionFilter])
  const selectedDraftParentId = historySelection?.kind === 'draft' ? historySelection.parentVersionId : null
  const selectedHistoryVersion = historySelection?.kind === 'version'
    ? historyVersionMap.get(historySelection.id) ?? null
    : selectedDraftParentId
      ? historyVersionMap.get(selectedDraftParentId) ?? null
      : null
  const selectedHistoryDraft = historySelection?.kind === 'root-draft'
    ? activeDraft?.parent_version_id === null ? activeDraft : newestDraft?.parent_version_id === null ? newestDraft : null
    : historySelection?.kind === 'draft'
      ? selectedHistoryVersion?.draft?.id === historySelection.id ? selectedHistoryVersion.draft : null
      : null
  const libraryResults = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase()
    if (!q) return []
    const workflowMatches = allGraphs
      .filter((item) =>
        [item.name, item.description, item.path].filter(Boolean).join(' ').toLowerCase().includes(q),
      )
      .map((item) => ({
        id: item.id,
        kind: 'workflow' as const,
        title: item.name,
        subtitle: item.description ?? item.path ?? 'Workflow',
      }))
    const fileMatches = knowledgeResults.map((item) => ({
      id: item.path,
      kind: 'file' as const,
      title: item.title || item.path.split('/').pop() || item.path,
      subtitle: item.path,
    }))
    return [...fileMatches, ...workflowMatches]
  }, [allGraphs, knowledgeResults, libraryQuery])

  if (isLoading) return <p className="p-8 text-sm text-gray-400">Loading…</p>
  if (!graph) return <p className="p-8 text-sm text-red-500">Graph not found.</p>

  const currentFolder = graph.path ?? ''
  const graphProductionVersionId = graph.production_version_id
  function renderHistoryBranch(version: GraphVersion, depth = 0): React.ReactNode {
    const children = historyTreeVersions.childMap.get(version.id) ?? []
    const draft = version.draft
    return (
      <div key={version.id} className="space-y-2">
        <HistoryTreeNode
          label={formatVersionName(version)}
          meta={`Created ${formatVersionStamp(version.version_created_at)} · ${version.run_count} run(s)`}
          badges={
            <>
              {graphProductionVersionId === version.id && <Badge variant="green">Production</Badge>}
              {resolvedParentVersionId === version.id && <Badge variant="orange">Editing</Badge>}
              {version.archived_at && <Badge variant="gray">Archived</Badge>}
            </>
          }
          depth={depth}
          selected={historySelection?.kind === 'version' && historySelection.id === version.id}
          onClick={() => setHistorySelection({ kind: 'version', id: version.id })}
        />
        {draft && (
          <HistoryTreeNode
            label="Draft"
            meta={`Updated ${formatVersionStamp(draft.updated_at)}`}
            badges={<Badge variant="orange">Live</Badge>}
            depth={depth + 1}
            selected={historySelection?.kind === 'draft' && historySelection.id === draft.id}
            onClick={() => setHistorySelection({ kind: 'draft', id: draft.id, parentVersionId: version.id })}
          />
        )}
        {children.length > 0 && (
          <div className="space-y-2">
            {children.map((child) => renderHistoryBranch(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  function renderHistoryDetail() {
    if (historySelection?.kind === 'root-draft' && selectedHistoryDraft) {
      return (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-amber-900">Root draft</p>
              <Badge variant="orange">Live</Badge>
            </div>
            <p className="mt-1 text-xs text-amber-800">Base: root draft</p>
            <p className="mt-1 text-xs text-amber-700">
              Last updated {formatVersionStamp(selectedHistoryDraft.updated_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" variant="secondary" onClick={() => void handlePromoteCurrentDraft()}>
              <Copy size={12} /> Save as version
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => void copyVersionLink(selectedHistoryDraft)}>
              <Copy size={12} /> Copy draft id
            </Btn>
          </div>
        </div>
      )
    }
    if (historySelection?.kind === 'draft' && selectedHistoryDraft && selectedHistoryVersion) {
      return (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-amber-900">
                Draft from {formatVersionName(selectedHistoryVersion)}
              </p>
              <Badge variant="orange">Live</Badge>
            </div>
            <p className="mt-1 text-xs text-amber-700">
              Last updated {formatVersionStamp(selectedHistoryDraft.updated_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" variant="secondary" onClick={() => void handleOpenVersion(selectedHistoryVersion)}>
              <Pencil size={12} /> Open draft
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => void copyVersionLink(selectedHistoryDraft)}>
              <Copy size={12} /> Copy draft id
            </Btn>
          </div>
        </div>
      )
    }
    if (selectedHistoryVersion) {
      return (
        <HistoryDetailCard
          version={selectedHistoryVersion}
          graphProductionVersionId={graph?.production_version_id ?? null}
          isActiveDraftBase={resolvedParentVersionId === selectedHistoryVersion.id}
          isPending={versionActionPending}
          onEdit={(item) => void handleOpenVersion(item)}
          onRename={(item) => void handleRenameVersion(item)}
          onSetProduction={(item) => void handleSetProduction(item)}
          onFork={(item) => void handleForkVersion(item)}
          onArchive={(item) => void handleArchiveVersion(item)}
          onUnarchive={(item) => void handleUnarchiveVersion(item)}
          onDelete={(item) => void handleDeleteVersion(item)}
        />
      )
    }
    return (
      <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        Select a version or draft node to interact with it.
      </p>
    )
  }

  function openNewFromWorkflow(kind: 'file' | 'folder' | 'workflow' | 'upload') {
    const params = new URLSearchParams()
    if (currentFolder) params.set('folder', currentFolder)
    params.set('new', kind)
    navigate(`/handbook?${params.toString()}`)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      {mobileNavOpen && (
        <button className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />
      )}
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Mobile header — hamburger + graph name */}
        <header className="md:hidden flex-shrink-0 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 z-20">
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>
          <p className="text-sm font-semibold text-gray-900 truncate">{graph?.name}</p>
        </header>
        {/* Handbook search — desktop only */}
        <div className="hidden md:flex border-b border-gray-200 bg-white px-3 py-1.5">
          <div className="relative max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              placeholder="Search handbook…"
              className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
            {libraryQuery && (
              <button onClick={() => setLibraryQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
            {searchingLibrary && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
            {libraryQuery && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                {libraryResults.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-gray-400">No matches for "{libraryQuery}"</p>
                ) : (
                  libraryResults.map((result) => (
                    <button
                      key={`${result.kind}-${result.id}`}
                      onClick={() => {
                        setLibraryQuery('')
                        if (result.kind === 'workflow') navigate(`/graphs/${result.id}`)
                        else navigate(`/handbook?path=${encodeURIComponent(result.id)}`)
                      }}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50"
                    >
                      <p className="text-sm font-medium text-gray-900">{result.title}</p>
                      <p className="truncate text-xs text-gray-500">{result.subtitle}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            <div className="border-b border-gray-100 bg-white px-4 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Breadcrumb
                    path={graph.path}
                    onNavigate={(path) => navigate(path ? `/handbook?folder=${encodeURIComponent(path)}` : '/handbook')}
                    file={graph.name}
                    fileType="workflow"
                    renamePending={updateGraph.isPending}
                    onRenameFile={(newName) => updateGraph.mutate({ graphId: graph.id, name: newName })}
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="relative" ref={newMenuRef}>
                    <button
                      onClick={() => setNewMenuOpen((value) => !value)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
                    >
                      <Plus size={14} /><span className="hidden md:inline">New</span><ChevronDown size={13} className="hidden md:inline" />
                    </button>
                    {newMenuOpen && (
                      <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                        <button
                          onClick={() => { setNewMenuOpen(false); openNewFromWorkflow('file') }}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          New File
                        </button>
                        <button
                          onClick={() => { setNewMenuOpen(false); openNewFromWorkflow('folder') }}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          New Folder
                        </button>
                        <button
                          onClick={() => { setNewMenuOpen(false); openNewFromWorkflow('workflow') }}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          New Workflow
                        </button>
                        <button
                          onClick={() => { setNewMenuOpen(false); openNewFromWorkflow('upload') }}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Upload
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setShowChat((value) => !value)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      showChat ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <MessageSquare size={14} /><span className="hidden md:inline">Chat</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="border-b border-gray-200 bg-white px-6 py-3" style={{ flexShrink: 0 }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate font-semibold text-gray-900">{graph.name}</h1>
                    {activeTab === 'editor' && editorMode === 'edit' && <Badge variant="orange">Draft</Badge>}
                    {graph.production_version_id && <Badge variant="green">Production set</Badge>}
                    {activeParentVersion?.version_id && <Badge variant="blue">{activeParentVersion.version_id}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {activeTab === 'editor' && editorMode === 'edit'
                      ? `Editing draft based on ${currentVersionLabel}`
                      : `Viewing workflow based on ${currentVersionLabel}`}
                  </p>
                  {autosaveState === 'error' ? (
                    <p className="mt-1 text-xs text-red-600">{autosaveError}</p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-400">
                      {autosaveState === 'saving'
                        ? 'Saving draft…'
                        : autosaveState === 'saved'
                          ? 'Draft saved'
                          : 'Draft auto-saves as you edit'}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-4 overflow-x-auto">
                <div className="flex items-center gap-4 text-sm flex-shrink-0">
                  {(['editor', 'history', 'usage'] as WorkflowTab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`pb-1.5 capitalize transition-colors ${
                        activeTab === tab
                          ? 'border-b-2 border-brand-500 text-brand-600 font-medium'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 md:gap-2 flex-shrink-0 ml-auto flex-nowrap">
                  {autosaveState === 'saved' && !isDirty && activeTab === 'editor' && (
                    <span className="flex items-center gap-1.5 px-2 md:px-3 py-2 text-sm font-medium text-green-600">
                      <Check size={14} /><span className="hidden md:inline"> Saved</span>
                    </span>
                  )}
                  {editorMode === 'view' && (
                    <Btn
                      size="sm"
                      title="Edit"
                      onClick={() => {
                        setActiveTab('editor')
                        setEditorMode('edit')
                      }}
                    >
                      <Pencil size={14} /><span className="hidden md:inline"> Edit</span>
                    </Btn>
                  )}
                  {activeTab === 'editor' && editorMode === 'edit' && (
                    <>
                      <Btn
                        size="sm"
                        variant="secondary"
                        title="Save draft"
                        loading={autosaveState === 'saving'}
                        onClick={() => void syncDraftNow()}
                      >
                        <Save size={14} /><span className="hidden md:inline"> Save draft</span>
                      </Btn>
                      <Btn
                        size="sm"
                        title="Save as version"
                        loading={promoteDraft.isPending || promoteRootDraft.isPending}
                        onClick={() => void handlePromoteCurrentDraft()}
                      >
                        <Copy size={14} /><span className="hidden md:inline"> Save as version</span>
                      </Btn>
                      <Btn
                        size="sm"
                        variant="secondary"
                        title="Add node"
                        onClick={() => setAddingNode((value) => !value)}
                      >
                        <Plus size={14} /><span className="hidden md:inline"> Add node</span>
                      </Btn>
                      {role === 'owner' && (
                        <Btn
                          size="sm"
                          variant="secondary"
                          title="Public links"
                          onClick={() => setShowPublicLinks(true)}
                        >
                          <Globe size={14} /><span className="hidden md:inline"> Public links</span>
                        </Btn>
                      )}
                      <Btn
                        size="sm"
                        variant="secondary"
                        disabled={deleteGraph.isPending}
                        title={(graph.run_count ?? 0) > 0 ? 'Archive' : 'Delete'}
                        onClick={() => void handleRetireWorkflow()}
                      >
                        {(graph.run_count ?? 0) > 0 ? <Archive size={14} /> : <Trash2 size={14} />}
                        <span className="hidden md:inline">
                          {deleteGraph.isPending ? ' Working…' : (graph.run_count ?? 0) > 0 ? ' Archive' : ' Delete'}
                        </span>
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditorMode('view')}
                      >
                        Done
                      </Btn>
                    </>
                  )}
                </div>
              </div>
            </div>

            {hasValidationErrors && activeTab === 'editor' && editorMode === 'edit' && (
              <div className="mx-6 mt-3 flex flex-shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
                <div>
                  <p className="text-xs font-semibold text-amber-700">Graph topology issue</p>
                  <ul className="mt-0.5 space-y-0.5 text-xs text-amber-600">
                    {validationErrors.map((error, index) => <li key={index}>• {error}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {addingNode && activeTab === 'editor' && editorMode === 'edit' && (
              <form
                onSubmit={handleAddNode}
                className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 md:px-6 py-2"
                style={{ flexShrink: 0 }}
              >
                <select
                  value={newNodeType}
                  onChange={(e) => setNewNodeType(e.target.value as NodeType)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm outline-none"
                >
                  {NODE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <input
                  autoFocus
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  placeholder="Node name"
                  className="w-48 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button type="submit" className="rounded bg-brand-500 px-3 py-1 text-sm text-white">Add</button>
                <button type="button" onClick={() => setAddingNode(false)} className="px-3 py-1 text-sm text-gray-500">Cancel</button>
              </form>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: 16 }}>
          {activeTab === 'editor' ? (
            <GraphCanvas
              definition={definition}
                selectedNodeId={selectedNodeId}
                onSelectNode={(nodeId) => {
                  selectNode(nodeId)
                }}
              />
            ) : activeTab === 'history' ? (
              <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50/40">
                <div className="border-b border-gray-200 bg-white px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Version history</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Draft runs stay mutable. Named versions are explicit snapshots.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowArchivedVersions((value) => !value)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      {showArchivedVersions ? 'Hide archived' : 'Show archived'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 min-h-0">
                  <div className={`overflow-y-auto border-r border-gray-200 p-3 md:p-5 md:w-[360px] md:flex-shrink-0 ${historySelection ? 'hidden md:block' : 'flex-1'}`}>
                    <div className="space-y-3">
                      {activeDraft?.parent_version_id === null && (
                        <HistoryTreeNode
                          label="Root draft"
                          meta={activeDraft ? `Updated ${formatVersionStamp(activeDraft.updated_at)}` : 'Draft not created yet'}
                          badges={<Badge variant="orange">Live</Badge>}
                          depth={0}
                          selected={historySelection?.kind === 'root-draft'}
                          onClick={() => setHistorySelection({ kind: 'root-draft', id: activeDraft.id })}
                        />
                      )}
                      {versionsLoading ? (
                        <p className="text-sm text-gray-500">Loading versions…</p>
                      ) : namedVersions.length === 0 ? (
                        <p className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500">
                          No named versions yet. Save the current draft as a version when it reaches a stable checkpoint.
                        </p>
                      ) : (
                        historyTreeVersions.roots.map((rootVersion) => renderHistoryBranch(rootVersion))
                      )}
                    </div>
                  </div>

                  <div className="hidden md:block min-w-0 flex-1 overflow-y-auto p-5">
                    {renderHistoryDetail()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full overflow-hidden rounded-xl border border-gray-200 bg-white">
                <UsagePanel
                  runs={filteredRuns}
                  query={usageQuery}
                  onQueryChange={setUsageQuery}
                  versionFilter={usageVersionFilter}
                  onVersionFilterChange={setUsageVersionFilter}
                  versionOptions={usageVersionOptions}
                  versionNameById={versionNameById}
                  onOpenRun={(runId) => navigate(`/runs/${runId}`)}
                />
              </div>
            )}
              </div>

              {/* Desktop: node config right panel */}
              {activeTab === 'editor' && selectedNode && (
                <div
                  className="hidden md:flex border-l border-gray-200 bg-white"
                  style={{ width: 320, flexShrink: 0, flexDirection: 'column', overflow: 'hidden' }}
                >
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <NodeConfigPanel
                      node={selectedNode}
                      allNodes={definition.nodes}
                      edges={definition.edges}
                      inputFields={definition.input_schema ?? []}
                      readOnly={editorMode !== 'edit'}
                      onInputSchemaChange={(fields: InputFieldDef[]) => {
                        if (!isDirty) setGraph(graphId!, serverDefinition)
                        setInputSchema(fields)
                      }}
                      onConfigChange={(nodeId, patch) => updateNodeConfig(nodeId, patch)}
                      onRemove={(nodeId) => { removeNode(nodeId); selectNode(null) }}
                      onAddEdge={(edge) => addEdge(edge)}
                      onUpdateEdge={(edgeId, patch) => updateEdge(edgeId, patch)}
                      onRemoveEdge={(edgeId) => removeEdge(edgeId)}
                    />
                  </div>
                </div>
              )}
              {/* Mobile: node config full-screen overlay */}
              {activeTab === 'editor' && selectedNode && (
                <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-white">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-900">Node config</p>
                    <button
                      onClick={() => selectNode(null)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700"
                      aria-label="Close"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <NodeConfigPanel
                      node={selectedNode}
                      allNodes={definition.nodes}
                      edges={definition.edges}
                      inputFields={definition.input_schema ?? []}
                      readOnly={editorMode !== 'edit'}
                      onInputSchemaChange={(fields: InputFieldDef[]) => {
                        if (!isDirty) setGraph(graphId!, serverDefinition)
                        setInputSchema(fields)
                      }}
                      onConfigChange={(nodeId, patch) => updateNodeConfig(nodeId, patch)}
                      onRemove={(nodeId) => { removeNode(nodeId); selectNode(null) }}
                      onAddEdge={(edge) => addEdge(edge)}
                      onUpdateEdge={(edgeId, patch) => updateEdge(edgeId, patch)}
                      onRemoveEdge={(edgeId) => removeEdge(edgeId)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Desktop: designer chat right panel */}
          {activeTab === 'editor' && showChat && (
            <div
              className="hidden md:flex border-l border-gray-200 bg-white"
              style={{ width: 440, flexShrink: 0, flexDirection: 'column', overflow: 'hidden' }}
            >
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <DesignerChat
                  graphId={graphId!}
                  sessionId={sessionId}
                  onBeforeApplyDelta={() => {
                    if (!isDirty) setGraph(graphId!, serverDefinition)
                  }}
                />
              </div>
            </div>
          )}
          {/* Mobile: designer chat bottom sheet */}
          {activeTab === 'editor' && showChat && (
            <div
              className="md:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-xl"
              style={{ height: '65vh' }}
            >
              <div className="relative flex items-center justify-between border-b border-gray-200 px-4 py-3 flex-shrink-0">
                <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full bg-gray-300" />
                <p className="text-sm font-semibold text-gray-900">Designer</p>
                <button
                  onClick={() => setShowChat(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700"
                  aria-label="Close chat"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DesignerChat
                  graphId={graphId!}
                  sessionId={sessionId}
                  onBeforeApplyDelta={() => {
                    if (!isDirty) setGraph(graphId!, serverDefinition)
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Mobile: history version detail overlay */}
        {activeTab === 'history' && historySelection && (
          <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-white">
            <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 flex-shrink-0">
              <button
                onClick={() => setHistorySelection(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700"
                aria-label="Back to history"
              >
                <ChevronLeft size={18} />
              </button>
              <p className="text-sm font-semibold text-gray-900">Version details</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {renderHistoryDetail()}
            </div>
          </div>
        )}

        {showPublicLinks && (
          <PublicLinksModal
            workspaceId={workspaceId}
            graphId={graphId!}
            currentVersionId={activeParentVersion?.id ?? graph.production_version_id ?? latestNamedVersion?.id ?? null}
            onClose={() => setShowPublicLinks(false)}
          />
        )}
      </div>
    </div>
  )
}
