/**
 * GraphCanvas: SVG canvas with dagre layout, pan, zoom, and auto-fit.
 * - Mouse drag to pan
 * - Scroll wheel to zoom (toward cursor)
 * - +/−/⊞ buttons in the bottom-right corner
 * - Auto-fits all nodes on first render and when node count changes
 */
import dagre from '@dagrejs/dagre'
import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { EdgeDef, GraphDefinition, NodeDef, NodeStatus } from '@/types'

const NODE_W = 168
const NODE_H = 56
const PAD = 32

const NODE_COLORS: Record<string, string> = {
  llm_agent: '#3b82f6',
  human_checkpoint: '#f59e0b',
  conditional_router: '#8b5cf6',
  tool_executor: '#10b981',
  start: '#22c55e',
  end: '#6b7280',
}

const STATUS_COLORS: Record<NodeStatus, string> = {
  pending: '#9ca3af',
  running: '#3b82f6',
  paused: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  skipped: '#6b7280',
}

const SELECT_RING = '#2563eb'
const SELECT_GLOW = 'rgba(37, 99, 235, 0.32)'

function computeLayout(definition: GraphDefinition) {
  // multigraph=true allows multiple edges between the same pair of nodes (e.g. two branches)
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 64, marginx: PAD, marginy: PAD })
  for (const node of definition.nodes) g.setNode(node.id, { width: NODE_W, height: NODE_H })
  // Use edge.id as the name so multigraph can distinguish parallel + back-edges
  for (const edge of definition.edges) g.setEdge(edge.source, edge.target, {}, edge.id)
  dagre.layout(g)
  return g
}

function StartEndOval({
  node, x, y, selected, neighbor, dimmed, pulse, onClick,
}: {
  node: NodeDef
  x: number
  y: number
  selected: boolean
  neighbor: boolean
  dimmed: boolean
  pulse: boolean
  onClick: () => void
}) {
  const isStart = node.type === 'start'
  const fill = NODE_COLORS[node.type]
  const rx = NODE_W / 2
  const ry = NODE_H / 2
  const label = isStart ? '▶ Start' : '■ End'
  const scale = selected ? (pulse ? 1.07 : 1.04) : (neighbor ? 1.01 : 1)
  const opacity = dimmed ? 0.58 : 1

  return (
    <g
      transform={`translate(${x},${y}) scale(${scale})`}
      style={{ cursor: 'pointer', opacity, transition: 'opacity 160ms ease' }}
      onClick={onClick}
    >
      {selected && (
        <ellipse
          cx={0}
          cy={0}
          rx={rx + 10}
          ry={ry + 10}
          fill="none"
          stroke={SELECT_GLOW}
          strokeWidth={10}
        />
      )}
      <ellipse cx={0} cy={0} rx={rx} ry={ry}
        fill={fill} fillOpacity={0.18}
        stroke={selected ? SELECT_RING : fill} strokeWidth={selected ? 4 : 2} />
      <text x={0} y={5} fontSize={13} fontWeight="600" fill={fill}
        fontFamily="sans-serif" textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

function NodeBox({
  node, x, y, selected, neighbor, dimmed, pulse, statusColor, onClick,
}: {
  node: NodeDef
  x: number
  y: number
  selected: boolean
  neighbor: boolean
  dimmed: boolean
  pulse: boolean
  statusColor?: string
  onClick: () => void
}) {
  const fill = statusColor ?? NODE_COLORS[node.type] ?? '#6b7280'
  const scale = selected ? (pulse ? 1.07 : 1.04) : (neighbor ? 1.01 : 1)
  const opacity = dimmed ? 0.58 : 1
  const shadow = selected
    ? 'drop-shadow(0px 8px 18px rgba(37,99,235,0.28))'
    : neighbor
      ? 'drop-shadow(0px 4px 8px rgba(0,0,0,0.12))'
      : 'none'

  return (
    <g
      transform={`translate(${x - NODE_W / 2},${y - NODE_H / 2}) scale(${scale})`}
      onClick={onClick}
      style={{
        cursor: 'pointer',
        opacity,
        filter: shadow,
        transformOrigin: `${NODE_W / 2}px ${NODE_H / 2}px`,
        transition: 'opacity 160ms ease, filter 160ms ease',
      }}
    >
      {selected && (
        <rect
          x={-8}
          y={-8}
          width={NODE_W + 16}
          height={NODE_H + 16}
          rx={14}
          fill="none"
          stroke={SELECT_GLOW}
          strokeWidth={10}
        />
      )}
      <rect width={NODE_W} height={NODE_H} rx={8} fill={fill} fillOpacity={0.15}
        stroke={selected ? SELECT_RING : fill} strokeWidth={selected ? 4 : 1.5} />
      <rect width={4} height={NODE_H} rx={2} fill={fill} />
      <text x={16} y={22} fontSize={11} fill="#6b7280" fontFamily="sans-serif">
        {node.type.replace(/_/g, ' ')}
      </text>
      <text x={16} y={38} fontSize={13} fontWeight="600" fill="#1f2937" fontFamily="sans-serif">
        {node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name}
      </text>
    </g>
  )
}

function EdgePath({
  edge, g, selected, neighbor, dimmed,
}: {
  edge: EdgeDef
  g: dagre.graphlib.Graph
  selected: boolean
  neighbor: boolean
  dimmed: boolean
}) {
  const srcNode = g.node(edge.source)
  const tgtNode = g.node(edge.target)
  if (!srcNode || !tgtNode) return null

  const stroke = selected ? SELECT_RING : (neighbor ? '#64748b' : '#d1d5db')
  const strokeWidth = selected ? 2.75 : (neighbor ? 2.1 : 1.5)
  const opacity = dimmed ? 0.35 : 1

  // Try dagre's routed points first (works reliably for forward edges)
  const edgeData = g.edge({ v: edge.source, w: edge.target, name: edge.id })
  if (edgeData?.points?.length) {
    const pts = edgeData.points as Array<{ x: number; y: number }>
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    return <path d={d} fill="none" stroke={stroke} opacity={opacity} strokeWidth={strokeWidth} markerEnd={selected ? 'url(#arrow-selected)' : 'url(#arrow)'} />
  }

  // Fallback for back-edges (loops): dagre may not expose points for reversed edges.
  // Draw a curved Bezier path hugging the left side, colored purple with a dash to signal a loop.
  const sx = srcNode.x - NODE_W / 2
  const sy = srcNode.y
  const tx = tgtNode.x - NODE_W / 2
  const ty = tgtNode.y
  const cx = Math.min(sx, tx) - 72
  const d = `M ${sx},${sy} C ${cx},${sy} ${cx},${ty} ${tx},${ty}`
  return (
    <path d={d} fill="none" stroke={selected ? SELECT_RING : '#8b5cf6'} opacity={opacity} strokeWidth={selected ? 2.75 : 1.5}
      strokeDasharray="6,3" markerEnd={selected ? 'url(#arrow-selected)' : 'url(#arrow-loop)'} />
  )
}

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

  function fitToView() {
    const svg = svgRef.current
    if (!svg) return
    const { clientWidth: cw, clientHeight: ch } = svg
    if (!cw || !ch) return
    const s = Math.min(cw / (gw + PAD * 2), ch / (gh + PAD * 2))
    setZoom(s)
    setPan({ x: (cw - gw * s) / 2, y: (ch - gh * s) / 2 })
  }

  // Auto-fit whenever node count changes (including initial mount)
  useEffect(() => {
    const id = requestAnimationFrame(fitToView)
    return () => cancelAnimationFrame(id)
  }, [definition.nodes.length]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!definition.nodes.length) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-sm">
        No nodes yet — use the chat designer to add nodes.
      </div>
    )
  }

  const btnCls = 'w-8 h-8 flex items-center justify-center bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block', background: '#f9fafb', borderRadius: 8, cursor: wasDragging.current ? 'grabbing' : 'grab' }}
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
              <EdgePath
                key={edge.id}
                edge={edge}
                g={g}
                selected={isSelectedEdge}
                neighbor={isNeighborEdge}
                dimmed={isDimmed}
              />
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
            if (node.type === 'start' || node.type === 'end') {
              return (
                <StartEndOval
                  key={node.id}
                  node={node}
                  x={pos.x}
                  y={pos.y}
                  selected={isSelected}
                  neighbor={isNeighbor}
                  dimmed={isDimmed}
                  pulse={isPulse}
                  onClick={() => {
                    if (!wasDragging.current) {
                      const next = selected === node.id ? null : node.id
                      onSelectNode?.(next)
                      if (next) {
                        setPulseNodeId(next)
                        window.setTimeout(() => setPulseNodeId((p) => (p === next ? null : p)), 180)
                      }
                    }
                  }}
                />
              )
            }
            return (
              <NodeBox
                key={node.id}
                node={node}
                x={pos.x}
                y={pos.y}
                selected={isSelected}
                neighbor={isNeighbor}
                dimmed={isDimmed}
                pulse={isPulse}
                statusColor={status ? STATUS_COLORS[status] : undefined}
                onClick={() => {
                  if (!wasDragging.current) {
                    const next = selected === node.id ? null : node.id
                    onSelectNode?.(next)
                    if (next) {
                      setPulseNodeId(next)
                      window.setTimeout(() => setPulseNodeId((p) => (p === next ? null : p)), 180)
                    }
                  }
                }}
              />
            )
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className={btnCls} onClick={() => setZoom(z => Math.min(8, z * 1.25))} title="Zoom in"><Plus size={14} /></button>
        <button className={btnCls} onClick={() => setZoom(z => Math.max(0.05, z * 0.8))} title="Zoom out"><Minus size={14} /></button>
        <button className={btnCls} onClick={fitToView} title="Fit to view"><Maximize2 size={14} /></button>
      </div>
    </div>
  )
}
