import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RunAttachmentRef } from './runs'
import type { GraphVersion, PublicRunTriggerOut, PublicRunView, PublicWorkflowView } from '@data-models'
import { api } from '@sdk'

// ── Authenticated: publish / unpublish ───────────────────────────────────────

export function usePublishVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ versionId, description_md }: { versionId: string; description_md: string }) =>
      api
        .post<GraphVersion>(`/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionId}/publish`, { description_md })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['graph-versions', workspaceId, graphId] })
      void qc.invalidateQueries({ queryKey: ['graphs', workspaceId] })
    },
  })
}

export function useUnpublishVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionId: string) =>
      api
        .delete<GraphVersion>(`/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionId}/publish`)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['graph-versions', workspaceId, graphId] })
      void qc.invalidateQueries({ queryKey: ['graphs', workspaceId] })
    },
  })
}

// ── Public-facing ────────────────────────────────────────────────────────────

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

export function useUploadPublicWorkflowAttachment(workflowSlug: string, versionSlug: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<RunAttachmentRef>(
        `/public/workflows/${workflowSlug}/${versionSlug}/attachments`,
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
