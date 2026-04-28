import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Graph, GraphDefinition, GraphVersion } from '@data-models'
import { api } from '@sdk'

export function useGraphs(workspaceId: string, projectId?: string | null) {
  return useQuery({
    queryKey: ['graphs', workspaceId, projectId ?? 'global'],
    queryFn: () =>
      api.get<Graph[]>(`/workspaces/${workspaceId}/workflows`, {
        params: projectId ? { project_id: projectId } : {},
      }).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useGraph(workspaceId: string, graphId: string) {
  return useQuery({
    queryKey: ['graph', graphId],
    queryFn: () =>
      api.get<Graph>(`/workspaces/${workspaceId}/workflows/${graphId}`).then((r) => r.data),
    enabled: !!workspaceId && !!graphId,
  })
}

export function useCreateGraph(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; path?: string; description?: string; project_id?: string | null }) =>
      api.post<Graph>(`/workspaces/${workspaceId}/workflows`, data).then((r) => r.data),
    onSuccess: (_, data) => {
      qc.invalidateQueries({ queryKey: ['graphs', workspaceId] })
      qc.invalidateQueries({ queryKey: ['graphs', workspaceId, data.project_id ?? 'global'] })
      qc.invalidateQueries({ queryKey: ['channels', workspaceId] })
      if (data.project_id) {
        qc.invalidateQueries({ queryKey: ['project-channels', workspaceId, data.project_id] })
      }
    },
  })
}

export function useUpdateGraph(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ graphId, ...data }: { graphId: string; name?: string; path?: string; description?: string; status?: string; default_model?: string | null; project_id?: string | null }) =>
      api.patch<Graph>(`/workspaces/${workspaceId}/workflows/${graphId}`, data).then((r) => r.data),
    onSuccess: (_, { graphId }) => {
      qc.invalidateQueries({ queryKey: ['graphs', workspaceId] })
      qc.invalidateQueries({ queryKey: ['graph', graphId] })
    },
  })
}

export function useGraphVersion(workspaceId: string, versionId: string) {
  return useQuery({
    queryKey: ['graph-version', versionId],
    queryFn: () =>
      api
        .get<GraphVersion>(`/workspaces/${workspaceId}/workflows/versions/${versionId}`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!versionId,
  })
}

/** S9.1: List all named versions (with attached drafts + run counts) for a graph. */
export function useGraphVersions(workspaceId: string, graphId: string, includeArchived = false) {
  return useQuery({
    queryKey: ['graph-versions', graphId, includeArchived],
    queryFn: () =>
      api
        .get<GraphVersion[]>(`/workspaces/${workspaceId}/workflows/${graphId}/versions`, {
          params: { include_archived: includeArchived },
        })
        .then((r) => r.data),
    enabled: !!workspaceId && !!graphId,
  })
}

/** S9.1: Get the draft for a specific version. */
export function useVersionDraft(workspaceId: string, graphId: string, versionRowId: string) {
  return useQuery({
    queryKey: ['version-draft', graphId, versionRowId],
    queryFn: () =>
      api
        .get<GraphVersion>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}/draft`,
        )
        .then((r) => r.data),
    enabled: !!workspaceId && !!graphId && !!versionRowId,
  })
}

/** S9.1: Upsert the draft for a version (auto-save). */
export function useUpsertVersionDraft(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ versionRowId, definition }: { versionRowId: string; definition: GraphDefinition }) =>
      api
        .put<GraphVersion>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}/draft`,
          { definition },
        )
        .then((r) => r.data),
    onSuccess: (_, { versionRowId }) => {
      qc.invalidateQueries({ queryKey: ['version-draft', graphId, versionRowId] })
      qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
    },
  })
}

/** S9.1: Upsert the root draft (no parent version). */
export function useUpsertRootDraft(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (definition: GraphDefinition) =>
      api
        .put<GraphVersion>(`/workspaces/${workspaceId}/workflows/${graphId}/draft`, { definition })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
      qc.invalidateQueries({ queryKey: ['graph', graphId] })
    },
  })
}

/** S9.1: Promote a version's draft into a named version. */
export function usePromoteDraft(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionRowId: string) =>
      api
        .post<GraphVersion>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}/promote`,
        )
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
      qc.invalidateQueries({ queryKey: ['graph', graphId] })
    },
  })
}

/** S9.1: Promote the root draft (no parent version) into the first named version. */
export function usePromoteRootDraft(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api
        .post<GraphVersion>(`/workspaces/${workspaceId}/workflows/${graphId}/draft/promote`)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
      qc.invalidateQueries({ queryKey: ['graph', graphId] })
    },
  })
}

/** S9.1: Rename a version. */
export function useRenameVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ versionRowId, name }: { versionRowId: string; name: string }) =>
      api
        .patch<GraphVersion>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}`,
          { name },
        )
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph-versions', graphId] }),
  })
}

/** S9.1: Set a version as production. */
export function useSetProduction(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionRowId: string) =>
      api
        .post<Graph>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}/production`,
        )
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph', graphId] })
      qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
    },
  })
}

/** S9.1: Archive a version. */
export function useArchiveVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionRowId: string) =>
      api
        .post<GraphVersion>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}/archive`,
        )
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph-versions', graphId] }),
  })
}

/** S9.1: Unarchive a version. */
export function useUnarchiveVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionRowId: string) =>
      api
        .post<GraphVersion>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}/unarchive`,
        )
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph-versions', graphId] }),
  })
}

/** S9.1: Delete a version (guarded). */
export function useDeleteVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionRowId: string) =>
      api
        .delete(`/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}`)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
      qc.invalidateQueries({ queryKey: ['graph', graphId] })
    },
  })
}

/** S9.1: Fork a version into a new independent workflow. */
export function useForkVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ versionRowId, name }: { versionRowId: string; name: string }) =>
      api
        .post<Graph>(
          `/workspaces/${workspaceId}/workflows/${graphId}/versions/${versionRowId}/fork`,
          { name },
        )
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graphs', workspaceId] }),
  })
}

export function useSaveGraphVersion(workspaceId: string, graphId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (definition: GraphDefinition) =>
      api
        .post(`/workspaces/${workspaceId}/workflows/${graphId}/versions`, { definition })
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', graphId] }),
  })
}

export interface GraphDeleteResult {
  action: 'deleted' | 'archived'
  run_count: number
}

export function useDeleteGraph(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (graphId: string) =>
      api
        .delete<GraphDeleteResult>(`/workspaces/${workspaceId}/workflows/${graphId}`)
        .then((r) => r.data),
    onSuccess: (_, graphId) => {
      qc.invalidateQueries({ queryKey: ['graphs', workspaceId] })
      qc.invalidateQueries({ queryKey: ['graph', graphId] })
      qc.invalidateQueries({ queryKey: ['runs', workspaceId] })
    },
  })
}
