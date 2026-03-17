// gateway.ts — Raw WebSocket RPC to the OpenClaw gateway.
// One connection per call: connect → hello-ok → RPC call → close.
// client.id must be a GATEWAY_CLIENT_IDS literal; mode must be a GATEWAY_CLIENT_MODES literal.
// Auth token is inside connectParams.auth, not a separate 'auth' RPC step.

import type { LooseRecord, WsFrame } from '../types'

const OPERATOR_SCOPES = ['operator.read', 'operator.write']

export async function gatewayRpc(
  port: number, token: string | null, method: string, params: LooseRecord, timeoutMs = 90_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
    if (typeof WS !== 'function') { reject(new Error('WebSocket not available in runtime')); return }

    const ws = new WS(`ws://127.0.0.1:${port}/`)
    const reqId = Math.random().toString(36).slice(2, 10)
    let settled = false

    const timer = setTimeout(
      () => done(() => reject(new Error(`gateway '${method}' timed out after ${timeoutMs}ms`))),
      timeoutMs,
    )

    function done(fn: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* ignore */ }
      fn()
    }

    function sendRequest() {
      ws.send(JSON.stringify({ type: 'req', id: reqId, method, params }))
    }

    const errStr = (e: unknown) =>
      e && typeof e === 'object' ? JSON.stringify(e) : String(e ?? 'unknown')

    ws.onopen = () => {
      const connectParams: LooseRecord = {
        minProtocol: 1,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          displayName: 'knotwork-bridge',
          version: '0.2.0',
          platform: typeof process !== 'undefined' ? process.platform : 'linux',
          mode: 'backend',
        },
        role: 'operator',
        scopes: OPERATOR_SCOPES,
        permissions: {},
      }
      if (token) connectParams.auth = { token }
      ws.send(JSON.stringify({ type: 'req', id: 'kw-connect', method: 'connect', params: connectParams }))
    }

    ws.onmessage = (ev: MessageEvent) => {
      let frame: WsFrame
      try { frame = JSON.parse(String(ev.data)) as WsFrame } catch { return }
      if (frame.type === 'event') return
      if (frame.id === 'kw-connect') {
        if (!frame.ok) { done(() => reject(new Error(`gateway connect failed: ${errStr(frame.error)}`))); return }
        sendRequest()
        return
      }
      if (frame.type === 'res' && frame.id === reqId) {
        if (frame.ok) done(() => resolve(frame.payload))
        else done(() => reject(new Error(`gateway '${method}' error: ${errStr(frame.error)}`)))
      }
    }

    ws.onerror = () => done(() => reject(new Error(`WebSocket error calling gateway '${method}'`)))
    ws.onclose = (ev: CloseEvent) => {
      if (!settled && ev.code !== 1000 && ev.code !== 1001) {
        done(() => reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'}) calling '${method}'`)))
      }
    }
  })
}
