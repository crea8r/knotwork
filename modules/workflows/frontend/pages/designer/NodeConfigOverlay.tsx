import { X } from 'lucide-react'
import NodeConfigPanel from '@modules/workflows/frontend/components/designer/NodeConfigPanel'
import { useCanvasStore } from '@modules/workflows/frontend/state/canvas'
import type { EdgeDef, GraphDefinition, InputFieldDef, NodeDef } from '@data-models'

export default function NodeConfigOverlay({
  node,
  definition,
  readOnly,
  onClose,
  onInputSchemaChange,
  onConfigChange,
  onRemove,
  onUpdateEdge,
  onRemoveEdge,
}: {
  node: NodeDef
  definition: GraphDefinition
  readOnly: boolean
  onClose: () => void
  onInputSchemaChange: (fields: InputFieldDef[]) => void
  onConfigChange: (nodeId: string, patch: Record<string, unknown>) => void
  onRemove: (nodeId: string) => void
  onUpdateEdge: (edgeId: string, patch: Record<string, unknown>) => void
  onRemoveEdge: (edgeId: string) => void
}) {
  const addEdge = useCanvasStore((s) => s.addEdge)

  const panelProps = {
    node,
    allNodes: definition.nodes,
    edges: definition.edges,
    inputFields: definition.input_schema ?? [],
    readOnly,
    onInputSchemaChange,
    onConfigChange,
    onRemove,
    onAddEdge: (edge: EdgeDef) => addEdge(edge),
    onUpdateEdge,
    onRemoveEdge,
  }

  return (
    <>
      {/* Desktop side panel */}
      <div data-ui="workflow.editor.inspector.desktop" className="hidden md:flex border-l border-gray-200 bg-white" style={{ width: 320, flexShrink: 0, flexDirection: 'column', overflow: 'hidden' }}>
        <div data-ui="workflow.editor.inspector.desktop.content" style={{ flex: 1, overflow: 'hidden' }}>
          <NodeConfigPanel {...panelProps} />
        </div>
      </div>

      {/* Mobile full-screen overlay */}
      <div data-ui="workflow.editor.inspector.mobile" className="md:hidden fixed inset-0 z-50 flex flex-col bg-white">
        <div data-ui="workflow.editor.inspector.mobile.header" className="flex items-center justify-between border-b border-gray-200 px-4 py-3 flex-shrink-0">
          <p data-ui="workflow.editor.inspector.mobile.title" className="text-sm font-semibold text-gray-900">Node config</p>
          <button data-ui="workflow.editor.inspector.mobile.close" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div data-ui="workflow.editor.inspector.mobile.content" className="flex-1 overflow-y-auto overflow-x-hidden">
          <NodeConfigPanel {...panelProps} />
        </div>
      </div>
    </>
  )
}
