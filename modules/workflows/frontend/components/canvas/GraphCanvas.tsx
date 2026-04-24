/**
 * GraphCanvas: SVG canvas with dagre layout, pan, zoom, and auto-fit.
 * - Mouse drag to pan
 * - Scroll wheel to zoom (toward cursor)
 * - Add-node / zoom / fit controls in the bottom-right corner
 * - Auto-fits all nodes on first render and when node count changes
 */
import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Maximize2, SquarePlus, ZoomIn, ZoomOut } from 'lucide-react'
import type { GraphDefinition, NodeDef, NodeStatus } from '@data-models'
import { getNodeAssignmentLabels, type ParticipantLabelMap } from '@modules/workflows/frontend/lib/participantLabels'
import { useCanvasStore } from '@modules/workflows/frontend/state/canvas'
import { computeLayout, NODE_W, PAD, STATUS_COLORS } from './graphCanvasConstants'
import { ASSET_NODE_W, AssetConnector, AssetSatellite, StartEndOval, NodeBox, EdgePath } from './GraphCanvasNodes'

const SELECT_RING = '#2563eb'
const ASSET_PREVIEW_LIMIT = 3

function readNodeKnowledgePaths(node: NodeDef): string[] {
  if (node.type !== 'agent') return []
  const config = node.config ?? {}
  const primary = Array.isArray(config.knowledge_paths) && config.knowledge_paths.length > 0
    ? config.knowledge_paths
    : Array.isArray(config.knowledge_files) ? config.knowledge_files : []
  return [...new Set(primary.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
}

function assetDisplayLabel(path: string): string {
  const trimmed = path.trim()
  const basename = trimmed.split('/').filter(Boolean).pop() ?? trimmed
  return basename || trimmed
}

function computeSatellitePlacements(
  totalItems: number,
  preferredSide: -1 | 1,
  canUseLeft: boolean,
  canUseRight: boolean,
): Array<{ side: -1 | 1; dy: number }> {
  const alternatePatterns: Record<number, Array<{ side: -1 | 1; dy: number }>> = {
    1: [{ side: preferredSide, dy: 0 }],
    2: [{ side: preferredSide, dy: -18 }, { side: (preferredSide * -1) as -1 | 1, dy: 18 }],
    3: [{ side: preferredSide, dy: -28 }, { side: (preferredSide * -1) as -1 | 1, dy: 0 }, { side: preferredSide, dy: 28 }],
    4: [
      { side: preferredSide, dy: -40 },
      { side: (preferredSide * -1) as -1 | 1, dy: -14 },
      { side: preferredSide, dy: 14 },
      { side: (preferredSide * -1) as -1 | 1, dy: 40 },
    ],
  }
  const singleSidePatterns: Record<number, Array<{ side: -1 | 1; dy: number }>> = {
    1: [{ side: preferredSide, dy: 0 }],
    2: [{ side: preferredSide, dy: -18 }, { side: preferredSide, dy: 18 }],
    3: [{ side: preferredSide, dy: -32 }, { side: preferredSide, dy: 0 }, { side: preferredSide, dy: 32 }],
    4: [{ side: preferredSide, dy: -48 }, { side: preferredSide, dy: -16 }, { side: preferredSide, dy: 16 }, { side: preferredSide, dy: 48 }],
  }
  const supportsAlternating = canUseLeft && canUseRight
  const base = supportsAlternating ? alternatePatterns[totalItems] : singleSidePatterns[totalItems]
  return (base ?? singleSidePatterns[4]).map((placement) => {
    let side = placement.side
    if (side === -1 && !canUseLeft && canUseRight) side = 1
    if (side === 1 && !canUseRight && canUseLeft) side = -1
    return { side, dy: placement.dy }
  })
}

interface Props {
  definition: GraphDefinition
  nodeStatuses?: Record<string, NodeStatus>
  participantLabelMap?: ParticipantLabelMap
  selectedNodeId?: string | null
  editable?: boolean
  graphId?: string
  onSelectNode?: (nodeId: string | null) => void
}

function GraphCanvas({
  definition,
  nodeStatuses = {},
  participantLabelMap = {},
  selectedNodeId,
  editable = false,
  graphId,
  onSelectNode,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const [pulseNodeId, setPulseNodeId] = useState<string | null>(null)
  const [addingNode, setAddingNode] = useState(false)
  const [newNodeName, setNewNodeName] = useState('')
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const wasDragging = useRef(false)
  const addNode = useCanvasStore((state) => state.addNode)
  const addEdge = useCanvasStore((state) => state.addEdge)
  const isDirty = useCanvasStore((state) => state.isDirty)
  const storeDefinition = useCanvasStore((state) => state.definition)
  const setGraph = useCanvasStore((state) => state.setGraph)

  const g = useMemo(() => computeLayout(definition), [definition])
  const nodeAssetPaths = useMemo(
    () => new Map(definition.nodes.map((node) => [node.id, readNodeKnowledgePaths(node)])),
    [definition.nodes],
  )
  const { width: gw = 400, height: gh = 300 } = g.graph() as { width?: number; height?: number }
  const selected = selectedNodeId ?? null
  const hasSelection = !!selected
  const selectedNode = selected ? definition.nodes.find((node) => node.id === selected) ?? null : null
  const selectedNodeAssets = selectedNode ? (nodeAssetPaths.get(selectedNode.id) ?? []) : []
  const neighborIds = new Set<string>()
  if (selected) {
    for (const e of definition.edges) {
      if (e.source === selected) neighborIds.add(e.target)
      if (e.target === selected) neighborIds.add(e.source)
    }
  }
  const selectedEdgeIds = new Set(definition.edges.filter(e => e.source === selected || e.target === selected).map(e => e.id))
  const neighborEdgeIds = new Set(
    definition.edges
      .filter(e => neighborIds.has(e.source) || neighborIds.has(e.target))
      .map(e => e.id),
  )
  const outgoingCounts = definition.edges.reduce<Record<string, number>>((acc, edge) => {
    acc[edge.source] = (acc[edge.source] ?? 0) + 1
    return acc
  }, {})
  const visibleSelectedAssets = selectedNode?.type === 'agent'
    ? selectedNodeAssets.slice(0, ASSET_PREVIEW_LIMIT)
    : []
  const remainingSelectedAssetCount = Math.max(0, selectedNodeAssets.length - visibleSelectedAssets.length)
  const satelliteItems = [
    ...visibleSelectedAssets.map((path) => ({ kind: 'asset' as const, path })),
    ...(remainingSelectedAssetCount > 0 ? [{ kind: 'overflow' as const, count: remainingSelectedAssetCount }] : []),
  ]
  const selectedNodePos = selected ? g.node(selected) as { x: number; y: number } | undefined : undefined
  const viewportWidth = svgRef.current?.clientWidth ?? 0
  const requiredSideSpace = NODE_W / 2 + 24 + ASSET_NODE_W
  const nodeScreenX = selectedNodePos ? selectedNodePos.x * zoom + pan.x : 0
  const canUseLeft = nodeScreenX - requiredSideSpace > 12
  const canUseRight = viewportWidth - nodeScreenX - requiredSideSpace > 12
  const preferredSatelliteSide: -1 | 1 = nodeScreenX < viewportWidth / 2 ? 1 : -1
  const assetSatellitePlacements = satelliteItems.length
    ? computeSatellitePlacements(satelliteItems.length, preferredSatelliteSide, canUseLeft, canUseRight)
    : []
  const selectedAssetSatellites = selectedNodePos
    ? satelliteItems.map((item, index) => {
        const placement = assetSatellitePlacements[index] ?? { side: preferredSatelliteSide, dy: 0 }
        const x = selectedNodePos.x + placement.side * (NODE_W / 2 + 24 + ASSET_NODE_W / 2)
        const y = selectedNodePos.y + placement.dy
        const connectorStartY = selectedNodePos.y + Math.max(-18, Math.min(18, placement.dy * 0.35))
        return {
          placement,
          x,
          y,
          startX: selectedNodePos.x + placement.side * (NODE_W / 2 - 2),
          startY: connectorStartY,
          endX: x - placement.side * (ASSET_NODE_W / 2),
          endY: y,
          item,
        }
      })
    : []

  function fitToView() {
    const svg = svgRef.current
    if (!svg) return
    const { clientWidth: cw, clientHeight: ch } = svg
    if (!cw || !ch) return
    const s = Math.min(cw / (gw + PAD * 2), ch / (gh + PAD * 2))
    setZoom(s)
    setPan({ x: (cw - gw * s) / 2, y: (ch - gh * s) / 2 })
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => { fitToView(); setReady(true) })
    return () => cancelAnimationFrame(id)
  }, [definition.nodes.length])

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0) return
    wasDragging.current = false
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.sx
    const dy = e.clientY - dragRef.current.sy
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragging.current = true
    setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy })
  }

  function onMouseUp() { dragRef.current = null }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY > 0 ? 0.85 : 1.18
    const nz = Math.max(0.05, Math.min(8, zoom * factor))
    setPan(p => ({ x: mx - (mx - p.x) * (nz / zoom), y: my - (my - p.y) * (nz / zoom) }))
    setZoom(nz)
  }

  function handleNodeClick(nodeId: string) {
    if (wasDragging.current) return
    const next = selected === nodeId ? null : nodeId
    onSelectNode?.(next)
    if (next) {
      setPulseNodeId(next)
      window.setTimeout(() => setPulseNodeId((p) => (p === next ? null : p)), 180)
    }
  }

  function handleAddNode(event: FormEvent) {
    event.preventDefault()
    if (!editable || !graphId || !newNodeName.trim()) return
    if (!isDirty) setGraph(graphId, definition)
    const id = `agent-${Date.now()}`
    const node: NodeDef = {
      id,
      type: 'agent',
      name: newNodeName.trim(),
      config: {},
      trust_level: 0.5,
    }
    addNode(node)
    const nodes = isDirty ? storeDefinition.nodes : definition.nodes
    if (nodes.length > 0) {
      const prev = nodes[nodes.length - 1]
      addEdge({ id: `e-${prev.id}-${id}`, source: prev.id, target: id, type: 'direct' })
    }
    setNewNodeName('')
    setAddingNode(false)
  }

  if (!definition.nodes.length) {
    return (
      <div data-ui="workflow.editor.canvas.empty" className="flex h-full items-center justify-center text-gray-400 text-sm">
        No nodes yet — use the chat designer to add nodes.
      </div>
    )
  }

  const btnCls = 'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-gray-400 hover:bg-gray-50'

  return (
    <div
      data-ui="workflow.editor.canvas"
      style={{ position: 'relative', width: '100%', height: '100%', opacity: ready ? 1 : 0 }}
    >
      <svg
        data-ui="workflow.editor.canvas.surface"
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block', background: '#f9fafb', borderRadius: 8, cursor: wasDragging.current ? 'grabbing' : 'grab' }}
        onClick={(e) => {
          if (wasDragging.current) return
          if (e.target === e.currentTarget) onSelectNode?.(null)
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#d1d5db" />
          </marker>
          <marker id="arrow-selected" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={SELECT_RING} />
          </marker>
          <marker id="arrow-loop" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#8b5cf6" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {definition.edges.map(edge => {
            const isSelectedEdge = selectedEdgeIds.has(edge.id)
            const isNeighborEdge = neighborEdgeIds.has(edge.id)
            const isDimmed = hasSelection && !isSelectedEdge && !isNeighborEdge
            return (
              <EdgePath key={edge.id} edge={edge} g={g}
                selected={isSelectedEdge} neighbor={isNeighborEdge} dimmed={isDimmed} />
            )
          })}
          {selectedAssetSatellites.map((satellite) => (
            <AssetConnector
              key={`asset-connector-${selected}-${satellite.item.kind === 'asset' ? satellite.item.path : satellite.item.count}`}
              startX={satellite.startX}
              startY={satellite.startY}
              endX={satellite.endX}
              endY={satellite.endY}
              side={satellite.placement.side}
            />
          ))}
          {definition.nodes.map(node => {
            const pos = g.node(node.id)
            if (!pos) return null
            const status = nodeStatuses[node.id]
            const assignmentLabels = getNodeAssignmentLabels(node, participantLabelMap)
            const isSelected = selected === node.id
            const isNeighbor = neighborIds.has(node.id)
            const isDimmed = hasSelection && !isSelected && !isNeighbor
            const isPulse = pulseNodeId === node.id
            const statusColor = status ? STATUS_COLORS[status] : undefined
            if (node.type === 'start' || node.type === 'end') {
              return (
                <StartEndOval key={node.id} node={node} x={pos.x} y={pos.y}
                  selected={isSelected} neighbor={isNeighbor} dimmed={isDimmed} pulse={isPulse}
                  statusColor={statusColor} onClick={() => handleNodeClick(node.id)} />
              )
            }
            return (
              <NodeBox key={node.id} node={node} x={pos.x} y={pos.y}
                operatorLabel={assignmentLabels.operator} supervisorLabel={assignmentLabels.supervisor}
                selected={isSelected} neighbor={isNeighbor} dimmed={isDimmed} pulse={isPulse}
                statusColor={statusColor} branchCount={outgoingCounts[node.id] ?? 0}
                assetCount={nodeAssetPaths.get(node.id)?.length ?? 0}
                onClick={() => handleNodeClick(node.id)} />
            )
          })}
          {selectedAssetSatellites.map((satellite) => (
            satellite.item.kind === 'asset' ? (
              <AssetSatellite
                key={`asset-pill-${selected}-${satellite.item.path}`}
                x={satellite.x}
                y={satellite.y}
                label={assetDisplayLabel(satellite.item.path)}
                subtitle={satellite.item.path}
              />
            ) : (
              <AssetSatellite
                key={`asset-overflow-${selected}`}
                x={satellite.x}
                y={satellite.y}
                label={`+${satellite.item.count} more`}
                subtitle={`${satellite.item.count} more attached assets`}
                tone="overflow"
              />
            )
          ))}
        </g>
      </svg>
      <div
        data-ui="workflow.editor.canvas.controls"
        style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        {editable && graphId ? (
          <button
            data-ui="workflow.editor.canvas.add-node"
            className={`${btnCls} border-brand-200 text-brand-600 hover:border-brand-300 hover:bg-brand-50`}
            onClick={() => setAddingNode(true)}
            title="Add node"
          >
            <SquarePlus size={15} />
          </button>
        ) : null}
        <button data-ui="workflow.editor.canvas.zoom-in" className={btnCls} onClick={() => setZoom(z => Math.min(8, z * 1.25))} title="Zoom in"><ZoomIn size={14} /></button>
        <button data-ui="workflow.editor.canvas.zoom-out" className={btnCls} onClick={() => setZoom(z => Math.max(0.05, z * 0.8))} title="Zoom out"><ZoomOut size={14} /></button>
        <button data-ui="workflow.editor.canvas.fit" className={btnCls} onClick={fitToView} title="Fit to view"><Maximize2 size={14} /></button>
      </div>

      {addingNode && editable ? (
        <div
          data-ui="workflow.editor.dialog.add-node"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => {
            setAddingNode(false)
            setNewNodeName('')
          }}
        >
          <form
            data-ui="workflow.editor.dialog.add-node.panel"
            onSubmit={handleAddNode}
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4">
              <p data-ui="workflow.editor.dialog.add-node.title" className="text-sm font-semibold text-gray-900">Add node</p>
              <p className="mt-1 text-sm text-gray-500">Create a new workflow step.</p>
            </div>
            <label data-ui="workflow.editor.dialog.add-node.label" className="mb-1 block text-xs font-medium text-gray-600">Node name</label>
            <input
              data-ui="workflow.editor.dialog.add-node.input"
              autoFocus
              value={newNodeName}
              onChange={(event) => setNewNodeName(event.target.value)}
              placeholder="Node name"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div data-ui="workflow.editor.dialog.add-node.actions" className="mt-4 flex items-center justify-end gap-2">
              <button
                data-ui="workflow.editor.dialog.add-node.cancel"
                type="button"
                onClick={() => {
                  setAddingNode(false)
                  setNewNodeName('')
                }}
                className="px-3 py-1.5 text-sm text-gray-500"
              >
                Cancel
              </button>
              <button
                data-ui="workflow.editor.dialog.add-node.submit"
                type="submit"
                className="rounded bg-brand-500 px-3 py-1.5 text-sm text-white"
              >
                Add
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default memo(GraphCanvas)
