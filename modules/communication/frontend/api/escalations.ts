import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Escalation } from '@data-models'
import { api } from '@sdk'

export interface EscalationResolve {
  resolution: 'accept_output' | 'override_output' | 'request_revision' | 'abort_run'
  override_output?: Record<string, unknown>
  guidance?: string
  answers?: string[]       // Q&A escalation: indexed answers per question
  next_branch?: string     // routing escalation: human-chosen branch node ID
  channel_id?: string
  actor_name?: string
  actor_type?: 'human' | 'agent' | 'system'
}

export function useEscalations(workspaceId: string, status?: string) {
  return useQuery({
    queryKey: ['escalations', workspaceId, status],
    queryFn: () => {
      const params = status ? `?status=${status}` : ''
      return api
        .get<Escalation[]>(`/workspaces/${workspaceId}/escalations${params}`)
        .then((r) => r.data)
    },
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })
}

export function useEscalation(workspaceId: string, escalationId: string) {
  return useQuery({
    queryKey: ['escalation', escalationId],
    queryFn: () =>
      api
        .get<Escalation>(`/workspaces/${workspaceId}/escalations/${escalationId}`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!escalationId,
  })
}

export function useResolveEscalation(workspaceId: string, escalationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: EscalationResolve) =>
      api
        .post<Escalation>(
          `/workspaces/${workspaceId}/escalations/${escalationId}/resolve`,
          data,
        )
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalations', workspaceId] })
      qc.invalidateQueries({ queryKey: ['escalation', escalationId] })
    },
  })
}

export function useResolveEscalationAny(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ escalationId, data }: { escalationId: string; data: EscalationResolve }) =>
      api
        .post<Escalation>(
          `/workspaces/${workspaceId}/escalations/${escalationId}/resolve`,
          data,
        )
        .then((r) => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['escalations', workspaceId] })
      qc.invalidateQueries({ queryKey: ['escalation', vars.escalationId] })
    },
  })
}
