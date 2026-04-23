import { useEffect, useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import Btn from '@ui/components/Btn'
import { useRegisterShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
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

  const desktopTopBarActions = useMemo(() => (
    <Btn
      data-ui="admin.settings.replay-onboarding"
      size="sm"
      variant="secondary"
      onClick={() => openOnboarding({ reset: true })}
    >
      Replay onboarding
    </Btn>
  ), [])

  const settingsIcon = useMemo(() => <Settings2 size={16} strokeWidth={1.8} />, [])

  useRegisterShellTopBarSlots({
    leadingTitle: 'Settings',
    leadingSubtitle: 'Workspace administration',
    leadingIcon: settingsIcon,
    leading: null,
    actions: desktopTopBarActions,
  })

  return (
    <div data-ui="admin.settings.page" className="p-8 max-w-4xl mx-auto">
      <div data-ui="admin.settings.header.mobile" className="mb-6 flex items-start justify-between gap-4 md:hidden">
        <div>
          <h1 data-ui="admin.settings.header.mobile.title" className="text-xl font-semibold text-gray-900">
            Settings
          </h1>
          <p data-ui="admin.settings.header.mobile.subtitle" className="mt-1 text-sm text-gray-500">
            Workspace administration
          </p>
        </div>
        <Btn
          data-ui="admin.settings.replay-onboarding.mobile"
          size="sm"
          variant="secondary"
          onClick={() => openOnboarding({ reset: true })}
        >
          Replay onboarding
        </Btn>
      </div>

      <div data-ui="admin.settings.tabs" className="flex gap-4 border-b mb-6 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              setSearchParams({ tab: t })
            }}
            data-ui={`admin.settings.tab.${t}`}
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

      {tab === 'account' && <div data-ui="admin.settings.panel.account"><AccountTab /></div>}

      {tab === 'members' && <div data-ui="admin.settings.panel.members"><MembersTab /></div>}

      {tab === 'channels' && <div data-ui="admin.settings.panel.channels"><ChannelsTab /></div>}
      {tab === 'guide' && <div data-ui="admin.settings.panel.guide"><GuideTab /></div>}

      {tab === 'system' && <div data-ui="admin.settings.panel.system"><SystemTab /></div>}
    </div>
  )
}
