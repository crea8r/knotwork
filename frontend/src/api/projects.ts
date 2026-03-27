import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Objective, Project, ProjectDashboard, ProjectDocument, ProjectDocumentWithContent, ProjectStatusUpdate, Task,
} from '@/types'
import { api } from './client'

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

export function useCreateProject(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { title: string; objective: string; status?: string; deadline?: string | null }) =>
      api.post<Project>(`/workspaces/${workspaceId}/projects`, payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', workspaceId] }),
  })
}

export function useUpdateProject(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { title?: string; objective?: string; status?: string; deadline?: string | null }) =>
      api.patch<Project>(`/workspaces/${workspaceId}/projects/${projectId}`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project', workspaceId, projectId] })
      qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId, projectId] })
    },
  })
}

export function useTasks(workspaceId: string, projectId?: string | null) {
  return useQuery({
    queryKey: ['tasks', workspaceId, projectId ?? 'unassigned'],
    queryFn: () =>
      api
        .get<Task[]>(`/workspaces/${workspaceId}/tasks`, { params: projectId ? { project_id: projectId } : {} })
        .then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useTask(workspaceId: string, taskId: string) {
  return useQuery({
    queryKey: ['task', workspaceId, taskId],
    queryFn: () => api.get<Task>(`/workspaces/${workspaceId}/tasks/${taskId}`).then((r) => r.data),
    enabled: !!workspaceId && !!taskId,
  })
}

export const useObjectives = useTasks
export const useObjective = useTask

export function useCreateTask(workspaceId: string) {
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
      parent_task_id?: string | null
      origin_type?: string
      origin_graph_id?: string | null
    }) => api.post<Objective>(`/workspaces/${workspaceId}/tasks`, payload).then((r) => r.data),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['tasks', workspaceId] })
      qc.invalidateQueries({ queryKey: ['tasks', workspaceId, task.project_id ?? 'unassigned'] })
      if (task.project_id) qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId, task.project_id] })
    },
  })
}

export function useUpdateTask(workspaceId: string, taskId: string) {
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
      parent_task_id?: string | null
    }) =>
      api.patch<Task>(`/workspaces/${workspaceId}/tasks/${taskId}`, payload).then((r) => r.data),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['task', workspaceId, taskId] })
      qc.invalidateQueries({ queryKey: ['tasks', workspaceId] })
      qc.invalidateQueries({ queryKey: ['tasks', workspaceId, task.project_id ?? 'unassigned'] })
      if (task.project_id) qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId, task.project_id] })
    },
  })
}

export const useCreateObjective = useCreateTask
export const useUpdateObjective = useUpdateTask

export function useProjectDocuments(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: ['project-documents', workspaceId, projectId],
    queryFn: () =>
      api.get<ProjectDocument[]>(`/workspaces/${workspaceId}/projects/${projectId}/documents`).then((r) => r.data),
    enabled: !!workspaceId && !!projectId,
  })
}

export function useProjectDocument(workspaceId: string, projectId: string, path: string) {
  return useQuery({
    queryKey: ['project-document', workspaceId, projectId, path],
    queryFn: () =>
      api
        .get<ProjectDocumentWithContent>(`/workspaces/${workspaceId}/projects/${projectId}/documents/file`, {
          params: { path },
        })
        .then((r) => r.data),
    enabled: !!workspaceId && !!projectId && !!path,
  })
}

export function useCreateProjectDocument(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { path: string; title?: string; content: string; change_summary?: string }) =>
      api.post<ProjectDocument>(`/workspaces/${workspaceId}/projects/${projectId}/documents`, payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] }),
  })
}

export function useUpdateProjectDocument(workspaceId: string, projectId: string, path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { content: string; change_summary?: string }) =>
      api.put<ProjectDocument>(`/workspaces/${workspaceId}/projects/${projectId}/documents/file`, payload, {
        params: { path },
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] })
      qc.invalidateQueries({ queryKey: ['project-document', workspaceId, projectId, path] })
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
      qc.invalidateQueries({ queryKey: ['project', workspaceId, projectId] })
      qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId, projectId] })
    },
  })
}
