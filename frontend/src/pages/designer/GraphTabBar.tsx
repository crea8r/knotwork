import { useState } from 'react'
import { AlertTriangle, Archive, Globe, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import Btn from '@/components/shared/Btn'
import type { Graph, GraphDefinition, NodeDef } from '@/types'
import { useCanvasStore } from '@/store/canvas'
import type { AutosaveState } from './graphVersionUtils'

export default function GraphTabBar({
  editorMode,
  setEditorMode,
  autosaveState,
  autosaveError,
  currentVersionLabel,
  activeParentVersionId,
  validationErrors,
  graph,
  serverDefinition,
  graphId,
  publishPending,
  deleteGraphPending,
  onPublish,
  onRetire,
  onSyncDraftNow,
  setViewingVersionSnapshot,
  onRun,
}: {
  editorMode: 'view' | 'edit'
  setEditorMode: (mode: 'view' | 'edit') => void
  autosaveState: AutosaveState
  autosaveError: string
  currentVersionLabel: string
  activeParentVersionId: string | null | undefined
  validationErrors: string[]
  graph: Graph
  serverDefinition: GraphDefinition
  graphId: string
  publishPending: boolean
  deleteGraphPending: boolean
  onPublish: () => void
  onRetire: () => void
  onSyncDraftNow: () => void
  setViewingVersionSnapshot: (v: boolean) => void
  onRun: () => void
}) {
  const [addingNode, setAddingNode] = useState(false)
  const [newNodeName, setNewNodeName] = useState('')
  const [showErrorDialog, setShowErrorDialog] = useState(false)

  const addNode = useCanvasStore((s) => s.addNode)
  const addEdge = useCanvasStore((s) => s.addEdge)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const storeDefinition = useCanvasStore((s) => s.definition)
  const setGraph = useCanvasStore((s) => s.setGraph)

  function handleAddNode(e: React.FormEvent) {
    e.preventDefault()
    if (!newNodeName.trim()) return
    if (!isDirty) setGraph(graphId, serverDefinition)
    const id = `agent-${Date.now()}`
    const node: NodeDef = {
      id,
      type: 'agent',
      name: newNodeName.trim(),
      config: {},
      agent_ref: 'openclaw',
      trust_level: 0.5,
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

  const hasValidationErrors = validationErrors.length > 0
  const hasRuns = (graph.run_count ?? 0) > 0

  return (
    <>
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 flex items-center gap-2 flex-shrink-0 overflow-x-auto">
        {editorMode === 'edit' && <span className="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400" />}
        <span className="text-xs font-medium text-gray-600 flex-shrink-0">{currentVersionLabel}</span>
        {editorMode === 'view' && activeParentVersionId === null ? (
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors flex-shrink-0"
            onClick={() => { setEditorMode('edit'); setViewingVersionSnapshot(false) }}
          >
            <Pencil size={10} /> Edit
          </button>
        ) : editorMode === 'edit' ? (
          <>
            <span className="text-gray-300 flex-shrink-0">·</span>
            {autosaveState === 'error' ? (
              <span className="flex items-center gap-1 text-xs text-red-500 flex-shrink-0">
                {autosaveError || 'Save failed'}
                <button onClick={onSyncDraftNow} className="underline hover:no-underline">Retry</button>
              </span>
            ) : autosaveState === 'saving' ? (
              <span className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                <Loader2 size={10} className="animate-spin" /> Saving…
              </span>
            ) : autosaveState === 'saved' ? (
              <span className="text-xs text-gray-400 flex-shrink-0">Saved</span>
            ) : (
              <span className="text-xs text-gray-400 flex-shrink-0">Auto-saves as you edit</span>
            )}
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {hasValidationErrors && (
            <>
              <span className="hidden md:inline text-xs text-amber-600 truncate max-w-[180px]" title={validationErrors.join(', ')}>
                {validationErrors[0].length > 32 ? validationErrors[0].slice(0, 30) + '…' : validationErrors[0]}
              </span>
              <button className="md:hidden flex items-center justify-center w-6 h-6 rounded text-amber-500 hover:bg-amber-50" onClick={() => setShowErrorDialog(true)} title="Graph topology issues">
                <AlertTriangle size={14} />
              </button>
            </>
          )}
          <Btn size="sm" variant="primary" disabled={hasValidationErrors} onClick={onRun}>
            <Play size={12} /><span className="hidden md:inline"> Run</span>
          </Btn>
          {editorMode === 'edit' && <>
            <Btn size="sm" title="Publish" loading={publishPending} onClick={onPublish}>
              <Globe size={13} /><span className="hidden md:inline"> Publish</span>
            </Btn>
            <Btn size="sm" variant="secondary" title="Add node" onClick={() => setAddingNode((v) => !v)}>
              <Plus size={13} /><span className="hidden md:inline"> Add node</span>
            </Btn>
            <Btn size="sm" variant="secondary" disabled={deleteGraphPending} title={hasRuns ? 'Archive' : 'Delete'} onClick={onRetire}>
              {hasRuns ? <Archive size={13} /> : <Trash2 size={13} />}
              <span className="hidden md:inline">{deleteGraphPending ? ' Working…' : hasRuns ? ' Archive' : ' Delete'}</span>
            </Btn>
            <Btn size="sm" variant="ghost" onClick={onSyncDraftNow}>Done</Btn>
          </>}
        </div>
      </div>

      {hasValidationErrors && editorMode === 'edit' && (
        <div className="mx-6 mt-3 flex flex-shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <div>
            <p className="text-xs font-semibold text-amber-700">Graph topology issue</p>
            <ul className="mt-0.5 space-y-0.5 text-xs text-amber-600">
              {validationErrors.map((error, i) => <li key={i}>• {error}</li>)}
            </ul>
          </div>
        </div>
      )}

      {addingNode && editorMode === 'edit' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { setAddingNode(false); setNewNodeName('') }}
        >
          <form
            onSubmit={handleAddNode}
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-900">Add node</p>
              <p className="mt-1 text-sm text-gray-500">Create a new workflow step.</p>
            </div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Node name</label>
            <input
              autoFocus
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              placeholder="Node name"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setAddingNode(false); setNewNodeName('') }}
                className="px-3 py-1.5 text-sm text-gray-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-brand-500 px-3 py-1.5 text-sm text-white"
              >
                Add
              </button>
            </div>
          </form>
        </div>
      )}

      {showErrorDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowErrorDialog(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
              <p className="font-semibold text-gray-900 text-sm">Graph topology issues</p>
            </div>
            <ul className="space-y-1 text-sm text-amber-700">
              {validationErrors.map((err, i) => <li key={i}>• {err}</li>)}
            </ul>
            <button className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50" onClick={() => setShowErrorDialog(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
