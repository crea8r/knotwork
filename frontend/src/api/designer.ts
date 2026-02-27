/**
 * Designer API hooks — chat agent + import-md.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Graph } from '@/types'

const WS_ID = import.meta.env.VITE_WORKSPACE_ID ?? 'dev-workspace'

export interface GraphDelta {
  add_nodes?: Array<{ id: string; type: string; name: string; config: Record<string, unknown> }>
  update_nodes?: Array<{ id: string; name?: string; config?: Record<string, unknown> }>
  remove_nodes?: string[]
  add_edges?: Array<{ id: string; source: string; target: string; type: string }>
  remove_edges?: string[]
  set_entry_point?: string
}

export interface DesignChatResponse {
  reply: string
  graph_delta: GraphDelta
  questions: string[]
}

export function useDesignChat(graphId: string) {
  return useMutation<DesignChatResponse, Error, { session_id: string; message: string }>({
    mutationFn: (body) =>
      api
        .post(`/workspaces/${WS_ID}/graphs/design/chat`, {
          ...body,
          graph_id: graphId,
        })
        .then((r) => r.data),
  })
}

export function useImportMd() {
  const qc = useQueryClient()
  return useMutation<Graph, Error, { content: string; name: string }>({
    mutationFn: (body) =>
      api.post(`/workspaces/${WS_ID}/graphs/import-md`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graphs', WS_ID] }),
  })
}
