import { startTransition, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useWorkspaceMembers } from "@modules/admin/frontend/api/auth"
import { useChannelParticipants } from '@modules/communication/frontend/api/channels'
import { useGraph } from "@modules/workflows/frontend/api/graphs"
import { useRuns } from "@modules/workflows/frontend/api/runs"
import GraphCanvas from '@modules/workflows/frontend/components/canvas/GraphCanvas'
import RunTriggerModal from '@modules/workflows/frontend/components/operator/RunTriggerModal'
import { useCanvasStore } from '@modules/workflows/frontend/state/canvas'
import { useAuthStore } from '@auth'
import type { Graph, NodeDef } from '@data-models'
import { validateGraph } from '@modules/workflows/frontend/lib/validateGraph'
import LibrarySearch from '@modules/workflows/frontend/pages/designer/LibrarySearch'
import GraphTabMetaActions from '@modules/workflows/frontend/pages/designer/GraphTabMetaActions'
import GraphDialogs from '@modules/workflows/frontend/pages/designer/GraphDialogs'
import HistoryTab from '@modules/workflows/frontend/pages/designer/HistoryTab'
import UsagePanel from '@modules/workflows/frontend/pages/designer/UsagePanel'
import NodeConfigOverlay from '@modules/workflows/frontend/pages/designer/NodeConfigOverlay'
import ChatPanel from '@modules/workflows/frontend/pages/designer/ChatPanel'
import { useVersionSync } from '@modules/workflows/frontend/pages/designer/useVersionSync'
import { useVersionActions } from '@modules/workflows/frontend/pages/designer/useVersionActions'
import type { WorkflowTab } from '@modules/workflows/frontend/pages/designer/graphVersionUtils'
import { EditorWorkspaceTabs } from '@ui/components/EditorWorkspace'
import { buildParticipantLabelMap } from '@modules/workflows/frontend/lib/participantLabels'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const WORKFLOW_TABS: { id: WorkflowTab; label: string }[] = [
  { id: 'graph', label: 'Editor' },
  { id: 'history', label: 'History' },
  { id: 'usage', label: 'Usage' },
]

export interface GraphEditorWorkspaceHeaderProps {
  chatAvailable: boolean
  defaultVersionIsPublic: boolean
  graph: Graph
  renameGraph: (name: string) => void
  renamePending: boolean
  showChat: boolean
  toggleChat: () => void
}

export default function GraphEditorWorkspace({
  graphId,
  initialConsultationChannelId,
  defaultShowChat = false,
  allowWorkflowChat = true,
  showLibrarySearch = false,
  renderHeader,
}: {
  graphId: string
  initialConsultationChannelId?: string | null
  defaultShowChat?: boolean
  allowWorkflowChat?: boolean
  showLibrarySearch?: boolean
  renderHeader?: (props: GraphEditorWorkspaceHeaderProps) => ReactNode
}) {
  const workspaceId = useAuthStore((state) => state.workspaceId) ?? DEV_WORKSPACE
  const sessionId = useId()

  const { data: graph, isLoading } = useGraph(workspaceId, graphId)
  const { data: agentMembers } = useWorkspaceMembers(workspaceId, 1, 'agent', false)
  const { data: participants = [] } = useChannelParticipants(workspaceId)
  const { data: runs = [] } = useRuns(workspaceId)
  const hasAgentZero = useMemo(
    () => Boolean(agentMembers?.items.some((member) => member.agent_zero_role)),
    [agentMembers],
  )
  const chatAvailable = allowWorkflowChat && hasAgentZero
  const participantLabelMap = useMemo(() => buildParticipantLabelMap(participants), [participants])

  const [activeTab, setActiveTab] = useState<WorkflowTab>('graph')
  const [editorMode, setEditorMode] = useState<'view' | 'edit'>('view')
  const [showChat, setShowChat] = useState(defaultShowChat && allowWorkflowChat)
  const [hasMountedChat, setHasMountedChat] = useState(defaultShowChat && allowWorkflowChat)
  const [showRunModal, setShowRunModal] = useState(false)

  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId)
  const selectNode = useCanvasStore((state) => state.selectNode)
  const updateNodeConfig = useCanvasStore((state) => state.updateNodeConfig)
  const removeNode = useCanvasStore((state) => state.removeNode)
  const removeEdge = useCanvasStore((state) => state.removeEdge)
  const updateEdge = useCanvasStore((state) => state.updateEdge)
  const setInputSchema = useCanvasStore((state) => state.setInputSchema)
  const setCanvasGraph = useCanvasStore((state) => state.setGraph)

  const sync = useVersionSync(workspaceId, graphId, graph, editorMode)
  const actions = useVersionActions(
    workspaceId, graphId, graph,
    sync.resolvedParentVersionId, sync.latestNamedVersion,
    editorMode, sync.isDirty,
    sync.syncDraftNow, sync.loadDefinition,
    sync.setActiveParentVersionId, sync.setViewingVersionSnapshot,
    setActiveTab, setEditorMode,
  )

  useEffect(() => {
    if (!allowWorkflowChat) {
      setShowChat(false)
      setHasMountedChat(false)
      return
    }
    if (defaultShowChat) {
      setShowChat(true)
      setHasMountedChat(true)
    }
  }, [allowWorkflowChat, defaultShowChat])

  useEffect(() => {
    if (activeTab !== 'graph') {
      setEditorMode('view')
      setShowChat(false)
      selectNode(null)
      return
    }
    // Drafts always open in edit mode; version snapshots are always read-only.
    setEditorMode(sync.viewingVersionSnapshot ? 'view' : 'edit')
  }, [activeTab, selectNode, sync.viewingVersionSnapshot])

  const { definition, serverDefinition, isDirty } = sync
  const validationErrors = useMemo(() => validateGraph(definition), [definition])
  const selectedNode = useMemo(
    () => definition.nodes.find((node: NodeDef) => node.id === selectedNodeId) ?? null,
    [definition.nodes, selectedNodeId],
  )
  const defaultVersionIsPublic = !!sync.namedVersions.find((version) => version.id === graph?.production_version_id)?.version_slug
  const isGraphTab = activeTab === 'graph'
  const chatVisible = isGraphTab && showChat
  const hasRuns = (graph?.run_count ?? 0) > 0

  const handleToggleChat = useCallback(() => {
    if (!chatAvailable) return
    if (!showChat) setHasMountedChat(true)
    startTransition(() => {
      setShowChat((value) => !value)
    })
  }, [chatAvailable, showChat])

  const handleCloseChat = useCallback(() => {
    startTransition(() => {
      setShowChat(false)
    })
  }, [])

  const handleChatBeforeApplyDelta = useCallback(() => {
    if (!isDirty) setCanvasGraph(graphId, serverDefinition)
  }, [graphId, isDirty, serverDefinition, setCanvasGraph])

  if (isLoading) return <p data-ui="workflow.editor.loading" className="p-8 text-sm text-gray-400">Loading…</p>
  if (!graph) return <p data-ui="workflow.editor.empty" className="p-8 text-sm text-red-500">Graph not found.</p>

  return (
    <div data-ui="workflow.editor" className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      {showLibrarySearch ? (
        <div data-ui="workflow.editor.library">
          <LibrarySearch />
        </div>
      ) : null}
      {renderHeader ? (
        <div data-ui="workflow.editor.header">
          {renderHeader({
            chatAvailable,
            defaultVersionIsPublic,
            graph,
            renameGraph: (name) => actions.updateGraph.mutate({ graphId: graph.id, name }),
            renamePending: actions.updateGraph.isPending,
            showChat,
            toggleChat: handleToggleChat,
          })}
        </div>
      ) : null}

      <div data-ui="workflow.editor.body" className="flex min-h-0 flex-1 flex-row">
        <div data-ui="workflow.editor.main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <EditorWorkspaceTabs
            tabs={WORKFLOW_TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            actions={activeTab === 'graph'
              ? (
                  <GraphTabMetaActions
                    currentVersionLabel={sync.currentVersionLabel}
                    autosaveState={sync.autosaveState}
                    autosaveError={sync.autosaveError}
                    validationErrors={validationErrors}
                    showLifecycleActions={editorMode === 'edit'}
                    publishPending={actions.publishPending}
                    deleteGraphPending={actions.deleteGraph.isPending}
                    hasRuns={hasRuns}
                    onOpenHistory={() => setActiveTab('history')}
                    onRun={() => setShowRunModal(true)}
                    onRetrySave={() => void sync.syncDraftNow()}
                    onPublish={() => actions.setPublishDialog(true)}
                    onRetire={() => void actions.handleRetireWorkflow()}
                  />
                )
              : activeTab === 'history'
                ? (
                    <button
                      type="button"
                      data-ui="workflow.editor.tabs.history.archive-toggle"
                      aria-pressed={sync.showArchivedVersions}
                      onClick={() => sync.setShowArchivedVersions((value) => !value)}
                      className="rounded-lg px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    >
                      {sync.showArchivedVersions ? 'Hide archived' : 'Show archived'}
                    </button>
                  )
                : undefined}
            dataUiBase="workflow.editor.tabs"
          />

          {isGraphTab && validationErrors.length > 0 ? (
            <div data-ui="workflow.editor.validation.banner" className="mx-6 mt-3 flex flex-shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
              <div>
                <p data-ui="workflow.editor.validation.title" className="text-xs font-semibold text-amber-700">Graph topology issue</p>
                <ul data-ui="workflow.editor.validation.list" className="mt-0.5 space-y-0.5 text-xs text-amber-600">
                  {validationErrors.map((error, index) => <li key={index}>• {error}</li>)}
                </ul>
              </div>
            </div>
          ) : null}

          <div
            data-ui="workflow.editor.content"
            className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${isGraphTab ? 'flex-row bg-gray-50/60' : 'bg-white'}`}
          >
            {isGraphTab ? (
              <div data-ui="workflow.editor.canvas-region" className="flex h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden">
                <GraphCanvas
                  definition={definition}
                  participantLabelMap={participantLabelMap}
                  selectedNodeId={selectedNodeId}
                  editable={editorMode === 'edit'}
                  graphId={graphId}
                  onSelectNode={selectNode}
                />
              </div>
            ) : activeTab === 'history' ? (
              <div data-ui="workflow.editor.history-region" className="flex h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden">
                <HistoryTab
                  graphSlug={graph.slug ?? null}
                  namedVersions={sync.namedVersions}
                  activeDraft={sync.activeDraft}
                  versionsLoading={sync.versionsLoading}
                  graphDefaultVersionId={graph.production_version_id ?? null}
                  resolvedParentVersionId={sync.resolvedParentVersionId}
                  versionActionPending={actions.versionActionPending}
                  onOpenVersion={(version) => void actions.handleOpenVersion(version)}
                  onRenameVersion={actions.handleRenameVersion}
                  onViewVersion={actions.handleViewVersion}
                  onSetDefault={(version) => void actions.handleSetDefault(version)}
                  onForkVersion={actions.handleForkVersion}
                  onArchiveVersion={(version) => void actions.handleArchiveVersion(version)}
                  onUnarchiveVersion={(version) => void actions.handleUnarchiveVersion(version)}
                  onDeleteVersion={(version) => void actions.handleDeleteVersion(version)}
                  onManagePublic={actions.handleManagePublic}
                  onPublish={() => actions.setPublishDialog(true)}
                  onEditRootDraft={() => setActiveTab('graph')}
                  historySelection={sync.historySelection}
                  onSelectHistoryItem={sync.selectHistoryItem}
                />
              </div>
            ) : (
              <div data-ui="workflow.editor.usage-region" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <UsagePanel graphId={graphId} runs={runs} namedVersions={sync.namedVersions} />
              </div>
            )}

            {activeTab === 'graph' && selectedNode ? (
              <div data-ui="workflow.editor.inspector-region" className="min-h-0 shrink-0 overflow-hidden">
                <NodeConfigOverlay
                  node={selectedNode}
                  definition={definition}
                  readOnly={editorMode !== 'edit'}
                  onClose={() => selectNode(null)}
                  onInputSchemaChange={setInputSchema}
                  onConfigChange={updateNodeConfig}
                  onRemove={(id) => {
                    removeNode(id)
                    selectNode(null)
                  }}
                  onUpdateEdge={updateEdge}
                  onRemoveEdge={removeEdge}
                />
              </div>
            ) : null}
          </div>
        </div>

        {allowWorkflowChat && hasMountedChat ? (
          <div
            data-ui="workflow.editor.chat-region"
            className="hidden shrink-0 overflow-hidden md:flex motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-in-out motion-reduce:transition-none"
            style={{ width: chatVisible ? 440 : 0 }}
            aria-hidden={!chatVisible}
          >
            <ChatPanel
              visible={chatVisible}
              graphId={graphId}
              sessionId={sessionId}
              initialConsultationChannelId={initialConsultationChannelId}
              onClose={handleCloseChat}
              onBeforeApplyDelta={handleChatBeforeApplyDelta}
              renderMobile={false}
            />
          </div>
        ) : null}

        {allowWorkflowChat && chatVisible ? (
          <div className="md:hidden">
            <ChatPanel
              visible
              graphId={graphId}
              sessionId={sessionId}
              initialConsultationChannelId={initialConsultationChannelId}
              onClose={handleCloseChat}
              onBeforeApplyDelta={handleChatBeforeApplyDelta}
              renderDesktop={false}
            />
          </div>
        ) : null}
      </div>

      {showRunModal ? (
        <div data-ui="workflow.editor.dialog.run">
          <RunTriggerModal
            graphId={graphId}
            definition={definition}
            onClose={() => setShowRunModal(false)}
            defaultGraphVersionId={sync.activeDraft?.id ?? sync.activeParentVersion?.id ?? null}
          />
        </div>
      ) : null}

      <GraphDialogs
        workspaceId={workspaceId}
        graphId={graphId}
        publishDialog={actions.publishDialog}
        onClosePublish={() => actions.setPublishDialog(false)}
        onPublishPublic={() => void actions.handlePromoteCurrentDraft(true)}
        onPublishPrivate={() => void actions.handlePromoteCurrentDraft(false)}
        publishPending={actions.publishPending}
        renameDialog={actions.renameDialog}
        onRenameChange={(value) => actions.setRenameDialog(actions.renameDialog ? { ...actions.renameDialog, value } : null)}
        onRenameSubmit={() => void actions.submitRenameVersion()}
        onRenameClose={() => actions.setRenameDialog(null)}
        renamePending={actions.renamePending}
        forkDialog={actions.forkDialog}
        onForkChange={(value) => actions.setForkDialog(actions.forkDialog ? { ...actions.forkDialog, value } : null)}
        onForkSubmit={() => void actions.submitForkVersion()}
        onForkClose={() => actions.setForkDialog(null)}
        forkPending={actions.forkPending}
        publicLinksVersion={actions.publicLinksVersion}
        graph={graph}
        onClosePublicLinks={() => actions.setPublicLinksVersion(null)}
      />
    </div>
  )
}
