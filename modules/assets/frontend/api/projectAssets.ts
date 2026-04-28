import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE_URL } from '@sdk'
import { useAuthStore } from '@auth'

import type {
  FileVersion,
  KnowledgeFile,
  KnowledgeFileWithContent,
  SuggestionOut,
  UploadPreview,
} from './knowledge'

export type ProjectAssetFile = KnowledgeFile
export type ProjectAssetFileWithContent = KnowledgeFileWithContent

export interface ProjectAssetFolder {
  id: string
  workspace_id: string
  path: string
  created_at: string
}

function projectAssetBase(workspaceId: string, projectRef: string) {
  return `/workspaces/${workspaceId}/assets/project/${projectRef}`
}

export function useProjectAssetFiles(workspaceId: string, projectRef: string) {
  return useQuery({
    queryKey: ['project-assets-files', workspaceId, projectRef],
    queryFn: () =>
      api
        .get<ProjectAssetFile[]>(`${projectAssetBase(workspaceId, projectRef)}/files`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!projectRef,
  })
}

export function useProjectFolders(workspaceId: string, projectRef: string) {
  return useQuery({
    queryKey: ['project-assets-folders', workspaceId, projectRef],
    queryFn: () =>
      api
        .get<ProjectAssetFolder[]>(`${projectAssetBase(workspaceId, projectRef)}/folders`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!projectRef,
  })
}

export function useProjectAssetFile(workspaceId: string, projectRef: string, path: string) {
  return useQuery({
    queryKey: ['project-asset-file', workspaceId, projectRef, path],
    queryFn: () =>
      api
        .get<ProjectAssetFileWithContent>(`${projectAssetBase(workspaceId, projectRef)}/files/by-path`, {
          params: { path },
        })
        .then((r) => r.data),
    enabled: !!workspaceId && !!projectRef && !!path,
  })
}

export function useProjectAssetHistory(workspaceId: string, projectRef: string, path: string | null) {
  return useQuery({
    queryKey: ['project-asset-history', workspaceId, projectRef, path],
    queryFn: () =>
      api
        .get<FileVersion[]>(`${projectAssetBase(workspaceId, projectRef)}/files/history`, { params: { path } })
        .then((r) => r.data),
    enabled: !!workspaceId && !!projectRef && !!path,
  })
}

export function useProjectAssetHealth(workspaceId: string, projectRef: string, path: string | null) {
  return useQuery({
    queryKey: ['project-asset-health', workspaceId, projectRef, path],
    queryFn: () =>
      api
        .get<{ path: string; health_score: number }>(`${projectAssetBase(workspaceId, projectRef)}/files/health`, {
          params: { path },
        })
        .then((r) => r.data),
    enabled: !!workspaceId && !!projectRef && !!path,
  })
}

export function useProjectAssetSuggestions(workspaceId: string, projectRef: string, path: string | null) {
  return useQuery({
    queryKey: ['project-asset-suggestions', workspaceId, projectRef, path],
    queryFn: () =>
      api
        .get<SuggestionOut>(`${projectAssetBase(workspaceId, projectRef)}/files/suggestions`, {
          params: { path },
        })
        .then((r) => r.data),
    enabled: !!workspaceId && !!projectRef && !!path,
  })
}

export function useCreateProjectAssetFile(workspaceId: string, projectRef: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { path: string; title?: string; content: string; file_type?: string }) =>
      api
        .post<ProjectAssetFile>(`${projectAssetBase(workspaceId, projectRef)}/files`, payload)
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-assets-files', workspaceId, projectRef] }),
  })
}

export function useCreateProjectFolder(workspaceId: string, projectRef: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api
        .post<ProjectAssetFolder>(`${projectAssetBase(workspaceId, projectRef)}/folders`, { path })
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-assets-folders', workspaceId, projectRef] }),
  })
}

export function useRenameProjectFolder(workspaceId: string, projectRef: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, new_path }: { path: string; new_path: string }) =>
      api.patch(`${projectAssetBase(workspaceId, projectRef)}/folders`, { new_path }, { params: { path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-assets-folders', workspaceId, projectRef] })
      qc.invalidateQueries({ queryKey: ['project-assets-files', workspaceId, projectRef] })
    },
  })
}

export function useDeleteProjectFolder(workspaceId: string, projectRef: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.delete(`${projectAssetBase(workspaceId, projectRef)}/folders`, { params: { path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-assets-folders', workspaceId, projectRef] })
      qc.invalidateQueries({ queryKey: ['project-assets-files', workspaceId, projectRef] })
    },
  })
}

export function useUploadProjectFile(workspaceId: string, projectRef: string) {
  return useMutation({
    mutationFn: async ({ file, folder }: { file: File; folder?: string }) => {
      const form = new FormData()
      form.append('file', file)
      const params = folder ? `?folder=${encodeURIComponent(folder)}` : ''
      const token = useAuthStore.getState().token
      const headers: HeadersInit = {}
      if (token && token !== 'localhost-bypass') headers.Authorization = `Bearer ${token}`
      const res = await fetch(
        `${API_BASE_URL}${projectAssetBase(workspaceId, projectRef)}/uploads/preview${params}`,
        { method: 'POST', body: form, headers },
      )
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
      return res.json() as Promise<UploadPreview>
    },
  })
}

export function useUpdateProjectAssetFile(workspaceId: string, projectRef: string, path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { content: string }) =>
      api
        .put<ProjectAssetFile>(`${projectAssetBase(workspaceId, projectRef)}/files/by-path`, payload, {
          params: { path },
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-assets-files', workspaceId, projectRef] })
      qc.invalidateQueries({ queryKey: ['project-asset-file', workspaceId, projectRef, path] })
    },
  })
}

export function useRenameProjectAssetFile(workspaceId: string, projectRef: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, new_path }: { path: string; new_path: string }) =>
      api
        .patch<ProjectAssetFile>(
          `${projectAssetBase(workspaceId, projectRef)}/files/by-path/rename`,
          { new_path },
          { params: { path } },
        )
        .then((r) => r.data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['project-assets-files', workspaceId, projectRef] })
      qc.invalidateQueries({ queryKey: ['project-asset-file', workspaceId, projectRef, variables.path] })
      qc.invalidateQueries({ queryKey: ['project-asset-file', workspaceId, projectRef, variables.new_path] })
    },
  })
}

export function useRestoreProjectAssetFile(workspaceId: string, projectRef: string, path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (version_id: string) =>
      api
        .post(`${projectAssetBase(workspaceId, projectRef)}/files/restore`, { version_id }, { params: { path } })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-asset-file', workspaceId, projectRef, path] })
      qc.invalidateQueries({ queryKey: ['project-asset-history', workspaceId, projectRef, path] })
      qc.invalidateQueries({ queryKey: ['project-assets-files', workspaceId, projectRef] })
    },
  })
}

export function useDeleteProjectAssetFile(workspaceId: string, projectRef: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.delete(`${projectAssetBase(workspaceId, projectRef)}/files/by-path`, { params: { path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-assets-files', workspaceId, projectRef] })
    },
  })
}
