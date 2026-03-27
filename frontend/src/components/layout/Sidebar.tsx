import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Hash,
  Inbox,
  PlayCircle,
  Settings,
  X,
} from 'lucide-react'
import knotworkLogo from '@/assets/knotwork-logo.svg'
import { useInboxSummary } from '@/api/channels'
import { useAuthStore } from '@/store/auth'

// ── Full nav item ─────────────────────────────────────────────────────────────

function NavItem({
  to, icon, label, onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <NavLink to={to} onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
        }`
      }>
      {icon}{label}
    </NavLink>
  )
}

// ── Icon-only nav item (collapsed) ────────────────────────────────────────────

function IconNavItem({
  to, icon, label, onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <NavLink to={to} onClick={onClick} title={label}
      className={({ isActive }) =>
        `flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-100'
        }`
      }>
      {icon}
    </NavLink>
  )
}

function Divider({ collapsed }: { collapsed: boolean }) {
  return <div className={`border-t border-gray-100 my-1 ${collapsed ? 'mx-1' : 'mx-2'}`} />
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar({
  mobileOpen = false,
  onCloseMobile,
  collapsed = false,
  onToggleCollapse,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
  const { data: inboxSummary } = useInboxSummary(workspaceId)
  const Item = collapsed ? IconNavItem : NavItem
  const iconSize = collapsed ? 18 : 16
  const unreadCount = inboxSummary?.unread_count ?? 0
  const handleHandbookClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
    onCloseMobile?.()
    if (!location.pathname.startsWith('/handbook')) return
    e.preventDefault()
    navigate('/handbook')
  }

  return (
    <aside className={`fixed md:static inset-y-0 left-0 z-40 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen transform transition-all duration-200 ${
      mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
    } ${collapsed ? 'w-14' : 'w-52'}`}>

      {/* Logo */}
      <div className={`flex items-center border-b border-gray-100 ${collapsed ? 'justify-center py-[13px]' : 'justify-between'}`}>
        {collapsed ? (
          <button onClick={() => navigate('/inbox')}
            className="hover:bg-gray-50 p-1.5 rounded-lg transition-colors" title="Knotwork">
            <img src={knotworkLogo} alt="Knotwork" className="h-6 w-6" />
          </button>
        ) : (
          <>
            <button onClick={() => { navigate('/inbox'); onCloseMobile?.() }}
              className="flex items-center gap-2 px-4 py-4 hover:bg-gray-50 transition-colors flex-1 text-left">
              <img src={knotworkLogo} alt="Knotwork" className="h-6 w-6 flex-shrink-0" />
              <span className="font-semibold text-gray-900 text-sm">Knotwork</span>
            </button>
            <button onClick={onCloseMobile} className="md:hidden px-3 text-gray-400 hover:text-gray-700" aria-label="Close navigation">
              <X size={16} />
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto py-3 space-y-0.5 ${collapsed ? 'px-1 flex flex-col items-center' : 'px-2'}`}>
        <Item
          to="/inbox"
          icon={
            <span className="relative inline-flex">
              <Inbox size={iconSize} />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] leading-4 text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>
          }
          label="Inbox"
          onClick={onCloseMobile}
        />
        <Item to="/channels" icon={<Hash       size={iconSize} />} label="Channels"  onClick={onCloseMobile} />
        <Divider collapsed={collapsed} />
        <Item to="/runs"     icon={<PlayCircle size={iconSize} />} label="Runs"      onClick={onCloseMobile} />
        <Item to="/handbook" icon={<Globe      size={iconSize} />} label="Handbook" onClick={handleHandbookClick} />
        <Divider collapsed={collapsed} />
        <Item to="/settings" icon={<Settings   size={iconSize} />} label="Settings"  onClick={onCloseMobile} />
      </nav>

      {/* Collapse toggle (desktop only) */}
      <div className={`border-t border-gray-100 p-2 hidden md:flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
        <button onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>
    </aside>
  )
}
