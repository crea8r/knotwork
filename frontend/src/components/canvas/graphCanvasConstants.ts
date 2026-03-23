import dagre from '@dagrejs/dagre'
import type { GraphDefinition } from '@/types'

export const NODE_W = 168
export const NODE_H = 56
export const PAD = 32

export const NODE_COLORS: Record<string, string> = {
  llm_agent: '#3b82f6',
  human_checkpoint: '#f59e0b',
  conditional_router: '#8b5cf6',
  tool_executor: '#10b981',
  start: '#22c55e',
  end: '#6b7280',
}

export const STATUS_COLORS: Record<string, string> = {
  pending: '#9ca3af',
  running: '#3b82f6',
  paused: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  skipped: '#6b7280',
}

export const SELECT_RING = '#2563eb'
export const SELECT_GLOW = 'rgba(37, 99, 235, 0.32)'

export function computeLayout(definition: GraphDefinition): dagre.graphlib.Graph {
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
