/**
 * NodeConfigPanel — dispatches to AgentNodeConfig for the unified agent node.
 * Shown in the right sidebar when a node is selected on the canvas.
 *
 * Connections with ≥2 outgoing edges require a condition_label on each edge
 * so the agent knows which branch to evaluate. Missing labels are flagged
 * inline and also blocked by validate_graph() at run-start time.
 */
import { useState } from 'react'
import { AlertTriangle, ArrowDown, Bot, GitBranch, X } from 'lucide-react'
import type { NodeDef, EdgeDef, InputFieldDef } from '@data-models'
import ConfirmDialog from '@ui/components/ConfirmDialog'
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

function FlowConnector() {
  return (
    <div className="flex items-center gap-2 pl-3 py-0.5 text-gray-300" aria-hidden="true">
      <div className="h-3 w-px bg-gray-200" />
      <ArrowDown size={10} />
    </div>
  )
}

export default function NodeConfigPanel({
  node, allNodes, edges, inputFields = [], readOnly = false, onInputSchemaChange, onConfigChange, onRemove, onAddEdge, onUpdateEdge, onRemoveEdge,
}: Props) {
  const [connectTarget, setConnectTarget] = useState('')
  const [newConditionLabel, setNewConditionLabel] = useState('')
  const [connectError, setConnectError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
  const isAgentNode = node.type === 'agent'
  const contentClass = node.type === 'start'
    ? 'min-h-0 flex-1 overflow-y-auto px-0 py-0'
    : 'min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeader && (
        <div className="flex-shrink-0 border-b px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600">
                <Bot size={14} />
              </span>
              {!readOnly ? (
                <input
                  className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm font-medium text-gray-900 outline-none hover:border-gray-200 focus:border-brand-400 focus:ring-1 focus:ring-brand-200 bg-transparent"
                  value={node.name}
                  onChange={e => onConfigChange(node.id, { name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
              ) : (
                <h2 className="min-w-0 truncate font-medium text-gray-900 text-sm">{node.name}</h2>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={contentClass}>
        <div className={node.type === 'start' ? '' : 'space-y-3.5'}>
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

        {isAgentNode ? <FlowConnector /> : null}

        <div className={node.type === 'start' ? 'px-4 py-4 border-t border-gray-100' : ''}>
          {isAgentNode ? (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                  4
                </span>
                <span className="flex-shrink-0 text-gray-400">
                  <GitBranch size={14} />
                </span>
                <p className="text-sm font-medium text-gray-900">Next node</p>
              </div>
              <div className="space-y-2">
                {isMultiBranch && (
                  <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                    Multi-path node — each path needs a rule.
                  </p>
                )}

                {outgoing.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No next node connected.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {outgoing.map((edge, index) => {
                      const target = allNodes.find(n => n.id === edge.target)
                      const missingLabel = isMultiBranch && !edge.condition_label?.trim()
                      return (
                        <li key={edge.id} className="rounded-lg bg-gray-50 px-2.5 py-2 text-xs space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-700 font-medium">
                              {isMultiBranch ? `Path ${index + 1}` : 'Next'}: {target?.name ?? edge.target}
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
                              placeholder="Rule for taking this path…"
                              value={edge.condition_label ?? ''}
                              disabled={readOnly}
                              onChange={e => onUpdateEdge(edge.id, {
                                condition_label: e.target.value,
                                type: 'conditional',
                              })}
                            />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {!readOnly && canAddOutgoing && unconnected.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex gap-1">
                      <select value={connectTarget} onChange={e => setConnectTarget(e.target.value)}
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500">
                        <option value="">{newEdgeNeedsLabel ? 'Add path to…' : 'Connect to…'}</option>
                        {unconnected.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                      <button onClick={handleAddEdge}
                        disabled={!connectTarget || (newEdgeNeedsLabel && !newConditionLabel.trim())}
                        className="px-2 py-1 bg-brand-500 text-white rounded text-xs disabled:opacity-40 hover:bg-brand-600">
                        {newEdgeNeedsLabel ? 'Add path' : 'Connect'}
                      </button>
                    </div>
                    {newEdgeNeedsLabel && connectTarget && (
                      <input
                        type="text"
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="Rule for taking this path…"
                        value={newConditionLabel}
                        onChange={e => setNewConditionLabel(e.target.value)}
                      />
                    )}
                    {connectError && (
                      <p className="text-xs text-amber-600">{connectError}</p>
                    )}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <>
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
            </>
          )}
          {node.type === 'start' && outgoing.length >= 1 && (
            <p className="text-xs text-gray-400 italic">Start can connect to only one next node.</p>
          )}
        </div>

        {!isStartOrEnd && !readOnly && (
          <>
            <FlowConnector />
            <section data-ui="workflow.editor.inspector.delete" className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-500">
                <AlertTriangle size={13} />
                <span>Delete node</span>
              </div>
              <button
                type="button"
                data-ui="workflow.editor.inspector.delete.trigger"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
              >
                Delete this node
              </button>
            </section>
          </>
        )}
      </div>

      {showDeleteConfirm ? (
        <div data-ui="workflow.editor.inspector.delete.dialog">
          <ConfirmDialog
            title="Delete node?"
            message={`Delete "${node.name}" and remove its connections from the workflow?`}
            warning="This cannot be undone."
            confirmLabel="Delete node"
            confirmVariant="danger"
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={() => {
              setShowDeleteConfirm(false)
              onRemove(node.id)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
