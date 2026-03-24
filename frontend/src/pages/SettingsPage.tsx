import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import AgentsTab from '@/components/settings/AgentsTab'
import MembersTab from '@/components/settings/MembersTab'
import AccountTab from '@/components/settings/AccountTab'
import SystemTab from '@/components/settings/SystemTab'

type Tab = 'account' | 'members' | 'agents' | 'system'

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as Tab | null
  const TABS: Tab[] = ['account', 'members', 'agents', 'system']
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

      {tab === 'members' && <MembersTab />}

      {tab === 'agents' && <AgentsTab />}

      {tab === 'system' && <SystemTab />}
    </div>
  )
}
