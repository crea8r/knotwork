import dagre from '@dagrejs/dagre'
import type { EdgeDef, NodeDef } from '@/types'
import {
  NODE_W, NODE_H, NODE_COLORS, SELECT_RING, SELECT_GLOW,
} from './graphCanvasConstants'

export function StartEndOval({
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
  const isStart = node.type === 'start'
  const fill = statusColor ?? NODE_COLORS[node.type]
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

export function NodeBox({
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

export function EdgePath({
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

  // Fallback for back-edges (loops): draw a curved Bezier path hugging the left side.
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
