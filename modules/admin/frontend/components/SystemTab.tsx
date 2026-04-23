/**
 * SystemTab — shows version alignment across backend, schema, and worker.
 * Operators use this to confirm all components are in sync after an update.
 */
import { useEffect, useState } from 'react'
import { CheckCircle, ChevronDown, ChevronRight, HelpCircle, RefreshCw, XCircle } from 'lucide-react'
import { useAuthStore } from '@auth'
import { useWorkspaceEmailConfig, useUpdateWorkspaceEmailConfig } from "@modules/admin/frontend/api/auth"
import {
  useChannelParticipants,
  useParticipantDeliveryPreferences,
  useUpdateParticipantDeliveryPreference,
} from '@modules/communication/frontend/api/channels'
import { useHealthStatus } from "@core-api/health"

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CheckCircle size={14} className="text-green-500 shrink-0" />
  if (ok === false) return <XCircle size={14} className="text-red-500 shrink-0" />
  return <HelpCircle size={14} className="text-gray-400 shrink-0" />
}

function Row({ label, value, ok, uiName = 'admin.system.status.row' }: { label: string; value: string; ok?: boolean | null; uiName?: string }) {
  return (
    <div data-ui={uiName} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span data-ui={`${uiName}.label`} className="text-sm text-gray-500">{label}</span>
      <div data-ui={`${uiName}.value`} className="flex items-center gap-1.5">
        {ok !== undefined && <StatusIcon ok={ok} />}
        <span className="text-sm font-mono text-gray-800">{value}</span>
      </div>
    </div>
  )
}

export default function SystemTab() {
  const workspaceId = useAuthStore((s) => s.workspaceId)
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const isOwner = role === 'owner'
  const { data: health, isLoading, refetch } = useHealthStatus()
  const { data: emailConfig, isLoading: loadingEmailConfig } = useWorkspaceEmailConfig(workspaceId)
  const updateEmailConfig = useUpdateWorkspaceEmailConfig(workspaceId)
  const { data: participants = [] } = useChannelParticipants(workspaceId ?? '')
  const [resendApiKey, setResendApiKey] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [saved, setSaved] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)
  const currentParticipantId = user?.id ? `human:${user.id}` : ''
  const [selectedParticipantId, setSelectedParticipantId] = useState('')
  const effectiveParticipantId = isOwner
    ? (selectedParticipantId || currentParticipantId)
    : currentParticipantId
  const { data: participantPrefs } = useParticipantDeliveryPreferences(workspaceId ?? '', effectiveParticipantId)
  const updateParticipantPreference = useUpdateParticipantDeliveryPreference(workspaceId ?? '', effectiveParticipantId)

  useEffect(() => {
    setEmailFrom(emailConfig?.email_from ?? '')
  }, [emailConfig?.email_from])

  useEffect(() => {
    if (!selectedParticipantId && currentParticipantId) {
      setSelectedParticipantId(currentParticipantId)
    }
  }, [currentParticipantId, selectedParticipantId])

  const submitEmailConfig = (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(false)
    updateEmailConfig.mutate(
      {
        resend_api_key: resendApiKey.trim() ? resendApiKey.trim() : undefined,
        email_from: emailFrom.trim() ? emailFrom.trim() : '',
      },
      {
        onSuccess: () => {
          setResendApiKey('')
          setSaved(true)
        },
      },
    )
  }

  const clearEmailConfig = () => {
    setSaved(false)
    updateEmailConfig.mutate(
      { clear_resend_api_key: true },
      {
        onSuccess: () => {
          setResendApiKey('')
          setSaved(true)
        },
      },
    )
  }

  const toggleParticipantMean = (
    eventType: string,
    field: 'app_enabled' | 'email_enabled',
    value: boolean,
  ) => {
    updateParticipantPreference.mutate({
      eventType,
      [field]: value,
    })
  }

  if (isLoading) {
    return <p data-ui="admin.system.loading" className="text-sm text-gray-500">Loading system status…</p>
  }

  if (!health) {
    return <p data-ui="admin.system.error" className="text-sm text-red-600">Backend unreachable — could not load system status.</p>
  }

  const workerAlive = health.worker?.alive
  const workerAgo = health.worker?.last_seen_seconds_ago
  const workerLabel = workerAlive
    ? `Running (heartbeat ${workerAgo ?? '?'}s ago)`
    : workerAlive === null
    ? 'Unknown (Redis unreachable)'
    : workerAgo != null
    ? `Not running (last seen ${workerAgo}s ago)`
    : 'Not running'

  return (
    <div data-ui="admin.system.tab" className="space-y-6">
      <div data-ui="admin.system.header" className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">System Status</h3>
        <button
          onClick={() => refetch()}
          data-ui="admin.system.refresh"
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div data-ui="admin.system.status" className="rounded-lg border border-gray-200 bg-white px-4 divide-y divide-gray-100">
        <Row label="API version" value={health.version} uiName="admin.system.status.api-version" />
        <Row label="Schema version" value={health.schema_version} uiName="admin.system.status.schema-version" />
        <Row label="Installation ID" value={health.installation_id?.slice(0, 8) + '…'} uiName="admin.system.status.installation-id" />
        <Row
          label="Background worker"
          value={workerLabel}
          ok={workerAlive === null ? null : workerAlive}
          uiName="admin.system.status.worker"
        />
      </div>

      <div data-ui="admin.system.email">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Workspace Email</h3>
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
          {loadingEmailConfig ? (
            <p data-ui="admin.system.email.loading" className="text-sm text-gray-500">Loading workspace email config…</p>
          ) : (
            <>
              <div data-ui="admin.system.email.status" className="text-xs text-gray-500">
                Status:{' '}
                {emailConfig?.enabled ? (
                  <span className="text-green-700 font-medium">enabled</span>
                ) : (
                  <span className="text-amber-700 font-medium">not configured</span>
                )}
                {emailConfig?.email_from ? ` · from ${emailConfig.email_from}` : ''}
              </div>

              {isOwner ? (
                <form data-ui="admin.system.email.form" onSubmit={submitEmailConfig} className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Resend API key</label>
                    <input
                      type="password"
                      placeholder={emailConfig?.has_resend_api_key ? 'Saved key present. Enter a new key to replace it.' : 're_...'}
                      value={resendApiKey}
                      onChange={(e) => { setResendApiKey(e.target.value); setSaved(false) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">From address</label>
                    <input
                      type="text"
                      placeholder="noreply@example.com"
                      value={emailFrom}
                      onChange={(e) => { setEmailFrom(e.target.value); setSaved(false) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div data-ui="admin.system.email.actions" className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={updateEmailConfig.isPending}
                      data-ui="admin.system.email.save"
                      className="bg-brand-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 transition-colors"
                    >
                      {updateEmailConfig.isPending ? 'Saving…' : 'Save email config'}
                    </button>
                    {emailConfig?.has_resend_api_key && (
                      <button
                        type="button"
                        onClick={clearEmailConfig}
                        disabled={updateEmailConfig.isPending}
                        data-ui="admin.system.email.clear-key"
                        className="text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
                      >
                        Clear key
                      </button>
                    )}
                    {saved && <span className="text-sm text-green-600">✓ Saved</span>}
                    {updateEmailConfig.isError && (
                      <span className="text-sm text-red-600">Failed to save config</span>
                    )}
                  </div>
                </form>
              ) : (
                <p className="text-sm text-gray-500">Only owners can update workspace email configuration.</p>
              )}
            </>
          )}
        </div>
      </div>

      <div data-ui="admin.system.notification-policy">
        <button
          type="button"
          onClick={() => setPolicyOpen((open) => !open)}
          data-ui="admin.system.notification-policy.toggle"
          className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-left"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Notification Policy</h3>
              <p className="text-xs text-gray-500 mt-1">
                Current rules for how channel events become app/email/plugin deliveries.
              </p>
            </div>
            {policyOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </div>
        </button>
        {policyOpen && (
          <div data-ui="admin.system.notification-policy.content" className="mt-3 rounded-lg border border-gray-200 bg-white p-4 space-y-3 text-sm text-gray-600">
            <p>
              This system does not have a no-code notification policy editor yet. The rules below are the current built-in behavior.
            </p>
            <div>
              <p className="font-medium text-gray-700">Immediate email-eligible events</p>
              <p className="text-xs text-gray-500 mt-1">
                `escalation_created`, `mentioned_message`, `run_failed`, `task_assigned`
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Events that stay app-only by default</p>
              <p className="text-xs text-gray-500 mt-1">
                `run_completed` and `message_posted`
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Email throttling</p>
              <p className="text-xs text-gray-500 mt-1">
                Email is throttled for 15 minutes per participant, event type, and channel to reduce mailbox flood.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Escalation recipient rule</p>
              <p className="text-xs text-gray-500 mt-1">
                Addressed escalation goes only to its target participant. Unaddressed escalation first goes to subscribed humans in the relevant channel, then falls back to workspace humans only if needed.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-700">How to change policy today</p>
              <p className="text-xs text-gray-500 mt-1">
                Change the built-in rules in the backend notification service. This software exposes delivery preferences per participant, but not a no-code policy builder yet.
              </p>
            </div>
          </div>
        )}
      </div>

      <div data-ui="admin.system.participant-delivery">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Participant Delivery</h3>
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
          {isOwner && participants.length > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Participant</label>
              <select
                value={effectiveParticipantId}
                onChange={(e) => setSelectedParticipantId(e.target.value)}
                data-ui="admin.system.participant-delivery.select"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {participants.map((participant) => (
                  <option key={participant.participant_id} value={participant.participant_id}>
                    {participant.display_name} ({participant.kind})
                  </option>
                ))}
              </select>
            </div>
          )}

          {!participantPrefs ? (
            <p data-ui="admin.system.participant-delivery.loading" className="text-sm text-gray-500">Loading participant delivery preferences…</p>
          ) : (
            <>
              <div className="text-xs text-gray-500">
                Editing delivery for <span className="font-medium text-gray-700">{participantPrefs.display_name}</span>.
              </div>
              <div data-ui="admin.system.participant-delivery.table-wrap" className="overflow-x-auto">
                <table data-ui="admin.system.participant-delivery.table" className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b">
                      <th className="text-left py-2">Event</th>
                      <th className="text-center py-2">App</th>
                      <th className="text-center py-2">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participantPrefs.event_types.map((pref) => (
                      <tr key={pref.event_type} className="border-b last:border-b-0">
                        <td className="py-2 text-gray-700">{pref.event_type.replace(/_/g, ' ')}</td>
                        <td className="py-2 text-center">
                          <input
                            type="checkbox"
                            checked={pref.app_enabled}
                            disabled={participantPrefs.kind !== 'human'}
                            data-ui="admin.system.participant-delivery.app-toggle"
                            onChange={(e) => toggleParticipantMean(pref.event_type, 'app_enabled', e.target.checked)}
                          />
                        </td>
                        <td className="py-2 text-center">
                          <input
                            type="checkbox"
                            checked={pref.email_enabled}
                            data-ui="admin.system.participant-delivery.email-toggle"
                            onChange={(e) => toggleParticipantMean(pref.event_type, 'email_enabled', e.target.checked)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400">
                App is the default inbox path for humans. Email depends on workspace mail configuration.
              </p>
            </>
          )}
        </div>
      </div>

    </div>
  )
}
