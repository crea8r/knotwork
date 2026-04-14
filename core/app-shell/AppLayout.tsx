import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import OnboardingExperience from './OnboardingExperience'
import VersionWarningBanner from '@ui/components/VersionWarningBanner'
import { useActiveDistribution } from './distribution'
import { readNamespacedStorage, writeNamespacedStorage } from '@storage'

const NAV_COLLAPSED_STORAGE_KEY = 'nav-collapsed'

/**
 * App shell: collapsible sidebar + scrollable main area.
 * GraphDetailPage overrides this with its own full-viewport layout.
 */
export default function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(
    () => readNamespacedStorage(NAV_COLLAPSED_STORAGE_KEY, ['kw-nav-collapsed']) === 'true',
  )
  const location = useLocation()
  const distribution = useActiveDistribution()
  const enabledModules = new Set(distribution.enabledModules)
  const hasProjects = enabledModules.has('projects')
  const hasCommunication = enabledModules.has('communication')
  const hasWorkflows = enabledModules.has('workflows')
  const hasAssets = enabledModules.has('assets')
  const hasAdmin = enabledModules.has('admin')

  function toggleNav() {
    setNavCollapsed((v) => {
      const next = !v
      writeNamespacedStorage(NAV_COLLAPSED_STORAGE_KEY, String(next), ['kw-nav-collapsed'])
      return next
    })
  }

  useEffect(() => {
    if (!mobileNavOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mobileNavOpen])

  const mobileTitle = (() => {
    if (hasCommunication && location.pathname.startsWith('/inbox')) return 'Now'
    if (hasProjects && location.pathname.startsWith('/projects')) return 'Work'
    if (location.pathname.startsWith('/objectives')) return 'Objective'
    if (hasCommunication && location.pathname.startsWith('/channels')) return 'Channels'
    if (hasWorkflows && location.pathname.startsWith('/runs')) return 'Runs'
    if (hasWorkflows && location.pathname.startsWith('/graphs')) return 'Workflows'
    if (hasAssets && (location.pathname.startsWith('/knowledge') || location.pathname.startsWith('/handbook'))) {
      return 'Knowledge'
    }
    if (hasAdmin && location.pathname.startsWith('/settings')) return 'Settings'
    return distribution.displayName
  })()

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {mobileNavOpen && (
        <button className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />
      )}
      <Sidebar
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        collapsed={navCollapsed}
        onToggleCollapse={toggleNav}
      />
      <main className="flex-1 overflow-y-auto relative min-w-0">
        <VersionWarningBanner />
        <OnboardingExperience />
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700"
            onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu size={16} />
          </button>
          <p className="text-sm font-semibold text-gray-900">{mobileTitle}</p>
        </header>
        <Outlet />
      </main>
    </div>
  )
}
