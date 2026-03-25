/**
 * Designer API hooks — chat agent + import-md + persistent history.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Graph } from '@/types'
import { useAuthStore } from '@/store/auth'

const WS_ID = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export interface GraphDelta {
  add_nodes?: Array<{ id: string; type: string; name: string; config: Record<string, unknown> }>
  update_nodes?: Array<{ id: string; name?: string; config?: Record<string, unknown> }>
  remove_nodes?: string[]
  add_edges?: Array<{ id: string; source: string; target: string; type: string }>
  remove_edges?: string[]
  set_entry_point?: string
  set_input_schema?: Array<{ name: string; label: string; description: string; required: boolean; type: 'text' | 'textarea' | 'number' }>
}

export interface DesignChatResponse {
  reply: string
  graph_delta: GraphDelta
  questions: string[]
}

function resolveWorkspaceId(workspaceId?: string) {
  return workspaceId ?? useAuthStore.getState().workspaceId ?? WS_ID
}

export function useDesignChat(workspaceId: string | undefined, graphId: string) {
  const qc = useQueryClient()
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId)
  return useMutation<DesignChatResponse, Error, { session_id: string; message: string }>({
    mutationFn: (body) =>
      api
        .post(`/workspaces/${resolvedWorkspaceId}/graphs/design/chat`, {
          ...body,
          graph_id: graphId,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designer-messages', resolvedWorkspaceId, graphId] })
    },
  })
}

export function useImportMd(workspaceId?: string) {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId)
  const qc = useQueryClient()
  return useMutation<Graph, Error, { content: string; name: string }>({
    mutationFn: (body) =>
      api.post(`/workspaces/${resolvedWorkspaceId}/graphs/import-md`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graphs', resolvedWorkspaceId] }),
  })
}

export interface DesignerMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export function useDesignerMessages(workspaceId: string, graphId: string) {
  return useQuery<DesignerMessage[]>({
    queryKey: ['designer-messages', workspaceId, graphId],
    queryFn: () =>
      api
        .get<DesignerMessage[]>(`/workspaces/${workspaceId}/graphs/${graphId}/designer-messages`)
        .then((r) => r.data),
    enabled: !!graphId,
  })
}

export function useClearDesignerHistory(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.delete(`/workspaces/${workspaceId}/graphs/${graphId}/designer-messages`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['designer-messages', workspaceId, graphId] }),
  })
}
