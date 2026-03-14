/**
 * Auth API: magic link login, invitation flow, current user.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { API_BASE_URL } from './client'

// Use a bare axios instance for auth calls (no auth header needed)
const authApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

export interface InvitationInfo {
  email: string
  workspace_name: string
  role: string
  expires_at: string
  already_accepted: boolean
}

export interface AcceptInvitationResult {
  access_token: string
  token_type: string
  user_id: string
  workspace_id: string
  name: string
  email: string
  role: string
}

export interface MagicLinkVerifyResult {
  access_token: string
  token_type: string
}

export interface UserMe {
  id: string
  email: string
  name: string
  bio?: string | null
  avatar_url?: string | null
}

export interface MemberOut {
  id: string
  user_id: string
  name: string
  email: string
  role: string
  avatar_url: string | null
  bio: string | null
  joined_at: string
}

export interface MembersPage {
  items: MemberOut[]
  total: number
  page: number
  page_size: number
}

export interface InvitationOut {
  id: string
  workspace_id: string
  email: string
  role: string
  expires_at: string
  accepted_at: string | null
  created_at: string
  token_hint: string
}

// ── Magic link ────────────────────────────────────────────────────────────────

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: (email: string) =>
      authApi.post('/auth/magic-link-request', { email }).then((r) => r.data),
  })
}

export function useVerifyMagicLink() {
  return useMutation({
    mutationFn: (token: string) =>
      authApi
        .post<MagicLinkVerifyResult>('/auth/magic-link-verify', { token })
        .then((r) => r.data),
  })
}

// ── Invitation flow ───────────────────────────────────────────────────────────

export function useGetInvitation(token: string | null) {
  return useQuery<InvitationInfo>({
    queryKey: ['invitation', token],
    queryFn: () => authApi.get(`/auth/invitations/${token}`).then((r) => r.data),
    enabled: !!token,
    retry: false,
  })
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: ({ token, name }: { token: string; name: string }) =>
      authApi
        .post<AcceptInvitationResult>(`/auth/invitations/${token}/accept`, { name })
        .then((r) => r.data),
  })
}

import { api } from './client'
// ── Current user ──────────────────────────────────────────────────────────────

export function useMe() {
  return useQuery<UserMe>({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get('/auth/me').then((r) => r.data),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateMe() {
  return useMutation({
    mutationFn: (data: { name?: string; bio?: string; avatar_url?: string }) =>
      api.patch<UserMe>('/auth/me', data).then((r) => r.data),
  })
}

export function useWorkspaceMembers(workspaceId: string | null, page = 1) {
  return useQuery<MembersPage>({
    queryKey: ['workspaces', workspaceId, 'members', page],
    queryFn: () =>
      api
        .get(`/workspaces/${workspaceId}/members`, { params: { page, page_size: 20 } })
        .then((r) => r.data),
    enabled: !!workspaceId,
  })
}

// ── Workspace invitations (owner) ─────────────────────────────────────────────

export function useWorkspaceInvitations(workspaceId: string | null) {
  return useQuery<InvitationOut[]>({
    queryKey: ['workspaces', workspaceId, 'invitations'],
    queryFn: () => api.get(`/workspaces/${workspaceId}/invitations`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useCreateInvitation(workspaceId: string | null) {
  return useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.post<InvitationOut>(`/workspaces/${workspaceId}/invitations`, data).then((r) => r.data),
  })
}
