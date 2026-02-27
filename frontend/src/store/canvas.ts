/**
 * Canvas store: graph definition + canvas UI state.
 * `definition` is the source of truth for the graph being edited.
 * Node positions are NOT stored here — dagre computes them from the definition at render time.
 * Persisted to the API on save.
 */
import { create } from 'zustand'
import type { GraphDefinition, NodeDef, EdgeDef } from '@/types'

export interface GraphDelta {
  add_nodes?: NodeDef[]
  update_nodes?: Array<{ id: string; name?: string; config?: Record<string, unknown> }>
  remove_nodes?: string[]
  add_edges?: EdgeDef[]
  remove_edges?: string[]
  set_entry_point?: string
}

interface CanvasState {
  graphId: string | null
  definition: GraphDefinition
  selectedNodeId: string | null
  isDirty: boolean

  setGraph: (graphId: string, definition: GraphDefinition) => void
  applyDelta: (delta: GraphDelta) => void
  selectNode: (nodeId: string | null) => void
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
  addNode: (node: NodeDef) => void
  removeNode: (nodeId: string) => void
  addEdge: (edge: EdgeDef) => void
  removeEdge: (edgeId: string) => void
  markSaved: () => void
}

const emptyDefinition: GraphDefinition = { nodes: [], edges: [] }

export const useCanvasStore = create<CanvasState>((set) => ({
  graphId: null,
  definition: emptyDefinition,
  selectedNodeId: null,
  isDirty: false,

  setGraph: (graphId, definition) =>
    set({ graphId, definition, selectedNodeId: null, isDirty: false }),

  applyDelta: (delta) =>
    set((state) => {
      let { nodes, edges } = state.definition
      let entry_point = state.definition.entry_point

      if (delta.add_nodes?.length) {
        nodes = [...nodes, ...delta.add_nodes]
      }
      if (delta.update_nodes?.length) {
        nodes = nodes.map(n => {
          const u = delta.update_nodes!.find(x => x.id === n.id)
          if (!u) return n
          return { ...n, ...(u.name ? { name: u.name } : {}), config: { ...n.config, ...u.config } }
        })
      }
      if (delta.remove_nodes?.length) {
        const removed = new Set(delta.remove_nodes)
        nodes = nodes.filter(n => !removed.has(n.id))
        edges = edges.filter(e => !removed.has(e.source) && !removed.has(e.target))
      }
      if (delta.add_edges?.length) {
        edges = [...edges, ...delta.add_edges]
      }
      if (delta.remove_edges?.length) {
        const removedEdges = new Set(delta.remove_edges)
        edges = edges.filter(e => !removedEdges.has(e.id))
      }
      if (delta.set_entry_point) {
        entry_point = delta.set_entry_point
      }
      return { definition: { nodes, edges, entry_point }, isDirty: true }
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  updateNodeConfig: (nodeId, config) =>
    set((state) => ({
      definition: {
        ...state.definition,
        nodes: state.definition.nodes.map((n) =>
          n.id === nodeId ? { ...n, config: { ...n.config, ...config } } : n
        ),
      },
      isDirty: true,
    })),

  addNode: (node) =>
    set((state) => ({
      definition: { ...state.definition, nodes: [...state.definition.nodes, node] },
      isDirty: true,
    })),

  removeNode: (nodeId) =>
    set((state) => ({
      definition: {
        nodes: state.definition.nodes.filter((n) => n.id !== nodeId),
        edges: state.definition.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        ),
      },
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      isDirty: true,
    })),

  addEdge: (edge) =>
    set((state) => ({
      definition: { ...state.definition, edges: [...state.definition.edges, edge] },
      isDirty: true,
    })),

  removeEdge: (edgeId) =>
    set((state) => ({
      definition: {
        ...state.definition,
        edges: state.definition.edges.filter((e) => e.id !== edgeId),
      },
      isDirty: true,
    })),

  markSaved: () => set({ isDirty: false }),
}))
