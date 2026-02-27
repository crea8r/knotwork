/**
 * Run store: active run state + WebSocket connection.
 * One WebSocket per active run. Receives node status events in real time.
 */
import { create } from 'zustand'
import type { Run, RunNodeState, Escalation } from '@/types'

interface RunStore {
  activeRun: Run | null
  nodeStates: Record<string, RunNodeState>   // keyed by node_id
  pendingEscalation: Escalation | null
  wsConnected: boolean

  setRun: (run: Run) => void
  updateNodeState: (nodeState: RunNodeState) => void
  setPendingEscalation: (escalation: Escalation | null) => void
  setWsConnected: (connected: boolean) => void
  clearRun: () => void
}

export const useRunStore = create<RunStore>((set) => ({
  activeRun: null,
  nodeStates: {},
  pendingEscalation: null,
  wsConnected: false,

  setRun: (run) => set({ activeRun: run, nodeStates: {} }),

  updateNodeState: (nodeState) =>
    set((state) => ({
      nodeStates: { ...state.nodeStates, [nodeState.node_id]: nodeState },
      activeRun: state.activeRun
        ? { ...state.activeRun, status: nodeState.status === 'paused' ? 'paused' : state.activeRun.status }
        : null,
    })),

  setPendingEscalation: (escalation) => set({ pendingEscalation: escalation }),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  clearRun: () =>
    set({ activeRun: null, nodeStates: {}, pendingEscalation: null, wsConnected: false }),
}))
