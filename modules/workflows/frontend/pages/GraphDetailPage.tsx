import { useEffect, useId, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useWorkspaceMembers } from "@modules/admin/frontend/api/auth"
import { useGraph } from "@modules/workflows/frontend/api/graphs"
import { useRuns } from "@modules/workflows/frontend/api/runs"
import GraphCanvas from '@modules/workflows/frontend/components/canvas/GraphCanvas'
import Sidebar from '@app-shell/Sidebar'
import RunTriggerModal from '@modules/workflows/frontend/components/operator/RunTriggerModal'
import { useCanvasStore } from '@modules/workflows/frontend/state/canvas'
import { useAuthStore } from '@auth'
import type { NodeDef } from '@data-models'
import { validateGraph } from '@modules/workflows/frontend/lib/validateGraph'
import LibrarySearch from './designer/LibrarySearch'
import WorkflowHeader from './designer/WorkflowHeader'
import GraphTabBar from './designer/GraphTabBar'
import GraphDialogs from './designer/GraphDialogs'
import HistoryTab from './designer/HistoryTab'
import UsagePanel from './designer/UsagePanel'
import NodeConfigOverlay from './designer/NodeConfigOverlay'
import ChatPanel from './designer/ChatPanel'
import { useVersionSync } from './designer/useVersionSync'
import { useVersionActions } from './designer/useVersionActions'
import type { WorkflowTab } from './designer/graphVersionUtils'
import { EditorWorkspaceTabs } from '@ui/components/EditorWorkspace'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const WORKFLOW_TABS: { id: WorkflowTab; label: string }[] = [
  { id: 'graph', label: 'Editor' },
  { id: 'history', label: 'History' },
  { id: 'usage', label: 'Usage' },
]

export default function GraphDetailPage() {
  const { graphId } = useParams<{ graphId: string }>()
  const [searchParams] = useSearchParams()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const sessionId = useId()
  const consultationChannelId = searchParams.get('consultation')

  const { data: graph, isLoading } = useGraph(workspaceId, graphId!)
  const { data: agentMembers } = useWorkspaceMembers(workspaceId, 1, 'agent', false)
  const { data: runs = [] } = useRuns(workspaceId)
  const hasAgentZero = Boolean(agentMembers?.items.some((member) => member.agent_zero_role))

  const [activeTab, setActiveTab] = useState<WorkflowTab>('graph')
  const [editorMode, setEditorMode] = useState<'view' | 'edit'>('view')
  const [showChat, setShowChat] = useState(searchParams.get('chat') === '1')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)

  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const updateNodeConfig = useCanvasStore((s) => s.updateNodeConfig)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const removeEdge = useCanvasStore((s) => s.removeEdge)
  const updateEdge = useCanvasStore((s) => s.updateEdge)
  const setInputSchema = useCanvasStore((s) => s.setInputSchema)

  const sync = useVersionSync(workspaceId, graphId, graph, editorMode)
  const actions = useVersionActions(
    workspaceId, graphId, graph,
    sync.resolvedParentVersionId, sync.latestNamedVersion,
    editorMode, sync.isDirty,
    sync.syncDraftNow, sync.loadDefinition,
    sync.setActiveParentVersionId, sync.setViewingVersionSnapshot,
    setActiveTab, setEditorMode,
  )

  useEffect(() => { if (searchParams.get('chat') === '1') setShowChat(true) }, [searchParams])
  useEffect(() => {
    if (activeTab !== 'graph') { setEditorMode('view'); setShowChat(false); selectNode(null); return }
    // Drafts always open in edit mode; version snapshots are always read-only.
    setEditorMode(sync.viewingVersionSnapshot ? 'view' : 'edit')
  }, [activeTab, sync.viewingVersionSnapshot, selectNode])

  const { definition, serverDefinition, isDirty } = sync
  const validationErrors = validateGraph(definition)
  const selectedNode = definition.nodes.find((n: NodeDef) => n.id === selectedNodeId) ?? null

  if (isLoading) return <p className="p-8 text-sm text-gray-400">Loading…</p>
  if (!graph) return <p className="p-8 text-sm text-red-500">Graph not found.</p>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      {mobileNavOpen && <button className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />}
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header className="md:hidden flex-shrink-0 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 z-20">
          <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={16} /></button>
          <p className="text-sm font-semibold text-gray-900 truncate">{graph.name}</p>
        </header>

        <LibrarySearch />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            <WorkflowHeader
              workspaceId={workspaceId} graph={graph} showChat={showChat}
              defaultVersionIsPublic={!!sync.namedVersions.find((v) => v.id === graph.production_version_id)?.version_slug}
              onToggleChat={() => { if (hasAgentZero) setShowChat((v) => !v) }}
              renamePending={actions.updateGraph.isPending}
              onRename={(name) => actions.updateGraph.mutate({ graphId: graph.id, name })}
              chatAvailable={hasAgentZero}
            />

            <EditorWorkspaceTabs tabs={WORKFLOW_TABS} activeTab={activeTab} onTabChange={setActiveTab} />

            {activeTab === 'graph' && (
              <GraphTabBar
                editorMode={editorMode} setEditorMode={setEditorMode}
                autosaveState={sync.autosaveState} autosaveError={sync.autosaveError}
                currentVersionLabel={sync.currentVersionLabel}
                activeParentVersionId={sync.activeParentVersionId}
                validationErrors={validationErrors} graph={graph}
                serverDefinition={serverDefinition} graphId={graphId!}
                publishPending={actions.publishPending} deleteGraphPending={actions.deleteGraph.isPending}
                onPublish={() => actions.setPublishDialog(true)}
                onRetire={() => void actions.handleRetireWorkflow()}
                onSyncDraftNow={() => void sync.syncDraftNow().finally(() => setEditorMode('view'))}
                setViewingVersionSnapshot={sync.setViewingVersionSnapshot}
                onRun={() => setShowRunModal(true)}
              />
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: 16 }}>
                {activeTab === 'graph' ? (
                  <GraphCanvas definition={definition} selectedNodeId={selectedNodeId} onSelectNode={selectNode} />
                ) : activeTab === 'history' ? (
                  <HistoryTab
                    graphSlug={graph.slug ?? null}
                    namedVersions={sync.namedVersions} activeDraft={sync.activeDraft}
                    versionsLoading={sync.versionsLoading}
                    showArchivedVersions={sync.showArchivedVersions} setShowArchivedVersions={sync.setShowArchivedVersions}
                    graphDefaultVersionId={graph.production_version_id ?? null}
                    resolvedParentVersionId={sync.resolvedParentVersionId}
                    versionActionPending={actions.versionActionPending}
                    onOpenVersion={(v) => void actions.handleOpenVersion(v)} onRenameVersion={actions.handleRenameVersion}
                    onViewVersion={actions.handleViewVersion} onSetDefault={(v) => void actions.handleSetDefault(v)}
                    onForkVersion={actions.handleForkVersion} onArchiveVersion={(v) => void actions.handleArchiveVersion(v)}
                    onUnarchiveVersion={(v) => void actions.handleUnarchiveVersion(v)} onDeleteVersion={(v) => void actions.handleDeleteVersion(v)}
                    onManagePublic={actions.handleManagePublic} onPublish={() => actions.setPublishDialog(true)}
                    onEditRootDraft={() => setActiveTab('graph')}
                    historySelection={sync.historySelection} onSelectHistoryItem={sync.selectHistoryItem}
                  />
                ) : (
                  <div className="h-full overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <UsagePanel graphId={graphId!} runs={runs} namedVersions={sync.namedVersions} />
                  </div>
                )}
              </div>

              {activeTab === 'graph' && selectedNode && (
                <NodeConfigOverlay
                  node={selectedNode} definition={definition} readOnly={editorMode !== 'edit'}
                  onClose={() => selectNode(null)}
                  onInputSchemaChange={setInputSchema}
                  onConfigChange={updateNodeConfig}
                  onRemove={(id) => { removeNode(id); selectNode(null) }}
                  onUpdateEdge={updateEdge} onRemoveEdge={removeEdge}
                />
              )}
            </div>
          </div>

          {activeTab === 'graph' && showChat && (
            <ChatPanel
              graphId={graphId!} sessionId={sessionId}
              initialConsultationChannelId={consultationChannelId}
              onClose={() => setShowChat(false)}
              onBeforeApplyDelta={() => { if (!isDirty) sync.setGraph(graphId!, serverDefinition) }}
            />
          )}
        </div>

        {showRunModal && (
          <RunTriggerModal
            graphId={graphId!}
            definition={definition}
            onClose={() => setShowRunModal(false)}
            defaultGraphVersionId={sync.activeDraft?.id ?? sync.activeParentVersion?.id ?? null}
          />
        )}
        <GraphDialogs
          workspaceId={workspaceId} graphId={graphId!}
          publishDialog={actions.publishDialog} onClosePublish={() => actions.setPublishDialog(false)}
          onPublishPublic={() => void actions.handlePromoteCurrentDraft(true)}
          onPublishPrivate={() => void actions.handlePromoteCurrentDraft(false)}
          publishPending={actions.publishPending}
          renameDialog={actions.renameDialog}
          onRenameChange={(v) => actions.setRenameDialog(actions.renameDialog ? { ...actions.renameDialog, value: v } : null)}
          onRenameSubmit={() => void actions.submitRenameVersion()} onRenameClose={() => actions.setRenameDialog(null)}
          renamePending={actions.renamePending}
          forkDialog={actions.forkDialog}
          onForkChange={(v) => actions.setForkDialog(actions.forkDialog ? { ...actions.forkDialog, value: v } : null)}
          onForkSubmit={() => void actions.submitForkVersion()} onForkClose={() => actions.setForkDialog(null)}
          forkPending={actions.forkPending}
          publicLinksVersion={actions.publicLinksVersion} graph={graph} onClosePublicLinks={() => actions.setPublicLinksVersion(null)}
        />
      </div>
    </div>
  )
}
