import { useMemo } from 'react'
import type { RunNodeState, NodeStatus, GraphDefinition } from '@data-models'

const TERMINAL_RUN = new Set(['completed', 'failed', 'stopped'])
const ACTIVE_NODE = new Set(['running', 'paused'])

function endNodeStatusForRun(runStatus: string): NodeStatus {
  switch (runStatus) {
    case 'running':
      return 'running'
    case 'paused':
      return 'paused'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'stopped':
      return 'skipped'
    default:
      return 'pending'
  }
}

/**
 * Synthesizes a NodeStatus for every non-start/end node in the graph definition.
 * - Sorts nodeStates by started_at ASC; uses the last entry per node_id as most recent
 * - Initializes all non-start/end nodes to 'pending'
 * - End node is 'completed' when runStatus === 'completed'
 * - For completed nodes in an active run, checks if the node is reachable (BFS forward)
 *   from any currently running/paused node AND started before that active node
 *   → if so, overrides back to 'pending' (will run again)
 */
export function useRunNodeStatuses(
  nodeStates: RunNodeState[],
  definition: GraphDefinition,
  runStatus: string,
): Record<string, NodeStatus> {
  return useMemo(() => {
    const result: Record<string, NodeStatus> = {}

    // Initialize all non-start/end nodes to pending
    for (const node of definition.nodes) {
      if (node.type === 'start' || node.type === 'end') continue
      result[node.id] = 'pending'
    }

    // Synthesize end node from overall run status so the terminal node reflects
    // whether the workflow is still in progress or actually finished.
    for (const node of definition.nodes) {
      if (node.type === 'end') {
        result[node.id] = endNodeStatusForRun(runStatus)
      }
    }

    // Sort node states by started_at ASC
    const sorted = [...nodeStates].sort((a, b) => {
      const ta = a.started_at ? new Date(a.started_at).getTime() : 0
      const tb = b.started_at ? new Date(b.started_at).getTime() : 0
      return ta - tb
    })

    // Last entry per node_id = most recent
    const latestByNodeId = new Map<string, RunNodeState>()
    for (const ns of sorted) {
      latestByNodeId.set(ns.node_id, ns)
    }

    // Build adjacency list for BFS (forward reachability)
    const adjacency = new Map<string, string[]>()
    for (const edge of definition.edges) {
      const targets = adjacency.get(edge.source) ?? []
      targets.push(edge.target)
      adjacency.set(edge.source, targets)
    }

    // Collect currently active node states (running or paused) with their start times
    const activeNodeStates: Array<{ nodeId: string; startedAt: number }> = []
    for (const [nodeId, ns] of latestByNodeId.entries()) {
      if (ACTIVE_NODE.has(ns.status)) {
        activeNodeStates.push({
          nodeId,
          startedAt: ns.started_at ? new Date(ns.started_at).getTime() : 0,
        })
      }
    }

    // BFS forward reachability from a given node
    function reachableFrom(startNodeId: string): Set<string> {
      const visited = new Set<string>()
      const queue = [startNodeId]
      while (queue.length > 0) {
        const cur = queue.shift()!
        if (visited.has(cur)) continue
        visited.add(cur)
        for (const next of adjacency.get(cur) ?? []) {
          queue.push(next)
        }
      }
      return visited
    }

    // Apply statuses from latest node states
    for (const [nodeId, ns] of latestByNodeId.entries()) {
      const status = ns.status

      if (status === 'running' || status === 'paused' || status === 'failed') {
        result[nodeId] = status
        continue
      }

      if (status === 'completed') {
        if (TERMINAL_RUN.has(runStatus)) {
          result[nodeId] = 'completed'
          continue
        }
        // Active run: check if reachable from any running/paused node that started later
        const nsStartedAt = ns.started_at ? new Date(ns.started_at).getTime() : 0
        let willRunAgain = false
        for (const active of activeNodeStates) {
          if (active.startedAt >= nsStartedAt) {
            const reachable = reachableFrom(active.nodeId)
            if (reachable.has(nodeId)) {
              willRunAgain = true
              break
            }
          }
        }
        result[nodeId] = willRunAgain ? 'pending' : 'completed'
        continue
      }

      result[nodeId] = status as NodeStatus
    }

    return result
  }, [nodeStates, definition, runStatus])
}
