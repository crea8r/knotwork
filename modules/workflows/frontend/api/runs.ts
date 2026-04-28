import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChannelMessage, GraphDefinition, ProviderCallLog, Run, RunNodeState, RunWorklogEntry } from '@data-models'
import { api } from '@sdk'

export interface RunAttachmentRef {
  key: string
  url: string
  filename: string
  mime_type: string
  size: number
  attachment_id: string
}

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

export function useRunDefinition(workspaceId: string, runId: string) {
  return useQuery({
    queryKey: ['run-definition', runId],
    queryFn: () =>
      api
        .get<GraphDefinition>(`/workspaces/${workspaceId}/runs/${runId}/definition`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!runId,
  })
}

export function useRunProviderLogs(
  workspaceId: string,
  runId: string,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['run-provider-logs', runId],
    queryFn: () =>
      api
        .get<ProviderCallLog[]>(`/workspaces/${workspaceId}/runs/${runId}/provider-logs`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!runId,
    ...options,
  })
}

export function useRunWorklog(
  workspaceId: string,
  runId: string,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['run-worklog', runId],
    queryFn: () =>
      api
        .get<RunWorklogEntry[]>(`/workspaces/${workspaceId}/runs/${runId}/worklog`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!runId,
    ...options,
  })
}

export function useRunChatMessages(
  workspaceId: string,
  runId: string,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['run-chat-messages', runId],
    queryFn: () =>
      api
        .get<ChannelMessage[]>(`/workspaces/${workspaceId}/runs/${runId}/chat-messages`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!runId,
    ...options,
  })
}

export function useTriggerRun(workspaceId: string, graphId: string) {
  return useMutation({
    mutationFn: (data: {
      input: Record<string, unknown>
      name?: string
      context_files?: RunAttachmentRef[]
      workflow_version_id?: string
      objective_id?: string
      source_channel_id?: string
    }) =>
      api
        .post<Run>(`/workspaces/${workspaceId}/workflows/${graphId}/runs`, data)
        .then((r) => r.data),
  })
}

export function useTriggerRunAny(workspaceId: string) {
  return useMutation({
    mutationFn: (data: {
      graphId: string
      input: Record<string, unknown>
      name?: string
      context_files?: RunAttachmentRef[]
      workflow_version_id?: string
      objective_id?: string
      source_channel_id?: string
    }) =>
      api
        .post<Run>(`/workspaces/${workspaceId}/workflows/${data.graphId}/runs`, {
          input: data.input,
          name: data.name,
          context_files: data.context_files ?? [],
          workflow_version_id: data.workflow_version_id,
          objective_id: data.objective_id,
          source_channel_id: data.source_channel_id,
        })
        .then((r) => r.data),
  })
}

export function useUploadRunAttachment(workspaceId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<RunAttachmentRef>(
        `/workspaces/${workspaceId}/runs/attachments`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      return data
    },
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

export function useAbortRun(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      api.post(`/workspaces/${workspaceId}/runs/${runId}/abort`).then((r) => r.data),
    onSuccess: (_, runId) => {
      qc.invalidateQueries({ queryKey: ['run', runId] })
      qc.invalidateQueries({ queryKey: ['run-nodes', runId] })
      qc.invalidateQueries({ queryKey: ['run-chat-messages', runId] })
      qc.invalidateQueries({ queryKey: ['runs', workspaceId] })
    },
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
    onSuccess: (_, runId) => {
      // Optimistic cache update so the row disappears immediately.
      qc.setQueriesData<Run[]>(
        { queryKey: ['runs', workspaceId] },
        (current) => (current ?? []).filter((r) => r.id !== runId),
      )
      qc.invalidateQueries({ queryKey: ['runs', workspaceId] })
    },
  })
}
