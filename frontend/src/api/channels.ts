import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Channel, ChannelMessage, DecisionEvent, InboxItem } from '@/types'
import { api } from './client'

export function useInbox(workspaceId: string) {
  return useQuery({
    queryKey: ['inbox', workspaceId],
    queryFn: () => api.get<InboxItem[]>(`/workspaces/${workspaceId}/inbox`).then((r) => r.data),
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })
}

export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: () => api.get<Channel[]>(`/workspaces/${workspaceId}/channels`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useCreateChannel(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { name: string; channel_type?: 'normal' | 'workflow' | 'handbook'; graph_id?: string }) =>
      api.post<Channel>(`/workspaces/${workspaceId}/channels`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels', workspaceId] })
    },
  })
}

export function useChannelMessages(workspaceId: string, channelId: string) {
  return useQuery({
    queryKey: ['channel-messages', workspaceId, channelId],
    queryFn: () =>
      api
        .get<ChannelMessage[]>(`/workspaces/${workspaceId}/channels/${channelId}/messages`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!channelId,
    refetchInterval: 5_000,
  })
}

export function usePostChannelMessage(workspaceId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      role?: 'user' | 'assistant' | 'system'
      author_type?: 'human' | 'agent' | 'system'
      author_name?: string
      content: string
      run_id?: string
      node_id?: string
      metadata?: Record<string, unknown>
    }) => api.post<ChannelMessage>(`/workspaces/${workspaceId}/channels/${channelId}/messages`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-messages', workspaceId, channelId] })
    },
  })
}

export function useChannelDecisions(workspaceId: string, channelId: string) {
  return useQuery({
    queryKey: ['channel-decisions', workspaceId, channelId],
    queryFn: () =>
      api
        .get<DecisionEvent[]>(`/workspaces/${workspaceId}/channels/${channelId}/decisions`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!channelId,
    refetchInterval: 5_000,
  })
}

export function useCreateChannelDecision(workspaceId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      decision_type: string
      actor_type?: 'human' | 'agent' | 'system'
      actor_name?: string
      run_id?: string
      escalation_id?: string
      payload?: Record<string, unknown>
    }) => api.post<DecisionEvent>(`/workspaces/${workspaceId}/channels/${channelId}/decisions`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-decisions', workspaceId, channelId] })
    },
  })
}

export function useAskHandbookChat(workspaceId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { message: string }) =>
      api.post<{ reply: string; proposal_id: string | null }>(
        `/workspaces/${workspaceId}/channels/${channelId}/handbook/ask`,
        payload,
      ).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-messages', workspaceId, channelId] })
      qc.invalidateQueries({ queryKey: ['channel-decisions', workspaceId, channelId] })
      qc.invalidateQueries({ queryKey: ['knowledge', import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'] })
    },
  })
}

export function useResolveHandbookProposal(workspaceId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      proposalId: string
      resolution: 'accept_output' | 'override_output' | 'abort_run'
      final_content?: string
    }) =>
      api.post<{ status: string; proposal_id: string }>(
        `/workspaces/${workspaceId}/channels/${channelId}/handbook/proposals/${payload.proposalId}/resolve`,
        { resolution: payload.resolution, final_content: payload.final_content },
      ).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-messages', workspaceId, channelId] })
      qc.invalidateQueries({ queryKey: ['channel-decisions', workspaceId, channelId] })
      qc.invalidateQueries({ queryKey: ['knowledge', import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'] })
    },
  })
}
