/**
 * Canvas store: graph definition + canvas UI state.
 * `definition` is the source of truth for the graph being edited.
 * Node positions are NOT stored here — dagre computes them from the definition at render time.
 * Persisted to the API on save.
 */
import { create } from 'zustand'
import type { GraphDefinition, NodeDef, EdgeDef } from '@/types'

interface CanvasState {
  graphId: string | null
  definition: GraphDefinition
  selectedNodeId: string | null
  isDirty: boolean

  setGraph: (graphId: string, definition: GraphDefinition) => void
  applyDelta: (delta: { nodes?: Array<{ op: string; node: NodeDef }>; edges?: Array<{ op: string; edge: EdgeDef }> }) => void
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

  applyDelta: (_delta) =>
    set((state) => {
      // TODO: implement delta application (add/remove/update nodes and edges)
      return { ...state, isDirty: true }
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
