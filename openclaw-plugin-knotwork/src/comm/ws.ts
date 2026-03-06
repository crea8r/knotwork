import type { CommChannel } from './types'

export function createWebSocketComm(): CommChannel {
  throw new Error('WebSocket comm is not implemented yet. Use polling comm for now.')
}
