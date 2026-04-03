import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { useAuthStore } from '@/store/auth'

function useWorkspaceId() {
  return useAuthStore((s) => s.workspaceId) ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
}

export type Provider = 'anthropic' | 'openai'
export type AgentStatus = 'inactive' | 'active' | 'archived'

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
  last_used_at: string | null
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



function invalidateAgentQueries(qc: ReturnType<typeof useQueryClient>, agentId?: string) {
  const workspaceId = useAuthStore.getState().workspaceId ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
  qc.invalidateQueries({ queryKey: ['agents', workspaceId] })
  if (agentId) {
    qc.invalidateQueries({ queryKey: ['agent', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-history', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-usage', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-capability-latest', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-capabilities', workspaceId, agentId] })
    qc.invalidateQueries({ queryKey: ['agent-debug-links', workspaceId, agentId] })
  }
}

export function useRegisteredAgents(filters?: {
  q?: string
  provider?: string
  status?: string
}) {
  const workspaceId = useWorkspaceId()
  return useQuery<RegisteredAgent[]>({
    queryKey: ['agents', workspaceId, filters?.q ?? '', filters?.provider ?? '', filters?.status ?? ''],
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
    mutationFn: async () => {
      const { data } = await api.post(`/workspaces/${workspaceId}/agents/${agentId}/activate`, {})
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


