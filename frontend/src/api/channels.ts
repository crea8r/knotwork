import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Channel,
  ChannelAssetBinding,
  ChannelMessage,
  ChannelSubscription,
  DecisionEvent,
  InboxItem,
  InboxSummary,
  ParticipantDeliveryPreference,
  ParticipantDeliveryPreferenceBundle,
  ParticipantMentionOption,
} from '@/types'
import { api } from './client'

export function useInbox(workspaceId: string, archived = false) {
  return useQuery({
    queryKey: ['inbox', workspaceId, archived],
    queryFn: () =>
      api.get<InboxItem[]>(`/workspaces/${workspaceId}/inbox`, { params: { archived } }).then((r) => r.data),
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })
}

export function useInboxSummary(workspaceId: string) {
  return useQuery({
    queryKey: ['inbox-summary', workspaceId],
    queryFn: () => api.get<InboxSummary>(`/workspaces/${workspaceId}/inbox/summary`).then((r) => r.data),
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })
}

export function useUpdateInboxDelivery(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { deliveryId: string; archived?: boolean; read?: boolean }) =>
      api
        .patch<InboxItem>(`/workspaces/${workspaceId}/inbox/deliveries/${payload.deliveryId}`, {
          archived: payload.archived,
          read: payload.read,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox', workspaceId] })
      qc.invalidateQueries({ queryKey: ['inbox-summary', workspaceId] })
    },
  })
}

export function useMarkAllInboxRead(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<InboxSummary>(`/workspaces/${workspaceId}/inbox/read-all`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox', workspaceId] })
      qc.invalidateQueries({ queryKey: ['inbox-summary', workspaceId] })
    },
  })
}

export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: () => api.get<Channel[]>(`/workspaces/${workspaceId}/channels`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useChannel(workspaceId: string, channelId: string) {
  return useQuery({
    queryKey: ['channel', workspaceId, channelId],
    queryFn: () => api.get<Channel>(`/workspaces/${workspaceId}/channels/${channelId}`).then((r) => r.data),
    enabled: !!workspaceId && !!channelId,
  })
}

export function useAssetChatChannel(
  workspaceId: string,
  assetType: 'file' | 'folder' | 'workflow',
  params: { path?: string | null; asset_id?: string | null; project_id?: string | null },
) {
  const path = params.path ?? undefined
  const assetId = params.asset_id ?? undefined
  const projectId = params.project_id ?? undefined
  return useQuery({
    queryKey: ['asset-chat-channel', workspaceId, assetType, path ?? null, assetId ?? null, projectId ?? null],
    queryFn: () =>
      api.get<Channel>(`/workspaces/${workspaceId}/channels/asset-chat/resolve`, {
        params: {
          asset_type: assetType,
          path,
          asset_id: assetId,
          project_id: projectId,
        },
      }).then((r) => r.data),
    enabled: !!workspaceId && (assetType === 'folder' || !!path || !!assetId),
  })
}

export function useChannelParticipants(workspaceId: string) {
  return useQuery({
    queryKey: ['channel-participants', workspaceId],
    queryFn: () =>
      api
        .get<ParticipantMentionOption[]>(`/workspaces/${workspaceId}/participants`)
        .then((r) => r.data),
    enabled: !!workspaceId,
    staleTime: 60_000,
  })
}

export function useMyChannelSubscriptions(workspaceId: string) {
  return useQuery({
    queryKey: ['channel-subscriptions', workspaceId],
    queryFn: () =>
      api.get<ChannelSubscription[]>(`/workspaces/${workspaceId}/channels/subscriptions/me`).then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useUpdateMyChannelSubscription(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { channelId: string; subscribed: boolean }) =>
      api
        .patch<ChannelSubscription>(`/workspaces/${workspaceId}/channels/${payload.channelId}/subscription`, {
          subscribed: payload.subscribed,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-subscriptions', workspaceId] })
    },
  })
}

export function useParticipantDeliveryPreferences(workspaceId: string, participantId: string) {
  return useQuery({
    queryKey: ['participant-delivery-preferences', workspaceId, participantId],
    queryFn: () =>
      api
        .get<ParticipantDeliveryPreferenceBundle>(
          `/workspaces/${workspaceId}/participants/${encodeURIComponent(participantId)}/delivery-preferences`,
        )
        .then((r) => r.data),
    enabled: !!workspaceId && !!participantId,
  })
}

export function useUpdateParticipantDeliveryPreference(workspaceId: string, participantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      eventType: string
      app_enabled?: boolean
      email_enabled?: boolean
      push_enabled?: boolean
      email_address?: string | null
    }) =>
      api
        .patch<ParticipantDeliveryPreference>(
          `/workspaces/${workspaceId}/participants/${encodeURIComponent(participantId)}/delivery-preferences/${payload.eventType}`,
          payload,
        )
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participant-delivery-preferences', workspaceId, participantId] })
    },
  })
}

export function useCreateChannel(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { name: string; channel_type?: 'normal' | 'workflow' | 'handbook'; graph_id?: string; project_id?: string; objective_id?: string }) =>
      api.post<Channel>(`/workspaces/${workspaceId}/channels`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels', workspaceId] })
      qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-channels', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-dashboard', workspaceId] })
    },
  })
}

export function useUpdateChannel(workspaceId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { name?: string; archived?: boolean }) =>
      api.patch<Channel>(`/workspaces/${workspaceId}/channels/${channelId}`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel', workspaceId] })
      qc.invalidateQueries({ queryKey: ['channels', workspaceId] })
      qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
      qc.invalidateQueries({ queryKey: ['project-channels', workspaceId] })
    },
  })
}

export function useChannelAssets(workspaceId: string, channelId: string) {
  return useQuery({
    queryKey: ['channel-assets', workspaceId, channelId],
    queryFn: () =>
      api
        .get<ChannelAssetBinding[]>(`/workspaces/${workspaceId}/channels/${channelId}/assets`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!channelId,
  })
}

export function useAttachChannelAsset(workspaceId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { asset_type: 'workflow' | 'run' | 'file' | 'folder'; asset_id: string }) =>
      api
        .post<ChannelAssetBinding>(`/workspaces/${workspaceId}/channels/${channelId}/assets`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-assets', workspaceId, channelId] })
      qc.invalidateQueries({ queryKey: ['channel-messages', workspaceId, channelId] })
    },
  })
}

export function useDetachChannelAsset(workspaceId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (bindingId: string) =>
      api.delete(`/workspaces/${workspaceId}/channels/${channelId}/assets/${bindingId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-assets', workspaceId, channelId] })
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
