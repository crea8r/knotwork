/**
 * Handbook (knowledge file) API hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE_URL } from './client'
import { useAuthStore } from '@/store/auth'

function useWorkspaceId() {
  return useAuthStore((s) => s.workspaceId) ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
}

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
  file_type: string        // 'md' | 'pdf' | 'docx' | 'image' | 'other'
  is_editable: boolean
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
}

export interface SuggestionOut {
  suggestions: string[]
  health_score: number | null
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useKnowledgeFiles() {
  const workspaceId = useWorkspaceId()
  return useQuery<KnowledgeFile[]>({
    queryKey: ['knowledge', workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/knowledge`).then(r => r.data),
  })
}

export function useSearchKnowledgeFiles(query: string) {
  const workspaceId = useWorkspaceId()
  const q = query.trim()
  return useQuery<KnowledgeFile[]>({
    queryKey: ['knowledge-search', workspaceId, q],
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/knowledge/search`, { params: { q } }).then(r => r.data),
    enabled: q.length > 0,
  })
}

export function useKnowledgeFile(path: string | null) {
  const workspaceId = useWorkspaceId()
  return useQuery<KnowledgeFileWithContent>({
    queryKey: ['knowledge', workspaceId, path],
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/knowledge/file`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

export function useKnowledgeHistory(path: string | null) {
  const workspaceId = useWorkspaceId()
  return useQuery<FileVersion[]>({
    queryKey: ['knowledge-history', workspaceId, path],
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/knowledge/history`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

export function useKnowledgeHealth(path: string | null) {
  const workspaceId = useWorkspaceId()
  return useQuery<{ path: string; health_score: number }>({
    queryKey: ['knowledge-health', workspaceId, path],
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/knowledge/health`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

export function useKnowledgeSuggestions(path: string | null) {
  const workspaceId = useWorkspaceId()
  return useQuery<SuggestionOut>({
    queryKey: ['knowledge-suggestions', workspaceId, path],
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/knowledge/suggestions`, { params: { path } }).then(r => r.data),
    enabled: !!path,
  })
}

/** Build a URL that serves the raw binary file for a given path. */
export function useRawFileUrl(path: string | null): string | null {
  const workspaceId = useWorkspaceId()
  if (!path) return null
  return `${API_BASE_URL}/workspaces/${workspaceId}/knowledge/file/raw?path=${encodeURIComponent(path)}`
}

/** Build a URL that serves DOCX converted to HTML. */
export function useDocxHtmlUrl(path: string | null): string | null {
  const workspaceId = useWorkspaceId()
  if (!path) return null
  return `${API_BASE_URL}/workspaces/${workspaceId}/knowledge/file/html?path=${encodeURIComponent(path)}`
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateKnowledgeFile() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { path: string; title?: string; content: string }) =>
      api.post(`/workspaces/${workspaceId}/knowledge`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', workspaceId] }),
  })
}

export function useUpdateKnowledgeFile(path: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { content: string }) =>
      api.put(`/workspaces/${workspaceId}/knowledge/file`, body, { params: { path } }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', workspaceId, path] })
      qc.invalidateQueries({ queryKey: ['knowledge-history', workspaceId, path] })
      qc.invalidateQueries({ queryKey: ['knowledge', workspaceId] })
    },
  })
}

export function useRenameKnowledgeFile() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, new_path }: { path: string; new_path: string }) =>
      api.patch(`/workspaces/${workspaceId}/knowledge/file/rename`, { new_path }, { params: { path } }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', workspaceId] }),
  })
}

export function useDeleteKnowledgeFile() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.delete(`/workspaces/${workspaceId}/knowledge/file`, { params: { path } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', workspaceId] }),
  })
}

export interface UploadPreview {
  suggested_path: string
  suggested_title: string
  converted_content: string
  format: string
  original_filename: string
}

export function useUploadFile() {
  const workspaceId = useWorkspaceId()
  return useMutation({
    mutationFn: async ({ file, folder }: { file: File; folder?: string }) => {
      const form = new FormData()
      form.append('file', file)
      const params = folder ? `?folder=${encodeURIComponent(folder)}` : ''
      const token = localStorage.getItem('knotwork_token')
      const headers: HeadersInit = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}/handbook/upload${params}`, {
        method: 'POST', body: form, headers,
      })
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
      return res.json() as Promise<UploadPreview>
    },
  })
}

export function useUploadRawFile() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, folder }: { file: File; folder?: string }) => {
      const form = new FormData()
      form.append('file', file)
      const params = folder ? `?folder=${encodeURIComponent(folder)}` : ''
      const token = localStorage.getItem('knotwork_token')
      const headers: HeadersInit = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}/handbook/upload-raw${params}`, {
        method: 'POST', body: form, headers,
      })
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
      return res.json() as Promise<KnowledgeFile>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', workspaceId] }),
  })
}

// ── Knowledge changes ─────────────────────────────────────────────────────────

export interface KnowledgeChange {
  id: string
  workspace_id: string
  project_id: string | null
  run_id: string | null
  node_id: string | null
  agent_ref: string | null
  channel_id: string | null
  action_type: string
  target_type: string
  target_path: string
  proposed_content: string | null
  payload: Record<string, unknown>
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'needs_revision'
  reviewed_by?: string | null
  reviewed_at?: string | null
  final_content?: string | null
  created_at: string
}

export function useKnowledgeChanges(status?: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<KnowledgeChange[]>({
    queryKey: ['knowledge-changes', workspaceId, status],
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/knowledge/changes`, { params: status ? { status } : {} }).then(r => r.data),
  })
}

export function useApproveKnowledgeChange() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, final_content }: { id: string; final_content?: string }) =>
      api.post(`/workspaces/${workspaceId}/knowledge/changes/${id}/approve`, { final_content }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-changes', workspaceId] }),
  })
}

export function useRejectKnowledgeChange() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/workspaces/${workspaceId}/knowledge/changes/${id}/reject`, {}).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-changes', workspaceId] }),
  })
}

export const useHandbookProposals = useKnowledgeChanges
export const useApproveProposal = useApproveKnowledgeChange
export const useRejectProposal = useRejectKnowledgeChange

export function useRestoreKnowledgeFile(path: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (version_id: string) =>
      api.post(`/workspaces/${workspaceId}/knowledge/restore`, { version_id }, { params: { path } }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', workspaceId, path] })
      qc.invalidateQueries({ queryKey: ['knowledge-history', workspaceId, path] })
    },
  })
}
