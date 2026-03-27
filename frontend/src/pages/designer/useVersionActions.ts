import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useArchiveVersion,
  useDeleteGraph,
  useDeleteVersion,
  useForkVersion,
  usePromoteDraft,
  usePromoteRootDraft,
  useRenameVersion,
  useSetProduction,
  useUnarchiveVersion,
  useUpdateGraph,
  useUpsertVersionDraft,
} from '@/api/graphs'
import type { Graph, GraphDefinition, GraphVersion } from '@/types'
import { formatVersionName } from './graphVersionUtils'
import type { RenameDialog, ForkDialog } from './GraphDialogs'
import type { WorkflowTab } from './graphVersionUtils'

export function useVersionActions(
  workspaceId: string,
  graphId: string | undefined,
  graph: Graph | undefined,
  resolvedParentVersionId: string | null,
  latestNamedVersion: GraphVersion | null,
  editorMode: 'view' | 'edit',
  isDirty: boolean,
  syncDraftNow: () => Promise<GraphVersion | null | undefined>,
  loadDefinition: (parentVersionId: string | null, def: GraphDefinition, baseKey: string) => void,
  setActiveParentVersionId: (id: string | null) => void,
  setViewingVersionSnapshot: (v: boolean) => void,
  setActiveTab: (tab: WorkflowTab) => void,
  setEditorMode: (mode: 'view' | 'edit') => void,
) {
  const navigate = useNavigate()
  const upsertVersionDraft = useUpsertVersionDraft(workspaceId, graphId!)
  const promoteRootDraft = usePromoteRootDraft(workspaceId, graphId!)
  const promoteDraft = usePromoteDraft(workspaceId, graphId!)
  const deleteGraph = useDeleteGraph(workspaceId)
  const deleteVersion = useDeleteVersion(workspaceId, graphId!)
  const archiveVersion = useArchiveVersion(workspaceId, graphId!)
  const unarchiveVersion = useUnarchiveVersion(workspaceId, graphId!)
  const renameVersion = useRenameVersion(workspaceId, graphId!)
  const setDefault = useSetProduction(workspaceId, graphId!)
  const forkVersion = useForkVersion(workspaceId, graphId!)
  const updateGraph = useUpdateGraph(workspaceId)

  const [publicLinksVersion, setPublicLinksVersion] = useState<GraphVersion | null>(null)
  const [publishDialog, setPublishDialog] = useState(false)
  const [renameDialog, setRenameDialog] = useState<RenameDialog | null>(null)
  const [forkDialog, setForkDialog] = useState<ForkDialog | null>(null)

  async function ensureCleanSwitch(label: string) {
    if (!isDirty || editorMode !== 'edit') return true
    return window.confirm(`Discard unsaved changes and switch to ${label}?`)
  }

  function handleViewVersion(version: GraphVersion) {
    void ensureCleanSwitch(formatVersionName(version)).then((ok) => {
      if (!ok) return
      setViewingVersionSnapshot(true)
      loadDefinition(version.id, version.definition, version.id)
      setActiveTab('graph'); setEditorMode('view')
    })
  }

  async function handleOpenVersion(version: GraphVersion) {
    if (!(await ensureCleanSwitch(formatVersionName(version)))) return
    setViewingVersionSnapshot(false)
    if (version.draft) {
      loadDefinition(version.id, version.draft.definition, version.draft.id)
      setActiveTab('graph'); setEditorMode('edit'); return
    }
    try {
      const draft = await upsertVersionDraft.mutateAsync({ versionRowId: version.id, definition: version.definition })
      loadDefinition(version.id, draft.definition, draft.id)
      setActiveTab('graph'); setEditorMode('edit')
    } catch (error: any) {
      window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot open draft'))
    }
  }

  async function handlePromoteCurrentDraft(makePublic = false) {
    try {
      await syncDraftNow()
      const version = resolvedParentVersionId === null
        ? await promoteRootDraft.mutateAsync()
        : await promoteDraft.mutateAsync(resolvedParentVersionId!)
      loadDefinition(version.id, version.definition, version.id)
      setViewingVersionSnapshot(true); setActiveTab('history'); setEditorMode('view')
      setPublishDialog(false)
      // For "publish publicly": open the public links modal so user can add a description.
      if (makePublic) setPublicLinksVersion(version)
    } catch (error: any) {
      window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot publish'))
    }
  }

  function handleRenameVersion(version: GraphVersion) {
    setRenameDialog({ version, value: version.version_name ?? version.version_id ?? '' })
  }

  async function submitRenameVersion() {
    if (!renameDialog) return
    const trimmed = renameDialog.value.trim()
    if (!trimmed || trimmed === (renameDialog.version.version_name ?? '').trim()) { setRenameDialog(null); return }
    try {
      await renameVersion.mutateAsync({ versionRowId: renameDialog.version.id, name: trimmed })
      setRenameDialog(null)
    } catch (error: any) {
      window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot rename'))
    }
  }

  async function handleSetDefault(version: GraphVersion) {
    try { await setDefault.mutateAsync(version.id) }
    catch (error: any) { window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot set default')) }
  }

  function handleManagePublic(version: GraphVersion) { setPublicLinksVersion(version) }

  async function handleArchiveVersion(version: GraphVersion) {
    if (!window.confirm(`Archive ${formatVersionName(version)}?`)) return
    try { await archiveVersion.mutateAsync(version.id) }
    catch (error: any) { window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot archive')) }
  }

  async function handleUnarchiveVersion(version: GraphVersion) {
    try { await unarchiveVersion.mutateAsync(version.id) }
    catch (error: any) { window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot unarchive')) }
  }

  async function handleDeleteVersion(version: GraphVersion) {
    if (!window.confirm(`Delete ${formatVersionName(version)}? This only works if it has no runs and no public page.`)) return
    try {
      await deleteVersion.mutateAsync(version.id)
      if (resolvedParentVersionId === version.id) setActiveParentVersionId(latestNamedVersion?.id ?? null)
    } catch (error: any) {
      window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot delete'))
    }
  }

  function handleForkVersion(version: GraphVersion) {
    setForkDialog({ versionRowId: version.id, value: `${graph?.name ?? 'Workflow'} copy` })
  }

  async function submitForkVersion() {
    if (!forkDialog) return
    const trimmed = forkDialog.value.trim(); if (!trimmed) return
    try {
      const created = await forkVersion.mutateAsync({ versionRowId: forkDialog.versionRowId, name: trimmed })
      setForkDialog(null); navigate(`/graphs/${created.id}`)
    } catch (error: any) {
      window.alert(String(error?.response?.data?.detail ?? error?.message ?? 'Cannot copy workflow'))
    }
  }

  async function handleRetireWorkflow() {
    if (!graph) return
    const hasRuns = (graph.run_count ?? 0) > 0
    if (!window.confirm(hasRuns ? `Archive "${graph.name}"? It has ${graph.run_count} run(s), so it cannot be deleted.` : `Delete "${graph.name}" permanently?`)) return
    try { await deleteGraph.mutateAsync(graph.id); navigate('/graphs') }
    catch (error: any) { window.alert(`Cannot update workflow: ${String(error?.response?.data?.detail ?? error?.message ?? 'Action failed')}`) }
  }

  return {
    updateGraph, deleteGraph,
    publicLinksVersion, setPublicLinksVersion,
    publishDialog, setPublishDialog,
    renameDialog, setRenameDialog,
    forkDialog, setForkDialog,
    versionActionPending: archiveVersion.isPending || unarchiveVersion.isPending || deleteVersion.isPending
      || renameVersion.isPending || setDefault.isPending || forkVersion.isPending
      || promoteDraft.isPending || promoteRootDraft.isPending,
    publishPending: promoteDraft.isPending || promoteRootDraft.isPending,
    renamePending: renameVersion.isPending,
    forkPending: forkVersion.isPending,
    handleViewVersion, handleOpenVersion, handlePromoteCurrentDraft,
    handleRenameVersion, submitRenameVersion,
    handleSetDefault, handleManagePublic,
    handleArchiveVersion, handleUnarchiveVersion, handleDeleteVersion,
    handleForkVersion, submitForkVersion, handleRetireWorkflow,
  }
}
