import { useMutation, useQuery } from '@tanstack/react-query'
import type { Run, RunNodeState } from '@/types'
import { api } from './client'

export function useRun(
  workspaceId: string,
  runId: string,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () =>
      api.get<Run>(`/workspaces/${workspaceId}/runs/${runId}`).then((r) => r.data),
    enabled: !!workspaceId && !!runId,
    ...options,
  })
}

export function useRunNodes(workspaceId: string, runId: string) {
  return useQuery({
    queryKey: ['run-nodes', runId],
    queryFn: () =>
      api
        .get<RunNodeState[]>(`/workspaces/${workspaceId}/runs/${runId}/nodes`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!runId,
  })
}

export function useTriggerRun(workspaceId: string, graphId: string) {
  return useMutation({
    mutationFn: (data: { input: Record<string, unknown> }) =>
      api
        .post<Run>(`/workspaces/${workspaceId}/graphs/${graphId}/runs`, data)
        .then((r) => r.data),
  })
}
