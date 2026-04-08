import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Channel, Objective, Project, ProjectDashboard, ProjectDocument, ProjectDocumentWithContent, ProjectStatusUpdate,
} from '@/types'
import { api, API_BASE_URL } from './client'
import type { UploadPreview } from './knowledge'
import type { FileVersion, SuggestionOut } from './knowledge'

export interface ProjectFolder {
  id: string
  workspace_id: string
  path: string
  created_at: string
}

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

export function useProjectDocuments(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: ['project-documents', workspaceId, projectId],
    queryFn: () =>
      api.get<ProjectDocument[]>(`/workspaces/${workspaceId}/projects/${projectId}/documents`).then((r) => r.data),
    enabled: !!workspaceId && !!projectId,
  })
}

export function useProjectFolders(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: ['project-folders', workspaceId, projectId],
    queryFn: () =>
      api.get<ProjectFolder[]>(`/workspaces/${workspaceId}/projects/${projectId}/folders`).then((r) => r.data),
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

export function useProjectDocumentHistory(workspaceId: string, projectId: string, path: string | null) {
  return useQuery({
    queryKey: ['project-document-history', workspaceId, projectId, path],
    queryFn: () =>
      api.get<FileVersion[]>(`/workspaces/${workspaceId}/projects/${projectId}/documents/history`, {
        params: { path },
      }).then((r) => r.data),
    enabled: !!workspaceId && !!projectId && !!path,
  })
}

export function useProjectDocumentHealth(workspaceId: string, projectId: string, path: string | null) {
  return useQuery({
    queryKey: ['project-document-health', workspaceId, projectId, path],
    queryFn: () =>
      api.get<{ path: string; health_score: number }>(
        `/workspaces/${workspaceId}/projects/${projectId}/documents/health`,
        { params: { path } },
      ).then((r) => r.data),
    enabled: !!workspaceId && !!projectId && !!path,
  })
}

export function useProjectDocumentSuggestions(workspaceId: string, projectId: string, path: string | null) {
  return useQuery({
    queryKey: ['project-document-suggestions', workspaceId, projectId, path],
    queryFn: () =>
      api.get<SuggestionOut>(`/workspaces/${workspaceId}/projects/${projectId}/documents/suggestions`, {
        params: { path },
      }).then((r) => r.data),
    enabled: !!workspaceId && !!projectId && !!path,
  })
}

export function useCreateProjectDocument(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { path: string; title?: string; content: string }) =>
      api.post<ProjectDocument>(`/workspaces/${workspaceId}/projects/${projectId}/documents`, payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] }),
  })
}

export function useCreateProjectFolder(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.post<ProjectFolder>(`/workspaces/${workspaceId}/projects/${projectId}/folders`, { path }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-folders', workspaceId, projectId] }),
  })
}

export function useRenameProjectFolder(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, new_path }: { path: string; new_path: string }) =>
      api.patch(`/workspaces/${workspaceId}/projects/${projectId}/folders`, { new_path }, {
        params: { path },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-folders', workspaceId, projectId] })
      qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] })
    },
  })
}

export function useDeleteProjectFolder(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.delete(`/workspaces/${workspaceId}/projects/${projectId}/folders`, { params: { path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-folders', workspaceId, projectId] })
      qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] })
    },
  })
}

export function useUploadProjectFile(workspaceId: string, projectId: string) {
  return useMutation({
    mutationFn: async ({ file, folder }: { file: File; folder?: string }) => {
      const form = new FormData()
      form.append('file', file)
      const params = folder ? `?folder=${encodeURIComponent(folder)}` : ''
      const token = localStorage.getItem('knotwork_token')
      const headers: HeadersInit = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(
        `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/upload${params}`,
        { method: 'POST', body: form, headers },
      )
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
      return res.json() as Promise<UploadPreview>
    },
  })
}

export function useUpdateProjectDocument(workspaceId: string, projectId: string, path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { content: string }) =>
      api.put<ProjectDocument>(`/workspaces/${workspaceId}/projects/${projectId}/documents/file`, payload, {
        params: { path },
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] })
      qc.invalidateQueries({ queryKey: ['project-document', workspaceId, projectId, path] })
    },
  })
}

export function useRenameProjectDocument(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, new_path }: { path: string; new_path: string }) =>
      api.patch<ProjectDocument>(
        `/workspaces/${workspaceId}/projects/${projectId}/documents/file/rename`,
        { new_path },
        { params: { path } },
      ).then((r) => r.data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] })
      qc.invalidateQueries({ queryKey: ['project-document', workspaceId, projectId, variables.path] })
      qc.invalidateQueries({ queryKey: ['project-document', workspaceId, projectId, variables.new_path] })
    },
  })
}

export function useRestoreProjectDocument(workspaceId: string, projectId: string, path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (version_id: string) =>
      api.post(`/workspaces/${workspaceId}/projects/${projectId}/documents/restore`, { version_id }, {
        params: { path },
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-document', workspaceId, projectId, path] })
      qc.invalidateQueries({ queryKey: ['project-document-history', workspaceId, projectId, path] })
      qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] })
    },
  })
}

export function useDeleteProjectDocument(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.delete(`/workspaces/${workspaceId}/projects/${projectId}/documents/file`, { params: { path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-documents', workspaceId, projectId] })
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
