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
        .get<Escalation[]>(`/workspaces/${workspaceId}/runs/escalations${params}`)
        .then((r) => r.data)
    },
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })
}

export function useRunEscalations(workspaceId: string, runId: string, status?: string) {
  return useQuery({
    queryKey: ['run-escalations', workspaceId, runId, status],
    queryFn: () => {
      const params = status ? `?status=${status}` : ''
      return api
        .get<Escalation[]>(`/workspaces/${workspaceId}/runs/${runId}/escalations${params}`)
        .then((r) => r.data)
    },
    enabled: !!workspaceId && !!runId,
    refetchInterval: 10_000,
  })
}

export function useEscalation(workspaceId: string, runId: string, escalationId: string) {
  return useQuery({
    queryKey: ['escalation', runId, escalationId],
    queryFn: () =>
      api
        .get<Escalation>(`/workspaces/${workspaceId}/runs/${runId}/escalations/${escalationId}`)
        .then((r) => r.data),
    enabled: !!workspaceId && !!runId && !!escalationId,
  })
}

export function useResolveEscalation(workspaceId: string, runId: string, escalationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: EscalationResolve) =>
      api
        .post<Escalation>(
          `/workspaces/${workspaceId}/runs/${runId}/escalations/${escalationId}/resolve`,
          data,
        )
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalations', workspaceId] })
      qc.invalidateQueries({ queryKey: ['run-escalations', workspaceId, runId] })
      qc.invalidateQueries({ queryKey: ['escalation', runId, escalationId] })
    },
  })
}

export function useResolveEscalationAny(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, escalationId, data }: { runId: string; escalationId: string; data: EscalationResolve }) =>
      api
        .post<Escalation>(
          `/workspaces/${workspaceId}/runs/${runId}/escalations/${escalationId}/resolve`,
          data,
        )
        .then((r) => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['escalations', workspaceId] })
      qc.invalidateQueries({ queryKey: ['run-escalations', workspaceId, vars.runId] })
      qc.invalidateQueries({ queryKey: ['escalation', vars.runId, vars.escalationId] })
    },
  })
}
