import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useGraphVersions,
  useUpsertRootDraft,
  useUpsertVersionDraft,
} from '@/api/graphs'
import { useCanvasStore } from '@/store/canvas'
import type { Graph, GraphDefinition, GraphVersion } from '@/types'
import type { AutosaveState, HistorySelection } from './graphVersionUtils'
import { compareUpdatedDesc, formatVersionName } from './graphVersionUtils'

function storageKey(graphId: string) { return `kw:ver-sel:${graphId}` }
// Stored format:  '__null__'        → root-draft (edit)
//                 'snap:{uuid}'     → named version, snapshot/read-only
//                 '{uuid}'          → named version, edit mode (draft open or creating)
function readStored(graphId: string): { id: string | null; snapshot: boolean } | undefined {
  const raw = localStorage.getItem(storageKey(graphId))
  if (raw === null) return undefined
  if (raw === '__null__') return { id: null, snapshot: false }
  if (raw.startsWith('snap:')) return { id: raw.slice(5), snapshot: true }
  return { id: raw, snapshot: false }
}
function writeStored(graphId: string, id: string | null, snapshot: boolean) {
  const val = id === null ? '__null__' : snapshot ? `snap:${id}` : id
  localStorage.setItem(storageKey(graphId), val)
}

export function useVersionSync(
  workspaceId: string,
  graphId: string | undefined,
  graph: Graph | undefined,
  editorMode: 'view' | 'edit',
) {
  const [showArchivedVersions, setShowArchivedVersions] = useState(false)
  const { data: versions = [], isLoading: versionsLoading } = useGraphVersions(
    workspaceId, graphId!, showArchivedVersions,
  )
  const upsertRootDraft = useUpsertRootDraft(workspaceId, graphId!)
  const upsertVersionDraft = useUpsertVersionDraft(workspaceId, graphId!)

  const isDirty = useCanvasStore((s) => s.isDirty)
  const storeDefinition = useCanvasStore((s) => s.definition)
  const storeGraphId = useCanvasStore((s) => s.graphId)
  const setGraph = useCanvasStore((s) => s.setGraph)
  const markSaved = useCanvasStore((s) => s.markSaved)

  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle')
  const [autosaveError, setAutosaveError] = useState('')
  const [activeParentVersionId, setActiveParentVersionId] = useState<string | null | undefined>(undefined)
  const [viewingVersionSnapshot, setViewingVersionSnapshot] = useState(false)
  const versionBaseKeyRef = useRef<string | null>(null)
  const savingDraftRef = useRef(false)

  useEffect(() => {
    setActiveParentVersionId(undefined)
    setViewingVersionSnapshot(false)
    versionBaseKeyRef.current = null
    setAutosaveState('idle')
    setAutosaveError('')
  }, [graphId])

  const namedVersions = useMemo(() => versions.filter((v) => v.version_id !== null), [versions])
  const allDrafts = useMemo(() => versions.filter((v) => v.version_id === null), [versions])
  const newestDraft = useMemo(() => [...allDrafts].sort(compareUpdatedDesc)[0] ?? null, [allDrafts])
  const latestNamedVersion: GraphVersion | null = namedVersions[0] ?? null
  // versionById declared before init effect so it can validate stored IDs
  const versionById = useMemo(() => new Map(namedVersions.map((v) => [v.id, v])), [namedVersions])

  useEffect(() => {
    if (activeParentVersionId !== undefined) return
    if (versionsLoading) return
    if (!graph) return   // wait for graph so production_version_id is available
    const stored = graphId ? readStored(graphId) : undefined
    if (stored !== undefined) {
      // Stored named version — valid if still exists
      if (stored.id !== null && versionById.has(stored.id)) {
        setActiveParentVersionId(stored.id)
        setViewingVersionSnapshot(stored.snapshot)
        return
      }
      // Stored root-draft — only valid if the draft actually has nodes
      if (stored.id === null) {
        const rootDraft = allDrafts.find((d) => d.parent_version_id === null) ?? null
        const hasNodes = (rootDraft?.definition?.nodes?.length ?? 0) > 0
        if (hasNodes) { setActiveParentVersionId(null); return }
        // Empty root draft — fall through to default/latest below
      }
    }
    // Default: production version → newest draft's parent → latest named version → root draft
    const defaultVersionId = graph?.production_version_id ?? null
    if (defaultVersionId) { setActiveParentVersionId(defaultVersionId); return }
    if (newestDraft) { setActiveParentVersionId(newestDraft.parent_version_id ?? null); return }
    if (latestNamedVersion) { setActiveParentVersionId(latestNamedVersion.id); return }
    setActiveParentVersionId(null)
  }, [activeParentVersionId, newestDraft, latestNamedVersion, versionsLoading, graph, graphId, versionById])

  // Persist selection so it survives navigation away and back
  useEffect(() => {
    if (!graphId || activeParentVersionId === undefined) return
    writeStored(graphId, activeParentVersionId, viewingVersionSnapshot)
  }, [graphId, activeParentVersionId, viewingVersionSnapshot])

  const resolvedParentVersionId = activeParentVersionId === undefined
    ? (newestDraft?.parent_version_id ?? latestNamedVersion?.id ?? null)
    : activeParentVersionId
  const activeParentVersion = resolvedParentVersionId
    ? (versionById.get(resolvedParentVersionId) ?? null)
    : null
  const activeDraft = resolvedParentVersionId === null
    ? (allDrafts.find((d) => d.parent_version_id === null) ?? null)
    : (activeParentVersion?.draft ?? null)

  const serverDefinition: GraphDefinition = (viewingVersionSnapshot ? null : activeDraft?.definition)
    ?? activeParentVersion?.definition
    ?? graph?.latest_version?.definition
    ?? { nodes: [], edges: [] }
  const serverDefinitionKey = useMemo(() => JSON.stringify(serverDefinition), [serverDefinition])
  const definition: GraphDefinition = editorMode === 'edit' ? storeDefinition : serverDefinition

  useEffect(() => {
    if (!graphId || !graph) return
    if (isDirty) return  // preserve unsaved edits
    const nextBaseKey = activeDraft?.id ?? activeParentVersion?.id ?? graph.latest_version?.id ?? 'root'
    if (storeGraphId !== graphId || versionBaseKeyRef.current !== nextBaseKey) {
      setGraph(graphId, serverDefinition)
      versionBaseKeyRef.current = nextBaseKey
    }
  }, [activeDraft?.id, activeParentVersion?.id, isDirty, graph, graphId, serverDefinition, serverDefinitionKey, setGraph, storeGraphId])

  useEffect(() => {
    if (!isDirty && autosaveState !== 'saving') { window.onbeforeunload = null; return }
    window.onbeforeunload = () => 'Changes are still saving. Leave anyway?'
    return () => { window.onbeforeunload = null }
  }, [isDirty, autosaveState])

  const currentVersionLabel = viewingVersionSnapshot && activeParentVersion
    ? `${formatVersionName(activeParentVersion)} (${activeParentVersion.version_id})`
    : activeDraft
      ? `${formatVersionName(activeDraft)} (draft)`
      : activeParentVersion
        ? `${formatVersionName(activeParentVersion)} (no draft)`
        : 'loading…'

  async function syncDraftNow(nextDefinition = definition) {
    if (!graphId || savingDraftRef.current) return activeDraft
    if (!isDirty && activeDraft) return activeDraft
    savingDraftRef.current = true
    setAutosaveState('saving')
    setAutosaveError('')
    try {
      const saved = resolvedParentVersionId === null
        ? await upsertRootDraft.mutateAsync(nextDefinition)
        : await upsertVersionDraft.mutateAsync({ versionRowId: resolvedParentVersionId!, definition: nextDefinition })
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
    if (!graphId || !isDirty || editorMode !== 'edit' || resolvedParentVersionId === undefined) return
    const timer = window.setTimeout(() => { void syncDraftNow() }, 800)
    return () => window.clearTimeout(timer)
  }, [storeDefinition, graphId, isDirty, editorMode, resolvedParentVersionId])

  // Derive history panel selection from the shared version/snapshot state so it
  // survives tab switches without any separate state.
  const historySelection: HistorySelection | null = useMemo(() => {
    if (activeParentVersionId === undefined) return null
    if (activeParentVersionId === null) {
      const rootDraft = allDrafts.find((d) => d.parent_version_id === null) ?? null
      return rootDraft ? { kind: 'root-draft', id: rootDraft.id } : null
    }
    if (viewingVersionSnapshot) return { kind: 'version', id: activeParentVersionId }
    const draft = activeParentVersion?.draft
    return draft
      ? { kind: 'draft', id: draft.id, parentVersionId: activeParentVersionId }
      : { kind: 'version', id: activeParentVersionId }
  }, [activeParentVersionId, viewingVersionSnapshot, activeParentVersion, allDrafts])

  function selectHistoryItem(sel: HistorySelection) {
    if (sel.kind === 'root-draft') {
      setActiveParentVersionId(null); setViewingVersionSnapshot(false)
    } else if (sel.kind === 'version') {
      setActiveParentVersionId(sel.id); setViewingVersionSnapshot(true)
    } else {
      setActiveParentVersionId(sel.parentVersionId); setViewingVersionSnapshot(false)
    }
  }

  function loadDefinition(parentVersionId: string | null, nextDef: GraphDefinition, baseKey: string) {
    if (!graphId) return
    setActiveParentVersionId(parentVersionId)
    versionBaseKeyRef.current = baseKey
    setGraph(graphId, nextDef)
    setAutosaveState('idle')
    setAutosaveError('')
  }

  return {
    showArchivedVersions, setShowArchivedVersions, versions, versionsLoading,
    namedVersions, allDrafts, newestDraft, latestNamedVersion,
    activeParentVersionId, setActiveParentVersionId, resolvedParentVersionId,
    viewingVersionSnapshot, setViewingVersionSnapshot, versionById,
    activeParentVersion, activeDraft, serverDefinition, definition, currentVersionLabel,
    autosaveState, autosaveError, setAutosaveState, isDirty, storeDefinition, setGraph,
    syncDraftNow, loadDefinition, historySelection, selectHistoryItem,
  }
}
