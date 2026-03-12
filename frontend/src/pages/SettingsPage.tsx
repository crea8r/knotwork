import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import MockWrap from '@/components/shared/MockWrap'
import Spinner from '@/components/shared/Spinner'
import AgentsTab from '@/components/settings/AgentsTab'
import MembersTab from '@/components/settings/MembersTab'
import AccountTab from '@/components/settings/AccountTab'
import { MOCK_WORKSPACE } from '@/mocks'
import { useNotifPreferences, useUpdateNotifPreferences, useNotifLog } from '@/api/notifications'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

type Tab = 'account' | 'workspace' | 'members' | 'agents' | 'notifications'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        readOnly
        value={value}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700"
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-brand-500' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

const LOG_STATUS: Record<string, string> = {
  sent: 'text-green-600',
  failed: 'text-red-600',
  skipped: 'text-gray-400',
}

function NotificationsTab() {
  const { data: prefs, isLoading } = useNotifPreferences(DEV_WORKSPACE)
  const { data: log } = useNotifLog(DEV_WORKSPACE)
  const update = useUpdateNotifPreferences(DEV_WORKSPACE)

  if (isLoading) return <Spinner />
  if (!prefs) return null

  const patch = (field: string, value: boolean) =>
    update.mutate({ [field]: value })

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <p className="text-sm font-medium text-gray-700 mb-4">Channels</p>
        <Toggle
          label="Email notifications"
          checked={prefs.email_enabled}
          onChange={(v) => patch('email_enabled', v)}
        />
        {prefs.email_enabled && (
          <p className="text-xs text-gray-400 px-0 pb-2">
            Sending to: {prefs.email_address ?? '(no address configured)'}
          </p>
        )}
        <Toggle
          label="Telegram"
          checked={prefs.telegram_enabled}
          onChange={(v) => patch('telegram_enabled', v)}
        />
        {prefs.telegram_enabled && (
          <p className="text-xs text-gray-400 pb-2">
            Chat ID: {prefs.telegram_chat_id ?? '(not configured)'}
          </p>
        )}
        <Toggle
          label="WhatsApp (deep link)"
          checked={prefs.whatsapp_enabled}
          onChange={(v) => patch('whatsapp_enabled', v)}
        />
        {prefs.whatsapp_enabled && (
          <p className="text-xs text-gray-400 pb-2">
            Number: {prefs.whatsapp_number ?? '(not configured)'}
          </p>
        )}
      </Card>

      {log && log.length > 0 && (
        <Card className="overflow-hidden">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 py-3 border-b">
            Notification log
          </p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {log.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2 text-gray-500 capitalize">{entry.channel}</td>
                  <td className={`px-4 py-2 font-medium ${LOG_STATUS[entry.status] ?? ''}`}>
                    {entry.status}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-xs">
                    {entry.detail ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(entry.sent_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as Tab | null
  const TABS: Tab[] = ['account', 'workspace', 'members', 'agents', 'notifications']
  const initialTab: Tab = TABS.includes(tabFromUrl as Tab) ? (tabFromUrl as Tab) : 'account'
  const [tab, setTab] = useState<Tab>(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader title="Settings" />

      <div className="flex gap-4 border-b mb-6 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              setSearchParams({ tab: t })
            }}
            className={`pb-2 capitalize ${
              tab === t
                ? 'border-b-2 border-brand-500 text-brand-600 font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountTab />}

      {tab === 'workspace' && (
        <MockWrap label="settings S8">
          <Card className="p-6 space-y-4">
            <Field label="Workspace name" value={MOCK_WORKSPACE.name} />
            <Field label="Slug" value={MOCK_WORKSPACE.slug} />
            <Field label="Plan" value={MOCK_WORKSPACE.plan} />
          </Card>
        </MockWrap>
      )}

      {tab === 'members' && <MembersTab />}

      {tab === 'agents' && <AgentsTab />}

      {tab === 'notifications' && <NotificationsTab />}
    </div>
  )
}
