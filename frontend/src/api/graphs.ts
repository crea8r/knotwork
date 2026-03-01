import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Graph, GraphDefinition, GraphVersion } from '@/types'
import { api } from './client'

export function useGraphs(workspaceId: string) {
  return useQuery({
    queryKey: ['graphs', workspaceId],
    queryFn: () =>
      api.get<Graph[]>(`/workspaces/${workspaceId}/graphs`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useGraph(workspaceId: string, graphId: string) {
  return useQuery({
    queryKey: ['graph', graphId],
    queryFn: () =>
      api.get<Graph>(`/workspaces/${workspaceId}/graphs/${graphId}`).then((r) => r.data),
    enabled: !!workspaceId && !!graphId,
  })
}

export function useCreateGraph(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      api.post<Graph>(`/workspaces/${workspaceId}/graphs`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graphs', workspaceId] }),
  })
}

export function useGraphVersion(workspaceId: string, versionId: string) {
  return useQuery({
    queryKey: ['graph-version', versionId],
    queryFn: () =>
      api
        .get<GraphVersion>(`/workspaces/${workspaceId}/graphs/versions/${versionId}`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!versionId,
  })
}

export function useSaveGraphVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (definition: GraphDefinition) =>
      api
        .post(`/workspaces/${workspaceId}/graphs/${graphId}/versions`, { definition })
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', graphId] }),
  })
}
