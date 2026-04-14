/**
 * Auth API: magic link login, invitation flow, current user.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { API_BASE_URL } from '@sdk'

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

export interface PasswordLoginResult {
  access_token: string
  token_type: string
}

export interface UserMe {
  id: string
  email: string
  name: string
  bio?: string | null
  avatar_url?: string | null
  must_change_password: boolean
}

export interface MemberOut {
  id: string
  user_id: string
  name: string
  email: string | null  // null for agent accounts
  role: string
  kind: string          // 'human' | 'agent'
  avatar_url: string | null
  bio: string | null
  agent_zero_role: boolean
  contribution_brief: string | null
  availability_status: 'available' | 'focused' | 'busy' | 'away' | 'blocked'
  capacity_level: 'open' | 'limited' | 'full'
  status_note: string | null
  current_commitments: Array<Record<string, unknown>>
  recent_work: Array<Record<string, unknown>>
  status_updated_at: string | null
  joined_at: string
  access_disabled_at: string | null
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

export interface WorkspaceEmailConfig {
  enabled: boolean
  has_resend_api_key: boolean
  email_from: string | null
}

export interface LocalhostSwitchUserResult {
  detail: string
  email: string
}

export interface PasswordResetRequestResult {
  detail: string
}

// ── Auth flows ────────────────────────────────────────────────────────────────

export function usePasswordLogin() {
  return useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      authApi.post<PasswordLoginResult>('/auth/password-login', data).then((r) => r.data),
  })
}

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

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) =>
      authApi.post<PasswordResetRequestResult>('/auth/password-reset-request', { email }).then((r) => r.data),
  })
}

export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: (data: { token: string; new_password: string }) =>
      authApi.post<PasswordLoginResult>('/auth/password-reset-confirm', data).then((r) => r.data),
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
    mutationFn: ({ token, name, password }: { token: string; name: string; password: string }) =>
      authApi
        .post<AcceptInvitationResult>(`/auth/invitations/${token}/accept`, { name, password })
        .then((r) => r.data),
  })
}

import { api } from '@sdk'
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

export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { current_password?: string; new_password: string }) =>
      api.post<UserMe>('/auth/change-password', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}

export function useWorkspaceMembers(
  workspaceId: string | null,
  page = 1,
  kind?: 'human' | 'agent',
  disabled?: boolean,
) {
  return useQuery<MembersPage>({
    queryKey: ['workspaces', workspaceId, 'members', page, kind ?? 'all', disabled == null ? 'all' : disabled ? 'disabled' : 'active'],
    queryFn: () =>
      api
        .get(`/workspaces/${workspaceId}/members`, {
          params: { page, page_size: 20, ...(kind ? { kind } : {}), ...(disabled == null ? {} : { disabled }) },
        })
        .then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useUpdateWorkspaceMember(workspaceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      memberId: string
      access_disabled?: boolean
      agent_zero_role?: boolean
      contribution_brief?: string
      availability_status?: MemberOut['availability_status']
      capacity_level?: MemberOut['capacity_level']
      status_note?: string
      current_commitments?: Array<Record<string, unknown>>
      recent_work?: Array<Record<string, unknown>>
    }) =>
      api.patch<MemberOut>(`/workspaces/${workspaceId}/members/${data.memberId}`, {
        ...(data.access_disabled === undefined ? {} : { access_disabled: data.access_disabled }),
        ...(data.agent_zero_role === undefined ? {} : { agent_zero_role: data.agent_zero_role }),
        ...(data.contribution_brief === undefined ? {} : { contribution_brief: data.contribution_brief }),
        ...(data.availability_status === undefined ? {} : { availability_status: data.availability_status }),
        ...(data.capacity_level === undefined ? {} : { capacity_level: data.capacity_level }),
        ...(data.status_note === undefined ? {} : { status_note: data.status_note }),
        ...(data.current_commitments === undefined ? {} : { current_commitments: data.current_commitments }),
        ...(data.recent_work === undefined ? {} : { recent_work: data.recent_work }),
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] })
      qc.invalidateQueries({ queryKey: ['channel-participants', workspaceId] })
      qc.invalidateQueries({ queryKey: ['channel-participant-list', workspaceId] })
    },
  })
}

export function useResetWorkspaceMemberPassword(workspaceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { memberId: string; new_password: string }) =>
      api
        .post<MemberOut>(`/workspaces/${workspaceId}/members/${data.memberId}/reset-password`, {
          new_password: data.new_password,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] })
    },
  })
}

export interface AddAgentMemberIn {
  display_name: string
  public_key: string
  role: 'operator' | 'owner'
}

export function useAddAgentMember(workspaceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AddAgentMemberIn) =>
      api.post<MemberOut>(`/workspaces/${workspaceId}/members`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] })
    },
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

export function useWorkspaceEmailConfig(workspaceId: string | null) {
  return useQuery<WorkspaceEmailConfig>({
    queryKey: ['workspaces', workspaceId, 'email-config'],
    queryFn: () => api.get(`/workspaces/${workspaceId}/email-config`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useUpdateWorkspaceEmailConfig(workspaceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { resend_api_key?: string | null; clear_resend_api_key?: boolean; email_from?: string | null }) =>
      api.patch<WorkspaceEmailConfig>(`/workspaces/${workspaceId}/email-config`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'email-config'] })
    },
  })
}

export interface WorkspaceGuide {
  guide_md: string | null
  guide_version: number
}

export function useWorkspaceGuide(workspaceId: string | null) {
  return useQuery<WorkspaceGuide>({
    queryKey: ['workspaces', workspaceId, 'guide'],
    queryFn: () => api.get(`/workspaces/${workspaceId}/guide`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useUpdateWorkspaceGuide(workspaceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (guide_md: string) =>
      api.put<WorkspaceGuide>(`/workspaces/${workspaceId}/guide`, { guide_md }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'guide'] })
    },
  })
}

export function useRequestLocalhostSwitchUser(workspaceId: string | null) {
  return useMutation({
    mutationFn: (data: { user_id: string }) =>
      api
        .post<LocalhostSwitchUserResult>(`/auth/localhost/workspaces/${workspaceId}/switch-user-request`, data)
        .then((r) => r.data),
  })
}
