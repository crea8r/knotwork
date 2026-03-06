/**
 * Frontend graph topology validation — mirrors backend runtime/validation.py.
 * All graphs with work nodes must have Start and End nodes wired up.
 */
import type { GraphDefinition } from '@/types'
import { VALID_MODEL_VALUES } from '@/utils/models'

export function validateGraph(definition: GraphDefinition): string[] {
  const { nodes, edges } = definition
  if (!nodes.length) return []

  const nodeIds = new Set(nodes.map(n => n.id))
  const startIds = new Set(nodes.filter(n => n.type === 'start').map(n => n.id))
  const endIds = new Set(nodes.filter(n => n.type === 'end').map(n => n.id))

  const workIds = [...nodeIds].filter(id => !startIds.has(id) && !endIds.has(id))
  if (!workIds.length) return []  // Only start/end with no work nodes — valid

  // All graphs with work nodes require Start and End
  if (startIds.size === 0) return ['Add a Start node and connect it to begin the workflow']
  if (endIds.size === 0) return ['Add an End node and connect your last node to it']

  // Build adjacency maps
  const fwd: Record<string, Set<string>> = {}
  const bwd: Record<string, Set<string>> = {}
  for (const id of nodeIds) { fwd[id] = new Set(); bwd[id] = new Set() }
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      fwd[e.source].add(e.target)
      bwd[e.target].add(e.source)
    }
  }

  function bfs(startSet: Set<string>, adj: Record<string, Set<string>>): Set<string> {
    const visited = new Set<string>()
    const queue = [...startSet]
    while (queue.length) {
      const cur = queue.pop()!
      if (visited.has(cur)) continue
      visited.add(cur)
      for (const next of adj[cur] ?? []) queue.push(next)
    }
    return visited
  }

  const reachableFromStart = bfs(startIds, fwd)
  const canReachEnd = bfs(endIds, bwd)

  const errors: string[] = []
  for (const nid of workIds) {
    const node = nodes.find(n => n.id === nid)
    const label = node?.name ?? nid
    if (!reachableFromStart.has(nid)) {
      errors.push(`Node "${label}" is not reachable from Start`)
    } else if (!canReachEnd.has(nid)) {
      errors.push(`Node "${label}" has no path to End`)
    }
    // tool_executor is removed in S7
    if (node?.type === 'tool_executor') {
      errors.push(`Node "${label}" uses the removed 'tool_executor' type — replace it with an agent node`)
    }
    // Model validation for legacy llm_agent nodes
    if (node?.type === 'llm_agent') {
      const model = node.config?.model as string | undefined
      if (model && !VALID_MODEL_VALUES.has(model)) {
        errors.push(`Node "${label}": unknown model "${model}"`)
      }
    }
  }
  return errors
}
