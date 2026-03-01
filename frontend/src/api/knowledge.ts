/**
 * Handbook (knowledge file) API hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

const WS_ID = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export interface KnowledgeFile {
  id: string
  workspace_id: string
  path: string
  title: string
  raw_token_count: number
  resolved_token_count: number
  linked_paths: string[]
  current_version_id: string | null
  health_score: number | null
  health_updated_at: string | null
  created_at: string
  updated_at: string
}

export interface KnowledgeFileWithContent extends KnowledgeFile {
  content: string
  version_id: string
}

export interface FileVersion {
  version_id: string
  saved_at: string
  saved_by: string
  change_summary: string | null
}

export interface SuggestionOut {
  suggestions: string[]
  health_score: number | null
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useKnowledgeFiles() {
  return useQuery<KnowledgeFile[]>({
    queryKey: ['knowledge', WS_ID],
    queryFn: () => api.get(`/workspaces/${WS_ID}/knowledge`).then(r => r.data),
  })
}

export function useKnowledgeFile(path: string | null) {
  return useQuery<KnowledgeFileWithContent>({
    queryKey: ['knowledge', WS_ID, path],
    queryFn: () =>
      api.get(`/workspaces/${WS_ID}/knowledge/file`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

export function useKnowledgeHistory(path: string | null) {
  return useQuery<FileVersion[]>({
    queryKey: ['knowledge-history', WS_ID, path],
    queryFn: () =>
      api.get(`/workspaces/${WS_ID}/knowledge/history`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

export function useKnowledgeHealth(path: string | null) {
  return useQuery<{ path: string; health_score: number }>({
    queryKey: ['knowledge-health', WS_ID, path],
    queryFn: () =>
      api.get(`/workspaces/${WS_ID}/knowledge/health`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

export function useKnowledgeSuggestions(path: string | null) {
  return useQuery<SuggestionOut>({
    queryKey: ['knowledge-suggestions', WS_ID, path],
    queryFn: () =>
      api.get(`/workspaces/${WS_ID}/knowledge/suggestions`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateKnowledgeFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { path: string; title: string; content: string; change_summary?: string }) =>
      api.post(`/workspaces/${WS_ID}/knowledge`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', WS_ID] }),
  })
}

export function useUpdateKnowledgeFile(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { content: string; change_summary?: string }) =>
      api
        .put(`/workspaces/${WS_ID}/knowledge/file`, body, { params: { path } })
        .then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', WS_ID, path] })
      qc.invalidateQueries({ queryKey: ['knowledge-history', WS_ID, path] })
      qc.invalidateQueries({ queryKey: ['knowledge', WS_ID] })
    },
  })
}

export function useDeleteKnowledgeFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.delete(`/workspaces/${WS_ID}/knowledge/file`, { params: { path } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', WS_ID] }),
  })
}

export function useRestoreKnowledgeFile(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (version_id: string) =>
      api
        .post(`/workspaces/${WS_ID}/knowledge/restore`, { version_id }, { params: { path } })
        .then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', WS_ID, path] })
      qc.invalidateQueries({ queryKey: ['knowledge-history', WS_ID, path] })
    },
  })
}
