import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '@ui/components/PageHeader'
import Btn from '@ui/components/Btn'
import MembersTab from '@modules/admin/frontend/components/MembersTab'
import AccountTab from '@modules/admin/frontend/components/AccountTab'
import ChannelsTab from '@modules/admin/frontend/components/ChannelsTab'
import SystemTab from '@modules/admin/frontend/components/SystemTab'
import GuideTab from '@modules/admin/frontend/components/GuideTab'
import { openOnboarding } from '@app-shell/onboarding'

type Tab = 'account' | 'members' | 'channels' | 'guide' | 'system'

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as Tab | null
  const TABS: Tab[] = ['account', 'members', 'channels', 'guide', 'system']
  const initialTab: Tab = TABS.includes(tabFromUrl as Tab) ? (tabFromUrl as Tab) : 'account'
  const [tab, setTab] = useState<Tab>(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Settings"
        actions={(
          <Btn size="sm" variant="secondary" onClick={() => openOnboarding({ reset: true })}>
            Replay onboarding
          </Btn>
        )}
      />

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

      {tab === 'channels' && <ChannelsTab />}
      {tab === 'guide' && <GuideTab />}

      {tab === 'system' && <SystemTab />}
    </div>
  )
}
