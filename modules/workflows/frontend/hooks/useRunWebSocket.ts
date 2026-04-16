import { useEffect, useState } from 'react'
import { WS_API_BASE_URL } from '@sdk'

const TERMINAL = new Set(['completed', 'failed', 'stopped'])

interface Params {
  runId: string
  runStatus: string | undefined
  refetchRun: () => void
  refetchNodes: () => void
  refetchRunMessages: () => void
}

/** Opens a WebSocket for a run and wires refetch callbacks. Returns live connection state. */
export function useRunWebSocket({
  runId, runStatus, refetchRun, refetchNodes, refetchRunMessages,
}: Params): boolean {
  const [wsConnected, setWsConnected] = useState(false)

  useEffect(() => {
    if (!runId || (runStatus && TERMINAL.has(runStatus))) return
    const ws = new WebSocket(`${WS_API_BASE_URL}/ws/runs/${runId}`)
    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data as string)
        if (e.type === 'node_completed' || e.type === 'escalation_created') refetchNodes()
        if (e.type === 'run_status_changed' || e.type === 'escalation_resolved') refetchRun()
        if (['node_completed', 'run_status_changed', 'escalation_created', 'escalation_resolved'].includes(e.type)) refetchRunMessages()
      } catch { /* ignore */ }
    }
    return () => { ws.close() }
  }, [runId, runStatus, refetchRun, refetchNodes, refetchRunMessages])

  return wsConnected
}
