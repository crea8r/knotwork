import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@sdk'

export interface NotifPreferences {
  id: string
  workspace_id: string
  email_enabled: boolean
  email_address: string | null
  telegram_enabled: boolean
  telegram_chat_id: string | null
  whatsapp_enabled: boolean
  whatsapp_number: string | null
  updated_at: string
}

export interface NotifLog {
  id: string
  channel: string
  status: string
  detail: string | null
  sent_at: string
  escalation_id: string | null
}

export function useNotifPreferences(workspaceId: string) {
  return useQuery({
    queryKey: ['notif-prefs', workspaceId],
    queryFn: () =>
      api
        .get<NotifPreferences>(
          `/workspaces/${workspaceId}/notification-preferences`,
        )
        .then((r) => r.data),
    enabled: !!workspaceId,
  })
}

export function useUpdateNotifPreferences(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<NotifPreferences>) =>
      api
        .patch<NotifPreferences>(
          `/workspaces/${workspaceId}/notification-preferences`,
          data,
        )
        .then((r) => r.data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['notif-prefs', workspaceId] }),
  })
}

export function useNotifLog(workspaceId: string) {
  return useQuery({
    queryKey: ['notif-log', workspaceId],
    queryFn: () =>
      api
        .get<NotifLog[]>(`/workspaces/${workspaceId}/notification-log`)
        .then((r) => r.data),
    enabled: !!workspaceId,
  })
}
