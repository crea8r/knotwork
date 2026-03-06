import { NavLink, useNavigate } from 'react-router-dom'
import {
  GitBranch,
  Hash,
  Inbox,
  BookOpen,
  Settings,
  PlayCircle,
  X,
} from 'lucide-react'

function NavItem({
  to, icon, label, onClick,
}: { to: string; icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-brand-50 text-brand-700 font-semibold'
            : 'text-gray-600 hover:bg-gray-100'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

function Divider() {
  return <div className="border-t border-gray-100 mx-2 my-1" />
}

export default function Sidebar({
  mobileOpen = false,
  onCloseMobile,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}) {
  const navigate = useNavigate()
  return (
    <aside
      className={`fixed md:static inset-y-0 left-0 z-40 w-52 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen transform transition-transform ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between border-b border-gray-100">
        <button
          onClick={() => {
            navigate('/inbox')
            onCloseMobile?.()
          }}
          className="flex items-center gap-2 px-4 py-4 hover:bg-gray-50 transition-colors flex-1 text-left"
        >
          <span className="text-lg font-bold text-brand-600">⊞</span>
          <span className="font-semibold text-gray-900 text-sm">Knotwork</span>
        </button>
        <button
          onClick={onCloseMobile}
          className="md:hidden px-3 text-gray-400 hover:text-gray-700"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <NavItem to="/inbox" icon={<Inbox size={16} />} label="Inbox" onClick={onCloseMobile} />
        <NavItem to="/channels" icon={<Hash size={16} />} label="Channels" onClick={onCloseMobile} />

        <Divider />

        <NavItem to="/runs" icon={<PlayCircle size={16} />} label="Runs" onClick={onCloseMobile} />
        <NavItem to="/graphs" icon={<GitBranch size={16} />} label="Workflows" onClick={onCloseMobile} />
        <NavItem to="/handbook" icon={<BookOpen size={16} />} label="Handbook" onClick={onCloseMobile} />

        <Divider />

        <NavItem to="/settings" icon={<Settings size={16} />} label="Settings" onClick={onCloseMobile} />
      </nav>
    </aside>
  )
}
