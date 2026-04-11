/**
 * Handbook folder API hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@sdk'
import { useAuthStore } from '@auth'

function useWorkspaceId() {
  return useAuthStore((s) => s.workspaceId) ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
}

export interface KnowledgeFolder {
  id: string
  workspace_id: string
  path: string
  created_at: string
}

export function useKnowledgeFolders() {
  const workspaceId = useWorkspaceId()
  return useQuery<KnowledgeFolder[]>({
    queryKey: ['knowledge-folders', workspaceId],
    queryFn: () =>
      api.get(`/workspaces/${workspaceId}/knowledge/folders`).then(r => r.data),
  })
}

export function useCreateFolder() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.post(`/workspaces/${workspaceId}/knowledge/folders`, { path }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-folders', workspaceId] }),
  })
}

export function useDeleteFolder() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.delete(`/workspaces/${workspaceId}/knowledge/folders`, { params: { path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-folders', workspaceId] })
      qc.invalidateQueries({ queryKey: ['knowledge', workspaceId] })
    },
  })
}

export function useRenameFolder() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, new_path }: { path: string; new_path: string }) =>
      api.patch(`/workspaces/${workspaceId}/knowledge/folders`, { new_path }, { params: { path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-folders', workspaceId] })
      qc.invalidateQueries({ queryKey: ['knowledge', workspaceId] })
    },
  })
}
