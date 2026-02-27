import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Play, Plus, Save } from 'lucide-react'
import { useGraph, useSaveGraphVersion } from '@/api/graphs'
import { useTriggerRun } from '@/api/runs'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import { useCanvasStore } from '@/store/canvas'
import { useAuthStore } from '@/store/auth'
import type { NodeDef, NodeType, GraphDefinition } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: 'llm_agent', label: 'LLM Agent' },
  { value: 'human_checkpoint', label: 'Human Checkpoint' },
  { value: 'conditional_router', label: 'Conditional Router' },
  { value: 'tool_executor', label: 'Tool Executor' },
]

export default function GraphDetailPage() {
  const { graphId } = useParams<{ graphId: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const { data: graph, isLoading } = useGraph(workspaceId, graphId!)
  const triggerRun = useTriggerRun(workspaceId, graphId!)
  const saveVersion = useSaveGraphVersion(workspaceId, graphId!)

  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const addNode = useCanvasStore((s) => s.addNode)
  const addEdge = useCanvasStore((s) => s.addEdge)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const storeDefinition = useCanvasStore((s) => s.definition)
  const setGraph = useCanvasStore((s) => s.setGraph)

  const [inputJson, setInputJson] = useState('{}')
  const [inputError, setInputError] = useState('')
  const [addingNode, setAddingNode] = useState(false)
  const [newNodeName, setNewNodeName] = useState('')
  const [newNodeType, setNewNodeType] = useState<NodeType>('llm_agent')

  if (isLoading) return <p className="p-8 text-gray-400 text-sm">Loading…</p>
  if (!graph) return <p className="p-8 text-red-500 text-sm">Graph not found.</p>

  // Sync store from server on first load
  const serverDef = graph.latest_version?.definition ?? { nodes: [], edges: [] }
  const definition: GraphDefinition = isDirty ? storeDefinition : serverDef

  async function handleTrigger() {
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
    // Init store from server definition before mutating
    if (!isDirty) setGraph(graphId!, serverDef)
    const id = `${newNodeType}-${Date.now()}`
    const node: NodeDef = { id, type: newNodeType, name: newNodeName.trim(), config: {} }
    addNode(node)
    // Auto-connect to previous last node
    const nodes = isDirty ? storeDefinition.nodes : serverDef.nodes
    if (nodes.length > 0) {
      const prev = nodes[nodes.length - 1]
      addEdge({ id: `e-${prev.id}-${id}`, source: prev.id, target: id, type: 'direct' })
    }
    setNewNodeName('')
    setAddingNode(false)
  }

  async function handleSave() {
    await saveVersion.mutateAsync(definition)
    setGraph(graphId!, definition)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <h1 className="font-semibold text-gray-900">{graph.name}</h1>
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saveVersion.isPending}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              <Save size={14} /> Save
            </button>
          )}
          <button
            onClick={() => setAddingNode((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            <Plus size={14} /> Add node
          </button>
          <button
            onClick={handleTrigger}
            disabled={triggerRun.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-60"
          >
            <Play size={14} />
            {triggerRun.isPending ? 'Triggering…' : 'Run'}
          </button>
        </div>
      </div>

      {/* Add node form */}
      {addingNode && (
        <form
          onSubmit={handleAddNode}
          className="flex items-center gap-2 px-6 py-2 bg-gray-50 border-b border-gray-200"
        >
          <select
            value={newNodeType}
            onChange={(e) => setNewNodeType(e.target.value as NodeType)}
            className="border border-gray-300 rounded px-2 py-1 text-sm outline-none"
          >
            {NODE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
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

      {/* Canvas + side panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 p-4">
          <GraphCanvas definition={definition} selectedNodeId={selectedNodeId} onSelectNode={selectNode} />
        </div>
        {selectedNodeId && (
          <div className="w-72 border-l border-gray-200 p-4 bg-white overflow-y-auto">
            {(() => {
              const node = definition.nodes.find((n: { id: string }) => n.id === selectedNodeId)
              if (!node) return null
              return (
                <>
                  <h2 className="font-medium text-gray-900 mb-1">{node.name}</h2>
                  <p className="text-xs text-gray-500 mb-3 capitalize">{node.type.replace('_', ' ')}</p>
                  <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto">{JSON.stringify(node.config, null, 2)}</pre>
                </>
              )
            })()}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="border-t border-gray-200 px-6 py-3 bg-white flex items-start gap-3">
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Run input (JSON)</label>
          <input
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-500"
          />
          {inputError && <p className="text-xs text-red-500 mt-0.5">{inputError}</p>}
        </div>
      </div>
    </div>
  )
}
