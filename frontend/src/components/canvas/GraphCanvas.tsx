/**
 * GraphCanvas: read-only SVG canvas using dagre for automatic layout.
 * Supports click-to-select nodes and run status overlay.
 */
import dagre from '@dagrejs/dagre'
import type { EdgeDef, GraphDefinition, NodeDef, NodeStatus } from '@/types'

const NODE_W = 168
const NODE_H = 56

const NODE_COLORS: Record<string, string> = {
  llm_agent: '#3b82f6',
  human_checkpoint: '#f59e0b',
  conditional_router: '#8b5cf6',
  tool_executor: '#10b981',
}

const STATUS_COLORS: Record<NodeStatus, string> = {
  pending: '#9ca3af',
  running: '#3b82f6',
  paused: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  skipped: '#6b7280',
}

function computeLayout(definition: GraphDefinition) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 64, marginx: 24, marginy: 24 })

  for (const node of definition.nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H })
  }
  for (const edge of definition.edges) {
    g.setEdge(edge.source, edge.target)
  }
  dagre.layout(g)
  return g
}

function NodeBox({
  node,
  x,
  y,
  selected,
  statusColor,
  onClick,
}: {
  node: NodeDef
  x: number
  y: number
  selected: boolean
  statusColor?: string
  onClick: () => void
}) {
  const fill = statusColor ?? NODE_COLORS[node.type] ?? '#6b7280'
  return (
    <g
      transform={`translate(${x - NODE_W / 2},${y - NODE_H / 2})`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={fill}
        fillOpacity={0.15}
        stroke={selected ? '#1d4ed8' : fill}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      <rect width={4} height={NODE_H} rx={2} fill={fill} />
      <text x={16} y={22} fontSize={11} fill="#6b7280" fontFamily="sans-serif">
        {node.type.replace('_', ' ')}
      </text>
      <text
        x={16}
        y={38}
        fontSize={13}
        fontWeight="600"
        fill="#1f2937"
        fontFamily="sans-serif"
      >
        {node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name}
      </text>
    </g>
  )
}

function EdgePath({ edge, g }: { edge: EdgeDef; g: dagre.graphlib.Graph }) {
  const edgeData = g.edge({ v: edge.source, w: edge.target })
  if (!edgeData?.points?.length) return null
  const pts = edgeData.points as Array<{ x: number; y: number }>
  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ')
  return (
    <path
      d={d}
      fill="none"
      stroke="#d1d5db"
      strokeWidth={1.5}
      markerEnd="url(#arrow)"
    />
  )
}

interface Props {
  definition: GraphDefinition
  nodeStatuses?: Record<string, NodeStatus>
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string | null) => void
}

export default function GraphCanvas({
  definition,
  nodeStatuses = {},
  selectedNodeId,
  onSelectNode,
}: Props) {
  if (!definition.nodes.length) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-sm">
        No nodes yet — use the chat designer to add nodes.
      </div>
    )
  }

  const g = computeLayout(definition)
  const { width = 400, height = 300 } = g.graph() as { width?: number; height?: number }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ background: '#f9fafb', borderRadius: 8 }}
    >
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#d1d5db" />
        </marker>
      </defs>
      {definition.edges.map((edge) => (
        <EdgePath key={edge.id} edge={edge} g={g} />
      ))}
      {definition.nodes.map((node) => {
        const { x, y } = g.node(node.id)
        const status = nodeStatuses[node.id]
        return (
          <NodeBox
            key={node.id}
            node={node}
            x={x}
            y={y}
            selected={selectedNodeId === node.id}
            statusColor={status ? STATUS_COLORS[status] : undefined}
            onClick={() => onSelectNode?.(selectedNodeId === node.id ? null : node.id)}
          />
        )
      })}
    </svg>
  )
}
