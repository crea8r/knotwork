import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import OnboardingExperience from '@/components/onboarding/OnboardingExperience'
import VersionWarningBanner from '@/components/shared/VersionWarningBanner'

/**
 * App shell: collapsible sidebar + scrollable main area.
 * GraphDetailPage overrides this with its own full-viewport layout.
 */
export default function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('kw-nav-collapsed') === 'true')
  const location = useLocation()

  function toggleNav() {
    setNavCollapsed((v) => {
      const next = !v
      localStorage.setItem('kw-nav-collapsed', String(next))
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
    if (location.pathname.startsWith('/inbox')) return 'Now'
    if (location.pathname.startsWith('/projects')) return 'Work'
    if (location.pathname.startsWith('/objectives')) return 'Objective'
    if (location.pathname.startsWith('/channels')) return 'Channels'
    if (location.pathname.startsWith('/runs')) return 'Runs'
    if (location.pathname.startsWith('/knowledge') || location.pathname.startsWith('/handbook') || location.pathname.startsWith('/graphs')) return 'Knowledge'
    if (location.pathname.startsWith('/settings')) return 'Settings'
    return 'Knotwork'
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
