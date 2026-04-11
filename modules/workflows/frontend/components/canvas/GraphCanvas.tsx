/**
 * GraphCanvas: SVG canvas with dagre layout, pan, zoom, and auto-fit.
 * - Mouse drag to pan
 * - Scroll wheel to zoom (toward cursor)
 * - +/−/⊞ buttons in the bottom-right corner
 * - Auto-fits all nodes on first render and when node count changes
 */
import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { GraphDefinition, NodeStatus } from '@data-models'
import { computeLayout, PAD, STATUS_COLORS } from './graphCanvasConstants'
import { StartEndOval, NodeBox, EdgePath } from './GraphCanvasNodes'

const SELECT_RING = '#2563eb'

interface Props {
  definition: GraphDefinition
  nodeStatuses?: Record<string, NodeStatus>
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string | null) => void
}

export default function GraphCanvas({ definition, nodeStatuses = {}, selectedNodeId, onSelectNode }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const [pulseNodeId, setPulseNodeId] = useState<string | null>(null)
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const wasDragging = useRef(false)

  const g = computeLayout(definition)
  const { width: gw = 400, height: gh = 300 } = g.graph() as { width?: number; height?: number }
  const selected = selectedNodeId ?? null
  const hasSelection = !!selected
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

  if (!definition.nodes.length) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-sm">
        No nodes yet — use the chat designer to add nodes.
      </div>
    )
  }

  const btnCls = 'w-8 h-8 flex items-center justify-center bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', opacity: ready ? 1 : 0 }}>
      <svg
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
          {definition.nodes.map(node => {
            const pos = g.node(node.id)
            if (!pos) return null
            const status = nodeStatuses[node.id]
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
                selected={isSelected} neighbor={isNeighbor} dimmed={isDimmed} pulse={isPulse}
                statusColor={statusColor} branchCount={outgoingCounts[node.id] ?? 0} onClick={() => handleNodeClick(node.id)} />
            )
          })}
        </g>
      </svg>
      <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className={btnCls} onClick={() => setZoom(z => Math.min(8, z * 1.25))} title="Zoom in"><Plus size={14} /></button>
        <button className={btnCls} onClick={() => setZoom(z => Math.max(0.05, z * 0.8))} title="Zoom out"><Minus size={14} /></button>
        <button className={btnCls} onClick={fitToView} title="Fit to view"><Maximize2 size={14} /></button>
      </div>
    </div>
  )
}
