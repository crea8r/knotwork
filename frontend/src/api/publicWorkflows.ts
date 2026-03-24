import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RunAttachmentRef } from '@/api/runs'
import type {
  PublicRunTriggerOut,
  PublicRunView,
  PublicWorkflowLink,
  PublicWorkflowView,
} from '@/types'
import { api } from './client'

export function useGraphPublicLinks(workspaceId: string, graphId: string) {
  return useQuery({
    queryKey: ['graph-public-links', workspaceId, graphId],
    queryFn: () =>
      api
        .get<PublicWorkflowLink[]>(`/workspaces/${workspaceId}/graphs/${graphId}/public-links`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!graphId,
  })
}

export function useCreateGraphPublicLink(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { description_md: string; graph_version_id: string | null }) =>
      api
        .post<PublicWorkflowLink>(`/workspaces/${workspaceId}/graphs/${graphId}/public-links`, payload)
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph-public-links', workspaceId, graphId] }),
  })
}

export function useUpdateGraphPublicLink(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { linkId: string; description_md: string; graph_version_id: string | null }) =>
      api
        .patch<PublicWorkflowLink>(
          `/workspaces/${workspaceId}/graphs/${graphId}/public-links/${payload.linkId}`,
          {
            description_md: payload.description_md,
            graph_version_id: payload.graph_version_id,
          },
        )
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph-public-links', workspaceId, graphId] }),
  })
}

export function useDisableGraphPublicLink(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (linkId: string) =>
      api
        .post<PublicWorkflowLink>(`/workspaces/${workspaceId}/graphs/${graphId}/public-links/${linkId}/disable`)
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph-public-links', workspaceId, graphId] }),
  })
}

export function usePublicWorkflow(token: string) {
  return useQuery({
    queryKey: ['public-workflow', token],
    queryFn: () => api.get<PublicWorkflowView>(`/public/workflows/${token}`).then((r) => r.data),
    enabled: !!token,
    retry: false,
  })
}

export function useTriggerPublicRun(token: string) {
  return useMutation({
    mutationFn: (payload: { input: Record<string, unknown>; email?: string; context_files?: RunAttachmentRef[] }) =>
      api.post<PublicRunTriggerOut>(`/public/workflows/${token}/trigger`, payload).then((r) => r.data),
  })
}

export function useUploadPublicWorkflowAttachment(token: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<RunAttachmentRef>(
        `/public/workflows/${token}/attachments`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      return data
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usePublicRun(token: string, options?: { refetchInterval?: number | false | ((query: any) => number | false) }) {
  return useQuery({
    queryKey: ['public-run', token],
    queryFn: () => api.get<PublicRunView>(`/public/runs/${token}`).then((r) => r.data),
    enabled: !!token,
    retry: false,
    ...options,
  })
}

export function usePublicRunNotify(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) =>
      api.post(`/public/runs/${token}/notify`, { email }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-run', token] }),
  })
}
