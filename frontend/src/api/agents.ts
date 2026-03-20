import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { useAuthStore } from '@/store/auth'
import type { ChannelMessage } from '@/types'

function useWorkspaceId() {
  return useAuthStore((s) => s.workspaceId) ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
}

export type Provider = 'anthropic' | 'openai' | 'openclaw'
export type AgentStatus = 'inactive' | 'active' | 'archived'
export type PreflightStatus = 'never_run' | 'running' | 'pass' | 'warning' | 'fail'

export interface RegisteredAgent {
  id: string
  workspace_id: string
  display_name: string
  avatar_url?: string | null
  bio?: string | null
  provider: Provider
  agent_ref: string
  api_key_hint: string | null
  endpoint: string | null
  is_active: boolean
  status: AgentStatus
  capability_version: string | null
  capability_hash: string | null
  capability_refreshed_at: string | null
  capability_freshness: 'fresh' | 'stale' | 'needs_refresh'
  preflight_status: PreflightStatus
  preflight_run_at: string | null
  last_used_at: string | null
  openclaw_integration_id: string | null
  openclaw_remote_agent_id: string | null
  created_at: string
  updated_at: string
}

export interface RegisteredAgentCreate {
  display_name: string
  avatar_url?: string | null
  provider: Provider
  agent_ref: string
  api_key?: string
  endpoint?: string
  credentials?: {
    type: 'api_key' | 'none'
    api_key?: string
  }
  activate_after_preflight?: boolean
}

export interface RegisteredAgentUpdate {
  display_name?: string
  avatar_url?: string | null
  bio?: string | null
}

export interface AgentConnectivityUpdate {
  endpoint?: string | null
  credentials?: {
    type: 'api_key' | 'none'
    api_key?: string
  }
}

export interface AgentHistoryItem {
  run_id: string
  run_name: string | null
  run_status: string
  run_created_at: string
  started_at: string | null
  completed_at: string | null
  graph_id: string
  graph_name: string
  involved_nodes: string[]
}

export interface CapabilityTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  risk_class: string
}

export interface CapabilityContract {
  agent_id: string
  version: string | null
  hash: string
  refreshed_at: string
  tools: CapabilityTool[]
  constraints: Record<string, unknown>
  policy_notes: string[]
  raw: Record<string, unknown>
}

export interface CapabilitySnapshot extends CapabilityContract {
  id: string
  changed_from_previous: boolean
  source: string
}

export interface CapabilityRefreshResult {
  changed: boolean
  capability: CapabilityContract
}

export interface PreflightTest {
  test_id: string
  tool_name: string | null
  required: boolean
  status: 'pass' | 'fail' | 'warning' | 'skipped'
  latency_ms: number | null
  error_code: string | null
  error_message: string | null
  request_preview: Record<string, unknown>
  response_preview: Record<string, unknown>
}

export interface PreflightRun {
  id: string
  agent_id: string
  status: PreflightStatus
  required_total: number
  required_passed: number
  optional_total: number
  optional_passed: number
  pass_rate: number
  median_latency_ms: number | null
  failed_count: number
  is_baseline: boolean
  started_at: string
  completed_at: string | null
}

export interface PreflightRunDetail extends PreflightRun {
  tests: PreflightTest[]
}

export interface AgentUsageItem {
  type: 'run' | 'workflow'
  run_id: string | null
  workflow_id: string | null
  workflow_name: string | null
  status: string | null
  timestamp: string
}

export interface DebugLinkItem {
  run_id: string
  node_id: string | null
  provider_request_id: string | null
  provider_response_id: string | null
  provider_trace_id: string | null
  created_at: string
}

export interface AgentMainChatAskResponse {
  task_id: string
  status: 'completed' | 'escalated' | 'failed' | 'timeout'
  reply: string | null
  question: string | null
}

export interface AgentMainChatEnsureResponse {
  ready: boolean
  status: 'already_ready' | 'initialized' | 'initializing' | 'timeout'
  task_id: string | null
  session_name: string
  message?: string | null
}

export interface OpenClawHandshakeToken {
  workspace_id: string
  token: string
  expires_at: string
}

export interface OpenClawIntegration {
  id: string
  workspace_id: string
  plugin_instance_id: string
  openclaw_workspace_id: string | null
  plugin_version: string | null
  status: string
  connected_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
}

export interface OpenClawIntegrationDeleteResult {
  integration_id: string
  plugin_instance_id: string
  archived_registered_agent_count: number
}

export interface OpenClawRemoteAgent {
  id: string
  workspace_id: string
  integration_id: string
  remote_agent_id: string
  slug: string
  display_name: string
  description?: string | null
  tools: Array<Record<string, unknown>>
  constraints: Record<string, unknown>
  is_active: boolean
  last_synced_at: string
}

export interface OpenClawIntegrationDebugState {
  integration_id: string
  plugin_instance_id: string
  status: string
  connected_at: string
  last_seen_at: string
  pending_count: number
  claimed_count: number
  completed_count: number
  failed_count: number
  escalated_count: number
  latest_task_created_at: string | null
  oldest_pending_task_at: string | null
}

export interface OpenClawTaskDebugItem {
  task_id: string
  integration_id: string
  status: string
  node_id: string
  run_id: string | null
  agent_ref: string
  created_at: string
  claimed_at: string | null
  completed_at: string | null
  failed_at: string | null
  updated_at: string
  error_message: string | null
  event_count: number
  latest_event_at: string | null
}

export interface OpenClawDebugState {
  workspace_id: string
  now_utc: string
  integrations: OpenClawIntegrationDebugState[]
  recent_tasks: OpenClawTaskDebugItem[]
}

function invalidateAgentQueries(qc: ReturnType<typeof useQueryClient>, agentId?: string) {
  const workspaceId = useAuthStore.getState().workspaceId ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
  qc.invalidateQueries({ queryKey: ['agents', workspaceId] })
  if (agentId) {
    qc.invalidateQueries({ queryKey: ['agent', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-history', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-usage', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-capability-latest', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-capabilities', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-preflight-runs', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-debug-links', workspaceId, agentId] })
  }
}

export function useRegisteredAgents(filters?: {
  q?: string
  provider?: string
  status?: string
  preflight_status?: string
}) {
  const workspaceId = useWorkspaceId()
  return useQuery<RegisteredAgent[]>({
    queryKey: ['agents', workspaceId, filters?.q ?? '', filters?.provider ?? '', filters?.status ?? '', filters?.preflight_status ?? ''],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents`, { params: filters })
      return data
    },
  })
}

export function useCreateAgent() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: RegisteredAgentCreate) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents`, payload)
      return data as RegisteredAgent
    },
    onSuccess: (created) => invalidateAgentQueries(qc, created.id),
  })
}

export function useAgent(agentId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<RegisteredAgent>({
    queryKey: ['agent', workspaceId, agentId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}`)
      return data
    },
    enabled: !!agentId,
  })
}

export function useUpdateAgent(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: RegisteredAgentUpdate) => {
      const { data } = await api.patch(`/workspaces/${workspaceId}/agents/${agentId}`, payload)
      return data as RegisteredAgent
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useUpdateAgentConnectivity(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: AgentConnectivityUpdate) => {
      const { data } = await api.patch(`/workspaces/${workspaceId}/agents/${agentId}/connectivity`, payload)
      return data as RegisteredAgent
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useActivateAgent(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { allow_warning?: boolean } = {}) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/activate`, payload)
      return data as RegisteredAgent
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useDeactivateAgent(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { reason?: string } = {}) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/deactivate`, payload)
      return data as RegisteredAgent
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useArchiveAgent(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { reason?: string } = {}) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/archive`, payload)
      return data as RegisteredAgent
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useRefreshCapabilities(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { save_snapshot?: boolean } = { save_snapshot: true }) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/capabilities/refresh`, payload)
      return data as CapabilityRefreshResult
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useAgentCapabilityLatest(agentId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<CapabilityContract>({
    queryKey: ['agent-capability-latest', workspaceId, agentId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}/capabilities/latest`)
      return data
    },
    enabled: !!agentId,
  })
}

export function useAgentCapabilities(agentId: string, limit = 20) {
  const workspaceId = useWorkspaceId()
  return useQuery<CapabilitySnapshot[]>({
    queryKey: ['agent-capabilities', workspaceId, agentId, limit],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}/capabilities`, { params: { limit } })
      return data
    },
    enabled: !!agentId,
  })
}

export function useRunPreflight(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { suite?: string; include_optional?: boolean } = {}) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/preflight-runs`, {
        suite: payload.suite ?? 'default',
        include_optional: payload.include_optional ?? false,
      })
      return data as PreflightRunDetail
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useAgentPreflightRuns(agentId: string, limit = 20) {
  const workspaceId = useWorkspaceId()
  return useQuery<PreflightRun[]>({
    queryKey: ['agent-preflight-runs', workspaceId, agentId, limit],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}/preflight-runs`, { params: { limit } })
      return data
    },
    enabled: !!agentId,
  })
}

export function usePromotePreflightBaseline(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (preflightRunId: string) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/preflight-runs/${preflightRunId}/promote-baseline`)
      return data as PreflightRun
    },
    onSuccess: () => invalidateAgentQueries(qc, agentId),
  })
}

export function useAgentHistory(agentId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<AgentHistoryItem[]>({
    queryKey: ['agent-history', workspaceId, agentId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}/history`)
      return data
    },
    enabled: !!agentId,
  })
}

export function useAgentUsage(agentId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<AgentUsageItem[]>({
    queryKey: ['agent-usage', workspaceId, agentId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}/usage`)
      return data
    },
    enabled: !!agentId,
  })
}

export function useAgentDebugLinks(agentId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<DebugLinkItem[]>({
    queryKey: ['agent-debug-links', workspaceId, agentId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}/debug-links`)
      return data
    },
    enabled: !!agentId,
  })
}

export function useDeleteAgent() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (agentId: string) => {
      await api.delete(`/workspaces/${workspaceId}/agents/${agentId}`)
    },
    onSuccess: () => invalidateAgentQueries(qc),
  })
}

export function useAgentMainChatMessages(agentId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<ChannelMessage[]>({
    queryKey: ['agent-main-chat-messages', workspaceId, agentId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/agents/${agentId}/main-chat/messages`)
      return data
    },
    enabled: !!agentId,
    refetchInterval: 4_000,
  })
}

export interface ChatAttachmentRef {
  key: string
  url: string
  filename: string
  mime_type: string
  size: number
}

export function useAskAgentMainChat(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { message: string; attachments?: ChatAttachmentRef[] }) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/main-chat/ask`, payload)
      return data as AgentMainChatAskResponse
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-main-chat-messages', workspaceId, agentId] })
      invalidateAgentQueries(qc, agentId)
    },
  })
}

export function useEnsureAgentMainChat(agentId: string) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/main-chat/ensure`)
      return data as AgentMainChatEnsureResponse
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-main-chat-messages', workspaceId, agentId] })
    },
  })
}

export function useCreateOpenClawHandshakeToken() {
  const workspaceId = useWorkspaceId()
  return useMutation({
    mutationFn: async (payload?: { ttl_minutes?: number }) => {
      const body = payload?.ttl_minutes ? { ttl_minutes: payload.ttl_minutes } : {}
      const { data } = await api.post(`/workspaces/${workspaceId}/openclaw/handshake-token`, body)
      return data as OpenClawHandshakeToken
    },
  })
}

export function useOpenClawIntegrations() {
  const workspaceId = useWorkspaceId()
  return useQuery<OpenClawIntegration[]>({
    queryKey: ['openclaw-integrations', workspaceId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/openclaw/integrations`)
      return data
    },
  })
}

export function useDeleteOpenClawIntegration() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (integrationId: string) => {
      const { data } = await api.delete(`/workspaces/${workspaceId}/openclaw/integrations/${integrationId}`)
      return data as OpenClawIntegrationDeleteResult
    },
    onSuccess: (_, integrationId) => {
      invalidateAgentQueries(qc)
      qc.invalidateQueries({ queryKey: ['openclaw-integrations', workspaceId] })
      qc.invalidateQueries({ queryKey: ['openclaw-debug-state', workspaceId] })
      qc.invalidateQueries({ queryKey: ['openclaw-remote-agents', workspaceId, integrationId] })
    },
  })
}

export function useOpenClawDebugState() {
  const workspaceId = useWorkspaceId()
  return useQuery<OpenClawDebugState>({
    queryKey: ['openclaw-debug-state', workspaceId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/openclaw/debug-state`)
      return data
    },
    refetchInterval: 5_000,
  })
}

export function useOpenClawRemoteAgents(integrationId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery<OpenClawRemoteAgent[]>({
    queryKey: ['openclaw-remote-agents', workspaceId, integrationId],
    queryFn: async () => {
      const { data } = await api.get(`/workspaces/${workspaceId}/openclaw/integrations/${integrationId}/agents`)
      return data
    },
    enabled: !!integrationId,
  })
}

export function useRegisterOpenClawRemoteAgent() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { integration_id: string; remote_agent_id: string; display_name?: string }) => {
      const { data } = await api.post(`/workspaces/${workspaceId}/openclaw/register-agent`, payload)
      return data as { registered_agent_id: string; display_name: string; agent_ref: string; provider: 'openclaw' }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', workspaceId] })
      qc.invalidateQueries({ queryKey: ['openclaw-integrations', workspaceId] })
    },
  })
}
