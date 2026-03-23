import { useEffect, useId, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Archive, Check, ChevronLeft, ChevronRight, Globe, MessageSquare, Play, Plus, Save, Trash2 } from 'lucide-react'
import { useDeleteGraph, useGraph, useSaveGraphVersion } from '@/api/graphs'
import { useTriggerRun, useRuns } from '@/api/runs'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import NodeConfigPanel from '@/components/designer/NodeConfigPanel'
import InputSchemaEditor from '@/components/designer/InputSchemaEditor'
import DesignerChat from '@/components/designer/DesignerChat'
import RunTriggerModal from '@/components/operator/RunTriggerModal'
import PublicLinksModal from '@/components/operator/PublicLinksModal'
import DebugBar from '@/components/operator/DebugBar'
import Sidebar from '@/components/layout/Sidebar'
import { useCanvasStore } from '@/store/canvas'
import { useAuthStore } from '@/store/auth'
import type { NodeDef, NodeType, GraphDefinition, InputFieldDef } from '@/types'
import { validateGraph } from '@/utils/validateGraph'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: 'agent', label: 'Agent' },
]

type RightPanelMode = 'node' | 'schema'

export default function GraphDetailPage() {
  const { graphId } = useParams<{ graphId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const role = useAuthStore((s) => s.role)

  const { data: graph, isLoading } = useGraph(workspaceId, graphId!)
  const deleteGraph = useDeleteGraph(workspaceId)
  const triggerRun = useTriggerRun(workspaceId, graphId!)
  const saveVersion = useSaveGraphVersion(workspaceId, graphId!)
  const { data: runs = [] } = useRuns(workspaceId)
  const lastRun = runs.find((r) => r.graph_id === graphId) ?? null

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

  // Initialize store when navigating to a different graph (eager, not lazy).
  // This ensures empty graphs show start/end nodes immediately.
  useEffect(() => {
    if (!graph || storeGraphId === graphId) return
    const def = graph.latest_version?.definition ?? { nodes: [], edges: [] }
    setGraph(graphId!, def)
  }, [graph, graphId]) // eslint-disable-line

  const sessionId = useId()
  const [inputJson, setInputJson] = useState('{}')
  const [inputError, setInputError] = useState('')
  const [addingNode, setAddingNode] = useState(false)
  const [newNodeName, setNewNodeName] = useState('')
  const [newNodeType, setNewNodeType] = useState<NodeType>('agent')
  const [showChat, setShowChat] = useState(searchParams.get('chat') === '1')
  const [showRunModal, setShowRunModal] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('node')
  const [rightPanelVisible, setRightPanelVisible] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [showPublicLinks, setShowPublicLinks] = useState(false)

  useEffect(() => {
    if (searchParams.get('chat') === '1') setShowChat(true)
  }, [searchParams])

  useEffect(() => {
    if (!selectedNodeId && rightPanelMode === 'node') {
      setRightPanelVisible(false)
    }
  }, [selectedNodeId, rightPanelMode])

  // Unsaved changes warning
  useEffect(() => {
    if (!isDirty) { window.onbeforeunload = null; return }
    window.onbeforeunload = () => 'You have unsaved changes. Leave anyway?'
    return () => { window.onbeforeunload = null }
  }, [isDirty])

  if (isLoading) return <p className="p-8 text-gray-400 text-sm">Loading…</p>
  if (!graph) return <p className="p-8 text-red-500 text-sm">Graph not found.</p>

  const serverDef = graph.latest_version?.definition ?? { nodes: [], edges: [] }
  const definition: GraphDefinition = isDirty ? storeDefinition : serverDef
  const selectedNode = definition.nodes.find((n: NodeDef) => n.id === selectedNodeId) ?? null

  const validationErrors = validateGraph(definition)
  const hasValidationErrors = validationErrors.length > 0

  async function handleTriggerDebug() {
    let input: Record<string, unknown>
    try { input = JSON.parse(inputJson) } catch { setInputError('Invalid JSON'); return }
    setInputError('')
    if (!definition.nodes.length) { setInputError('Add at least one node first'); return }
    const run = await triggerRun.mutateAsync({ input })
    navigate(`/runs/${run.id}`)
  }

  function handleAddNode(e: React.FormEvent) {
    e.preventDefault()
    if (!newNodeName.trim()) return
    if (!isDirty) setGraph(graphId!, serverDef)
    const id = newNodeType === 'start' || newNodeType === 'end'
      ? newNodeType
      : `${newNodeType}-${Date.now()}`
    const node: NodeDef = {
      id, type: newNodeType, name: newNodeName.trim(), config: {},
      ...(newNodeType === 'agent' ? { agent_ref: 'openclaw', trust_level: 0.5 } : {}),
    }
    addNode(node)
    const nodes = isDirty ? storeDefinition.nodes : serverDef.nodes
    if (nodes.length > 0) {
      const prev = nodes[nodes.length - 1]
      addEdge({ id: `e-${prev.id}-${id}`, source: prev.id, target: id, type: 'direct' })
    }
    setNewNodeName('')
    setAddingNode(false)
  }

  async function handleSave() {
    const prevSelected = selectedNodeId
    await saveVersion.mutateAsync(definition)
    setGraph(graphId!, definition)
    if (prevSelected) selectNode(prevSelected)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2000)
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
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? 'Action failed'
      window.alert(`Cannot update workflow: ${msg}`)
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      <Sidebar />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white" style={{ flexShrink: 0 }}>
        <h1 className="font-semibold text-gray-900">{graph.name}</h1>
        <div className="flex items-center gap-2">
          {justSaved && (
            <span className="flex items-center gap-1.5 px-3 py-2 text-sm text-green-600 font-medium">
              <Check size={14} /> Saved
            </span>
          )}
          {isDirty && !justSaved && (
            <button
              onClick={handleSave}
              disabled={saveVersion.isPending}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Save size={14} /> {saveVersion.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
          <button
            onClick={() => setShowChat((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 ${
              showChat ? 'border-blue-400 text-blue-600' : 'border-gray-300 text-gray-700'
            }`}
          >
            <MessageSquare size={14} /> Designer
          </button>
          <button
            onClick={() => {
              setRightPanelMode('schema')
              setRightPanelVisible((v) => !v || rightPanelMode !== 'schema')
            }}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 ${
              rightPanelVisible && rightPanelMode === 'schema'
                ? 'border-blue-400 text-blue-600'
                : 'border-gray-300 text-gray-700'
            }`}
          >
            Run Input
          </button>
          <button
            onClick={() => setRightPanelVisible((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            disabled={!selectedNode && rightPanelMode === 'node'}
            title={!selectedNode && rightPanelMode === 'node' ? 'Select a node to open node config' : undefined}
          >
            {rightPanelVisible ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {rightPanelVisible ? 'Hide panel' : 'Show panel'}
          </button>
          <button
            onClick={() => setAddingNode((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            <Plus size={14} /> Add node
          </button>
          <button
            onClick={() => setShowRunModal(true)}
            disabled={hasValidationErrors}
            title={hasValidationErrors ? validationErrors[0] : undefined}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={14} /> Run
          </button>
          {role === 'owner' && (
            <button
              onClick={() => setShowPublicLinks(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              <Globe size={14} /> Public links
            </button>
          )}
          <button
            onClick={() => void handleRetireWorkflow()}
            disabled={deleteGraph.isPending}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm disabled:opacity-50 ${
              (graph.run_count ?? 0) > 0
                ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                : 'border-red-300 text-red-700 hover:bg-red-50'
            }`}
            title={(graph.run_count ?? 0) > 0 ? 'Archive workflow' : 'Delete workflow'}
          >
            {(graph.run_count ?? 0) > 0 ? <Archive size={14} /> : <Trash2 size={14} />}
            {deleteGraph.isPending ? 'Working…' : (graph.run_count ?? 0) > 0 ? 'Archive' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Validation warning */}
      {hasValidationErrors && (
        <div className="mx-6 mt-3 flex-shrink-0 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-700">Graph topology issue</p>
            <ul className="text-xs text-amber-600 mt-0.5 space-y-0.5">
              {validationErrors.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Add node form */}
      {addingNode && (
        <form
          onSubmit={handleAddNode}
          className="flex items-center gap-2 px-6 py-2 bg-gray-50 border-b border-gray-200"
          style={{ flexShrink: 0 }}
        >
          <select
            value={newNodeType}
            onChange={(e) => setNewNodeType(e.target.value as NodeType)}
            className="border border-gray-300 rounded px-2 py-1 text-sm outline-none"
          >
            {NODE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input
            autoFocus
            value={newNodeName}
            onChange={(e) => setNewNodeName(e.target.value)}
            placeholder="Node name"
            className="border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-brand-500 w-48"
          />
          <button type="submit" className="px-3 py-1 bg-brand-500 text-white rounded text-sm">Add</button>
          <button type="button" onClick={() => setAddingNode(false)} className="px-3 py-1 text-gray-500 text-sm">Cancel</button>
        </form>
      )}

      {/* Main area: canvas + side panels */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>

        {/* Left: designer chat */}
        {showChat && (
          <div
            className="border-r border-gray-200 bg-white"
            style={{ width: 440, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <DesignerChat
                graphId={graphId!}
                sessionId={sessionId}
                onBeforeApplyDelta={() => { if (!isDirty) setGraph(graphId!, serverDef) }}
              />
            </div>
          </div>
        )}

        {/* Center: canvas */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: 16 }}>
          <GraphCanvas
            definition={definition}
            selectedNodeId={selectedNodeId}
            onSelectNode={(nodeId) => {
              selectNode(nodeId)
              if (nodeId) {
                setRightPanelMode('node')
                setRightPanelVisible(true)
              }
            }}
          />
        </div>

        {/* Right panel */}
        {rightPanelVisible && (rightPanelMode === 'schema' || selectedNode) && (
          <div
            className="border-l border-gray-200 bg-white"
            style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div className="px-3 py-2 border-b text-xs font-semibold text-gray-600 uppercase tracking-wide">
              {rightPanelMode === 'schema' ? 'Run Input' : 'Node'}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {rightPanelMode === 'schema' ? (
                <InputSchemaEditor
                  fields={definition.input_schema ?? []}
                  onChange={(fields: InputFieldDef[]) => {
                    if (!isDirty) setGraph(graphId!, serverDef)
                    setInputSchema(fields)
                  }}
                />
              ) : selectedNode ? (
                <NodeConfigPanel
                  node={selectedNode}
                  allNodes={definition.nodes}
                  edges={definition.edges}
                  onConfigChange={(nodeId, patch) => updateNodeConfig(nodeId, patch)}
                  onRemove={(nodeId) => { removeNode(nodeId); selectNode(null) }}
                  onAddEdge={(edge) => addEdge(edge)}
                  onUpdateEdge={(edgeId, patch) => updateEdge(edgeId, patch)}
                  onRemoveEdge={(edgeId) => removeEdge(edgeId)}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Debug bar */}
      <DebugBar
        lastRun={lastRun}
        inputJson={inputJson}
        onInputChange={setInputJson}
        onTrigger={handleTriggerDebug}
        isTriggerPending={triggerRun.isPending}
        inputError={inputError}
      />

      {/* Run trigger modal */}
      {showRunModal && (
        <RunTriggerModal
          graphId={graphId!}
          definition={definition}
          onClose={() => setShowRunModal(false)}
        />
      )}

      {showPublicLinks && (
        <PublicLinksModal
          workspaceId={workspaceId}
          graphId={graphId!}
          currentVersionId={graph.latest_version?.id ?? null}
          onClose={() => setShowPublicLinks(false)}
        />
      )}
    </div>
    </div>
  )
}
