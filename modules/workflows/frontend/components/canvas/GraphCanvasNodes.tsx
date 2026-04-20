import dagre from '@dagrejs/dagre'
import type { EdgeDef, NodeDef } from '@data-models'
import {
  NODE_W, NODE_H, NODE_COLORS, SELECT_RING, SELECT_GLOW,
} from './graphCanvasConstants'

function truncateLabel(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

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
  const fill = statusColor ?? (isStart ? NODE_COLORS.start : NODE_COLORS.end)
  const rx = NODE_W / 2
  const ry = NODE_H / 2
  const label = isStart
    ? 'Start'
    : truncateLabel(node.name?.trim() && node.name.trim().toLowerCase() !== 'end' ? node.name : 'Final result', 18)
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
      {!isStart && (
        <text
          x={0}
          y={-7}
          fontSize={9}
          fontWeight="700"
          fill={fill}
          fontFamily="sans-serif"
          textAnchor="middle"
          style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          Workflow result
        </text>
      )}
      <text x={0} y={isStart ? 5 : 12} fontSize={13} fontWeight="600" fill={fill}
        fontFamily="sans-serif" textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

export function NodeBox({
  node, x, y, operatorLabel, supervisorLabel, selected, neighbor, dimmed, pulse, statusColor, branchCount = 0, onClick,
}: {
  node: NodeDef
  x: number
  y: number
  operatorLabel: string
  supervisorLabel: string
  selected: boolean
  neighbor: boolean
  dimmed: boolean
  pulse: boolean
  statusColor?: string
  branchCount?: number
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
  const nodeName = truncateLabel(node.name, 20)
  const operatorText = `Operator · ${truncateLabel(operatorLabel, 15)}`
  const supervisorText = `Supervisor · ${truncateLabel(supervisorLabel, 13)}`

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
      <text x={16} y={24} fontSize={13} fontWeight="600" fill="#1f2937" fontFamily="sans-serif">
        {nodeName}
      </text>
      <text x={16} y={48} fontSize={10} fill="#4b5563" fontFamily="sans-serif">
        {operatorText}
      </text>
      <text x={16} y={64} fontSize={10} fill="#6b7280" fontFamily="sans-serif">
        {supervisorText}
      </text>
      {branchCount > 1 && (
        <g transform={`translate(${NODE_W - 56},10)`}>
          <rect
            width={46}
            height={18}
            rx={9}
            fill="#eef2ff"
            stroke="#c7d2fe"
          />
          <text
            x={23}
            y={12.5}
            fontSize={10}
            fontWeight="600"
            fill="#4338ca"
            fontFamily="sans-serif"
            textAnchor="middle"
          >
            {branchCount} paths
          </text>
        </g>
      )}
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
  const branchLabel = (edge.condition_label ?? '').trim()

  function renderLabel(x: number, y: number) {
    if (!branchLabel) return null
    const label = branchLabel.length > 26 ? `${branchLabel.slice(0, 24)}…` : branchLabel
    const width = Math.max(54, Math.min(170, label.length * 6.2 + 16))
    return (
      <g transform={`translate(${x - width / 2},${y - 12})`} style={{ pointerEvents: 'none', opacity }}>
        <rect width={width} height={20} rx={10} fill="#ffffff" stroke={selected ? '#93c5fd' : '#dbeafe'} />
        <text
          x={width / 2}
          y={13}
          fontSize={10}
          fontWeight="600"
          fill={selected ? '#1d4ed8' : '#475569'}
          fontFamily="sans-serif"
          textAnchor="middle"
        >
          {label}
        </text>
      </g>
    )
  }

  // Try dagre's routed points first (works reliably for forward edges)
  const edgeData = g.edge({ v: edge.source, w: edge.target, name: edge.id })
  if (edgeData?.points?.length) {
    const pts = edgeData.points as Array<{ x: number; y: number }>
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    const mid = pts[Math.floor(pts.length / 2)]
    return (
      <g>
        <path d={d} fill="none" stroke={stroke} opacity={opacity} strokeWidth={strokeWidth} markerEnd={selected ? 'url(#arrow-selected)' : 'url(#arrow)'} />
        {mid ? renderLabel(mid.x, mid.y) : null}
      </g>
    )
  }

  // Fallback for back-edges (loops): draw a curved Bezier path hugging the left side.
  const sx = srcNode.x - NODE_W / 2
  const sy = srcNode.y
  const tx = tgtNode.x - NODE_W / 2
  const ty = tgtNode.y
  const cx = Math.min(sx, tx) - 72
  const d = `M ${sx},${sy} C ${cx},${sy} ${cx},${ty} ${tx},${ty}`
  return (
    <g>
      <path d={d} fill="none" stroke={selected ? SELECT_RING : '#8b5cf6'} opacity={opacity} strokeWidth={selected ? 2.75 : 1.5}
        strokeDasharray="6,3" markerEnd={selected ? 'url(#arrow-selected)' : 'url(#arrow-loop)'} />
      {renderLabel(cx, (sy + ty) / 2)}
    </g>
  )
}
