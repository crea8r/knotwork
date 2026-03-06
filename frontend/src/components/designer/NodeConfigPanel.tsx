/**
 * NodeConfigPanel — dispatches to AgentNodeConfig for all agent-capable nodes.
 * Shown in the right sidebar when a node is selected on the canvas.
 *
 * S7: all llm_agent / human_checkpoint / conditional_router / tool_executor
 * nodes are replaced by the unified 'agent' type. Legacy types still render
 * via AgentNodeConfig with backward-compat defaults.
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import type { NodeDef, EdgeDef } from '@/types'
import AgentNodeConfig from './config/AgentNodeConfig'

interface Props {
  node: NodeDef
  allNodes: NodeDef[]
  edges: EdgeDef[]
  onConfigChange: (nodeId: string, patch: Record<string, unknown>) => void
  onRemove: (nodeId: string) => void
  onAddEdge: (edge: EdgeDef) => void
  onRemoveEdge: (edgeId: string) => void
}

const TYPE_LABEL: Record<string, string> = {
  agent: 'Agent',
  llm_agent: 'Agent (legacy)',
  human_checkpoint: 'Human (legacy)',
  conditional_router: 'Router (legacy)',
  tool_executor: 'Tool Executor (removed)',
  start: 'Start',
  end: 'End',
}

const AGENT_TYPES = new Set(['agent', 'llm_agent', 'human_checkpoint', 'conditional_router'])

export default function NodeConfigPanel({
  node, allNodes, edges, onConfigChange, onRemove, onAddEdge, onRemoveEdge,
}: Props) {
  const [connectTarget, setConnectTarget] = useState('')

  const otherNodes = allNodes.filter(n => n.id !== node.id)
  const predecessorIds = new Set(edges.filter(e => e.target === node.id).map(e => e.source))
  const predecessorNodes = allNodes.filter(n => predecessorIds.has(n.id))
  const outgoing = edges.filter(e => e.source === node.id)
  const connectedIds = new Set(outgoing.map(e => e.target))
  const unconnected = otherNodes.filter(n => !connectedIds.has(n.id))

  function handleAddEdge() {
    if (!connectTarget) return
    const edge: EdgeDef = {
      id: `e-${node.id}-${connectTarget}-${Date.now()}`,
      source: node.id, target: connectTarget, type: 'direct',
    }
    onAddEdge(edge)
    setConnectTarget('')
  }

  /**
   * AgentNodeConfig calls onChange(nodeFieldsPatch, configPatch?).
   * nodeFieldsPatch contains top-level NodeDef fields (agent_ref, trust_level).
   * configPatch contains nested config fields.
   * We merge both into a single flat patch sent to onConfigChange.
   */
  function handleAgentChange(nodeFieldsPatch: Record<string, unknown>, configPatch?: Record<string, unknown>) {
    const merged: Record<string, unknown> = {}
    // Top-level node fields are passed through as-is to onConfigChange
    // (the store handles agent_ref / trust_level separately if they're set)
    Object.assign(merged, nodeFieldsPatch)
    if (configPatch) Object.assign(merged, { _config: configPatch })
    onConfigChange(node.id, { ...nodeFieldsPatch, ...(configPatch ? { _config: configPatch } : {}) })
  }

  const isStartOrEnd = node.type === 'start' || node.type === 'end'
  const isToolExecutor = node.type === 'tool_executor'

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-medium text-gray-900 text-sm">{node.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{TYPE_LABEL[node.type] ?? node.type}</p>
            <p className="text-xs font-mono text-gray-300 mt-0.5">{node.id}</p>
          </div>
          {!isStartOrEnd && (
            <button onClick={() => onRemove(node.id)} className="text-xs text-red-400 hover:text-red-600 mt-0.5">
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <div>
          {isStartOrEnd && (
            <p className="text-sm text-gray-400 italic">
              {node.type === 'start' ? 'Start of workflow — no configuration needed.' : 'End of workflow — no configuration needed.'}
            </p>
          )}
          {isToolExecutor && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
              <strong>Removed in S7.</strong> Tool Executor nodes are no longer supported.
              Delete this node and replace it with an Agent node.
            </div>
          )}
          {AGENT_TYPES.has(node.type) && (
            <AgentNodeConfig
              node={node}
              onChange={handleAgentChange}
              predecessorNodes={predecessorNodes}
            />
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Connections</p>
          {outgoing.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No outgoing connections.</p>
          ) : (
            <ul className="space-y-1 mb-2">
              {outgoing.map(edge => {
                const target = allNodes.find(n => n.id === edge.target)
                return (
                  <li key={edge.id} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1 text-xs">
                    <span className="text-gray-700">→ {target?.name ?? edge.target}</span>
                    <button onClick={() => onRemoveEdge(edge.id)} className="text-gray-300 hover:text-red-500 ml-2" title="Remove connection">
                      <X size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {unconnected.length > 0 && (
            <div className="flex gap-1 mt-2">
              <select value={connectTarget} onChange={e => setConnectTarget(e.target.value)}
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">Connect to…</option>
                {unconnected.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <button onClick={handleAddEdge} disabled={!connectTarget}
                className="px-2 py-1 bg-brand-500 text-white rounded text-xs disabled:opacity-40 hover:bg-brand-600">
                Add
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
