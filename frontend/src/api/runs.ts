import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Run, RunNodeState } from '@/types'
import { api } from './client'

export function useRuns(workspaceId: string, status?: string) {
  return useQuery({
    queryKey: ['runs', workspaceId, status],
    queryFn: () => {
      const params = status ? `?status=${status}` : ''
      return api
        .get<Run[]>(`/workspaces/${workspaceId}/runs${params}`)
        .then((r) => r.data)
    },
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useRun(
  workspaceId: string,
  runId: string,
  options?: { refetchInterval?: number | false | ((query: any) => number | false) },
) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () =>
      api.get<Run>(`/workspaces/${workspaceId}/runs/${runId}`).then((r) => r.data),
    enabled: !!workspaceId && !!runId,
    ...options,
  })
}

export function useRunNodes(
  workspaceId: string,
  runId: string,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['run-nodes', runId],
    queryFn: () =>
      api
        .get<RunNodeState[]>(`/workspaces/${workspaceId}/runs/${runId}/nodes`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!runId,
    ...options,
  })
}

export function useTriggerRun(workspaceId: string, graphId: string) {
  return useMutation({
    mutationFn: (data: { input: Record<string, unknown>; name?: string }) =>
      api
        .post<Run>(`/workspaces/${workspaceId}/graphs/${graphId}/runs`, data)
        .then((r) => r.data),
  })
}

export function useCloneRun(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<Run>(`/workspaces/${workspaceId}/runs/${runId}/clone`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs', workspaceId] }),
  })
}

export function useExecuteRunInline(workspaceId: string) {
  return useMutation({
    mutationFn: (runId: string) =>
      api.post(`/workspaces/${workspaceId}/runs/${runId}/execute`).then((r) => r.data),
  })
}

export function useRenameRun(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, name }: { runId: string; name: string }) =>
      api.patch<Run>(`/workspaces/${workspaceId}/runs/${runId}`, { name }).then((r) => r.data),
    onSuccess: (_, { runId }) => {
      qc.invalidateQueries({ queryKey: ['run', runId] })
      qc.invalidateQueries({ queryKey: ['runs', workspaceId] })
    },
  })
}

export function useUpdateRunInput(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, input }: { runId: string; input: Record<string, unknown> }) =>
      api.patch<Run>(`/workspaces/${workspaceId}/runs/${runId}`, { input }).then((r) => r.data),
    onSuccess: (_, { runId }) => {
      qc.invalidateQueries({ queryKey: ['run', runId] })
    },
  })
}

export function useDeleteRun(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      api.delete(`/workspaces/${workspaceId}/runs/${runId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs', workspaceId] })
    },
  })
}
