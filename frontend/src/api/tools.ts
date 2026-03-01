import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Tool {
  id: string
  workspace_id: string | null
  name: string
  slug: string
  category: string
  scope: string
  definition: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface BuiltinTool {
  slug: string
  name: string
  category: string
  description: string
  parameters: Array<{ name: string; type: string; required: boolean }>
}

export interface ToolTestResponse {
  output: Record<string, unknown>
  error: string | null
  duration_ms: number
}

export function useTools(workspaceId: string) {
  return useQuery({
    queryKey: ['tools', workspaceId],
    queryFn: () =>
      api.get<Tool[]>(`/workspaces/${workspaceId}/tools`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useBuiltinTools(workspaceId: string) {
  return useQuery({
    queryKey: ['builtin-tools', workspaceId],
    queryFn: () =>
      api
        .get<BuiltinTool[]>(`/workspaces/${workspaceId}/tools/builtins`)
        .then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useCreateTool(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<Tool, 'id' | 'created_at' | 'updated_at'>) =>
      api.post<Tool>(`/workspaces/${workspaceId}/tools`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', workspaceId] }),
  })
}

export function useDeleteTool(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (toolId: string) =>
      api.delete(`/workspaces/${workspaceId}/tools/${toolId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', workspaceId] }),
  })
}

export function useTestTool(workspaceId: string, toolId: string) {
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api
        .post<ToolTestResponse>(
          `/workspaces/${workspaceId}/tools/${toolId}/test`,
          { input },
        )
        .then((r) => r.data),
  })
}

export function useTestBuiltin(workspaceId: string, slug: string) {
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api
        .post<ToolTestResponse>(
          `/workspaces/${workspaceId}/tools/builtins/${slug}/test`,
          { input },
        )
        .then((r) => r.data),
  })
}
