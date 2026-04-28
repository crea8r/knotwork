import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Channel, Objective, Project, ProjectDashboard, ProjectStatusUpdate,
} from '@data-models'
import { api } from '@sdk'

export function useProjects(workspaceId: string) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => api.get<Project[]>(`/workspaces/${workspaceId}/projects`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useProject(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: ['project', workspaceId, projectId],
    queryFn: () => api.get<Project>(`/workspaces/${workspaceId}/projects/${projectId}`).then((r) => r.data),
    enabled: !!workspaceId && !!projectId,
  })
}

export function useProjectDashboard(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: ['project-dashboard', workspaceId, projectId],
    queryFn: () =>
      api.get<ProjectDashboard>(`/workspaces/${workspaceId}/projects/${projectId}/dashboard`).then((r) => r.data),
    enabled: !!workspaceId && !!projectId,
  })
}

export function useProjectChannels(workspaceId: string, projectId: string, includeArchived = false) {
  return useQuery({
    queryKey: ['project-channels', workspaceId, projectId, includeArchived],
    queryFn: () =>
      api.get<Channel[]>(`/workspaces/${workspaceId}/projects/${projectId}/channels`, {
        params: includeArchived ? { include_archived: true } : {},
      }).then((r) => r.data),
    enabled: !!workspaceId && !!projectId,
    refetchInterval: 5_000,
  })
}

export function useCreateProject(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { title: string; description: string; status?: string; deadline?: string | null }) =>
      api.post<Project>(`/workspaces/${workspaceId}/projects`, payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', workspaceId] }),
  })
}

export function useUpdateProject(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { title?: string; description?: string; status?: string; deadline?: string | null }) =>
      api.patch<Project>(`/workspaces/${workspaceId}/projects/${projectId}`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-channels', workspaceId] })
    },
  })
}

export function useObjectives(workspaceId: string, projectId?: string | null) {
  return useQuery({
    queryKey: ['objectives', workspaceId, projectId ?? 'unassigned'],
    queryFn: () =>
      api
        .get<Objective[]>(`/workspaces/${workspaceId}/objectives`, { params: projectId ? { project_id: projectId } : {} })
        .then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useObjective(workspaceId: string, objectiveId: string) {
  return useQuery({
    queryKey: ['objective', workspaceId, objectiveId],
    queryFn: () => api.get<Objective>(`/workspaces/${workspaceId}/objectives/${objectiveId}`).then((r) => r.data),
    enabled: !!workspaceId && !!objectiveId,
  })
}

export function useCreateObjective(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      code?: string | null
      title: string
      description?: string
      status?: string
      progress_percent?: number
      status_summary?: string
      key_results?: string[]
      owner_type?: string | null
      owner_name?: string | null
      deadline?: string | null
      project_id?: string | null
      parent_objective_id?: string | null
      origin_type?: string
      origin_graph_id?: string | null
    }) => api.post<Objective>(`/workspaces/${workspaceId}/objectives`, payload).then((r) => r.data),
    onSuccess: (objective) => {
      qc.invalidateQueries({ queryKey: ['objectives', workspaceId] })
      qc.invalidateQueries({ queryKey: ['objectives', workspaceId, objective.project_id ?? 'unassigned'] })
      qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-channels', workspaceId] })
    },
  })
}

export function useUpdateObjective(workspaceId: string, objectiveId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      code?: string | null
      title?: string
      description?: string
      status?: string
      progress_percent?: number
      status_summary?: string | null
      key_results?: string[]
      owner_type?: string | null
      owner_name?: string | null
      deadline?: string | null
      project_id?: string | null
      parent_objective_id?: string | null
    }) =>
      api.patch<Objective>(`/workspaces/${workspaceId}/objectives/${objectiveId}`, payload).then((r) => r.data),
    onSuccess: (objective) => {
      qc.invalidateQueries({ queryKey: ['objective', workspaceId] })
      qc.invalidateQueries({ queryKey: ['objectives', workspaceId] })
      qc.invalidateQueries({ queryKey: ['objectives', workspaceId, objective.project_id ?? 'unassigned'] })
      qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-channels', workspaceId] })
    },
  })
}

export function useCreateProjectStatusUpdate(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { summary: string; author_name?: string; author_type?: string }) =>
      api
        .post<ProjectStatusUpdate>(`/workspaces/${workspaceId}/projects/${projectId}/status-updates`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId] })
    },
  })
}
