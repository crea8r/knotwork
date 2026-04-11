/**
 * NodeConfigPanel — dispatches to AgentNodeConfig for the unified agent node.
 * Shown in the right sidebar when a node is selected on the canvas.
 *
 * Connections with ≥2 outgoing edges require a condition_label on each edge
 * so the agent knows which branch to evaluate. Missing labels are flagged
 * inline and also blocked by validate_graph() at run-start time.
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import type { NodeDef, EdgeDef, InputFieldDef } from '@data-models'
import AgentNodeConfig from './config/AgentNodeConfig'
import InputSchemaEditor from './InputSchemaEditor'

interface Props {
  node: NodeDef
  allNodes: NodeDef[]
  edges: EdgeDef[]
  inputFields?: InputFieldDef[]
  readOnly?: boolean
  onInputSchemaChange?: (fields: InputFieldDef[]) => void
  onConfigChange: (nodeId: string, patch: Record<string, unknown>) => void
  onRemove: (nodeId: string) => void
  onAddEdge: (edge: EdgeDef) => void
  onUpdateEdge: (edgeId: string, patch: Partial<EdgeDef>) => void
  onRemoveEdge: (edgeId: string) => void
}

const TYPE_LABEL: Record<string, string> = {
  agent: 'Agent',
  start: 'Start',
  end: 'End',
}

export default function NodeConfigPanel({
  node, allNodes, edges, inputFields = [], readOnly = false, onInputSchemaChange, onConfigChange, onRemove, onAddEdge, onUpdateEdge, onRemoveEdge,
}: Props) {
  const [connectTarget, setConnectTarget] = useState('')
  const [newConditionLabel, setNewConditionLabel] = useState('')
  const [connectError, setConnectError] = useState('')

  const otherNodes = allNodes.filter(n => n.id !== node.id)
  const predecessorIds = new Set(edges.filter(e => e.target === node.id).map(e => e.source))
  const predecessorNodes = allNodes.filter(n => predecessorIds.has(n.id))
  const outgoing = edges.filter(e => e.source === node.id)
  const connectedIds = new Set(outgoing.map(e => e.target))
  const unconnected = otherNodes.filter(n => !connectedIds.has(n.id))
  const canAddOutgoing = node.type !== 'end' && !(node.type === 'start' && outgoing.length >= 1)

  // Edges become conditional (require labels) when there are ≥2 outgoing
  const isMultiBranch = outgoing.length > 1
  // Adding a new edge when there's already 1 will make it multi-branch
  const newEdgeNeedsLabel = outgoing.length >= 1

  function handleAddEdge() {
    setConnectError('')
    if (!connectTarget) return
    if (newEdgeNeedsLabel && !newConditionLabel.trim()) return
    if (outgoing.length === 1 && !outgoing[0].condition_label?.trim()) {
      setConnectError('Label the existing path before adding another branch.')
      return
    }
    const willBeMultiBranch = outgoing.length >= 1
    const edge: EdgeDef = {
      id: `e-${node.id}-${connectTarget}-${Date.now()}`,
      source: node.id,
      target: connectTarget,
      type: willBeMultiBranch ? 'conditional' : 'direct',
      condition_label: willBeMultiBranch ? newConditionLabel.trim() : undefined,
    }
    // Also convert the existing single edge to conditional when 2nd is added
    if (outgoing.length === 1 && !outgoing[0].condition_label) {
      onUpdateEdge(outgoing[0].id, { type: 'conditional' })
    }
    onAddEdge(edge)
    setConnectTarget('')
    setNewConditionLabel('')
  }

  function handleAgentChange(nodeFieldsPatch: Record<string, unknown>, configPatch?: Record<string, unknown>) {
    onConfigChange(node.id, { ...nodeFieldsPatch, ...(configPatch ? { _config: configPatch } : {}) })
  }

  const isStartOrEnd = node.type === 'start' || node.type === 'end'
  const showHeader = !isStartOrEnd
  const contentClass = node.type === 'start'
    ? 'flex-1 overflow-y-auto px-0 py-0'
    : 'flex-1 overflow-y-auto px-4 py-4 space-y-6'

  return (
    <div className="flex flex-col h-full">
      {showHeader && (
        <div className="px-4 py-3 border-b">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {!readOnly ? (
                <input
                  className="w-full rounded border border-transparent px-1 py-0.5 text-sm font-medium text-gray-900 outline-none hover:border-gray-200 focus:border-brand-400 focus:ring-1 focus:ring-brand-200 bg-transparent"
                  value={node.name}
                  onChange={e => onConfigChange(node.id, { name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
              ) : (
                <h2 className="font-medium text-gray-900 text-sm px-1">{node.name}</h2>
              )}
              <p className="text-xs text-gray-400 mt-0.5 px-1">{TYPE_LABEL[node.type] ?? node.type}</p>
              <p className="text-xs font-mono text-gray-300 mt-0.5 px-1">{node.id}</p>
            </div>
            {!isStartOrEnd && !readOnly && (
              <button onClick={() => onRemove(node.id)} className="text-xs text-red-400 hover:text-red-600 mt-1 flex-shrink-0">
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      <div className={contentClass}>
        <div className={node.type === 'start' ? '' : 'space-y-6'}>
          {isStartOrEnd && (
            node.type === 'start' ? (
              <InputSchemaEditor
                fields={inputFields}
                readOnly={readOnly}
                onChange={(fields) => onInputSchemaChange?.(fields)}
              />
            ) : (
              <p className="text-sm text-gray-400 italic">
                End of workflow — no configuration needed.
              </p>
            )
          )}
          {node.type === 'agent' && (
            <AgentNodeConfig
              node={node}
              onChange={handleAgentChange}
              predecessorNodes={predecessorNodes}
              readOnly={readOnly}
            />
          )}
        </div>

        <div className={node.type === 'start' ? 'px-4 py-4 border-t border-gray-100' : ''}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Connections</p>

          {isMultiBranch && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
              Multi-branch node — each connection needs an evaluation condition.
            </p>
          )}

          {outgoing.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No outgoing connections.</p>
          ) : (
            <ul className="space-y-2 mb-2">
              {outgoing.map((edge, index) => {
                const target = allNodes.find(n => n.id === edge.target)
                const missingLabel = isMultiBranch && !edge.condition_label?.trim()
                return (
                  <li key={edge.id} className="bg-gray-50 rounded px-2 py-1.5 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700 font-medium">
                        {isMultiBranch ? `Branch ${index + 1}` : 'Next step'}: {target?.name ?? edge.target}
                      </span>
                      {!readOnly && (
                        <button onClick={() => onRemoveEdge(edge.id)} className="text-gray-300 hover:text-red-500 ml-2" title="Remove connection">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    {isMultiBranch && (
                      <input
                        type="text"
                        className={`w-full border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500 ${missingLabel ? 'border-amber-400 bg-amber-50 placeholder-amber-400' : 'border-gray-200'}`}
                        placeholder="Condition for taking this branch (required)…"
                        value={edge.condition_label ?? ''}
                        disabled={readOnly}
                        onChange={e => onUpdateEdge(edge.id, {
                          condition_label: e.target.value,
                          type: 'conditional',
                        })}
                      />
                    )}
                    {!isMultiBranch && (
                      <p className="text-[11px] text-gray-400">Single path node. Add another path to turn this into branching.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {!readOnly && canAddOutgoing && unconnected.length > 0 && (
            <div className="space-y-1 mt-2">
              <div className="flex gap-1">
                <select value={connectTarget} onChange={e => setConnectTarget(e.target.value)}
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500">
                  <option value="">{newEdgeNeedsLabel ? 'Add branch to…' : 'Connect to…'}</option>
                  {unconnected.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
                <button onClick={handleAddEdge}
                  disabled={!connectTarget || (newEdgeNeedsLabel && !newConditionLabel.trim())}
                  className="px-2 py-1 bg-brand-500 text-white rounded text-xs disabled:opacity-40 hover:bg-brand-600">
                  {newEdgeNeedsLabel ? 'Add branch' : 'Set next'}
                </button>
              </div>
              {newEdgeNeedsLabel && connectTarget && (
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="Condition for taking this branch (required)…"
                  value={newConditionLabel}
                  onChange={e => setNewConditionLabel(e.target.value)}
                />
              )}
              {connectError && (
                <p className="text-xs text-amber-600">{connectError}</p>
              )}
            </div>
          )}
          {node.type === 'start' && outgoing.length >= 1 && (
            <p className="text-xs text-gray-400 italic">Start can connect to only one next node.</p>
          )}
        </div>
      </div>
    </div>
  )
}
