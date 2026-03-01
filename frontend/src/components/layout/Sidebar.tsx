import { NavLink, useNavigate } from 'react-router-dom'
import {
  GitBranch,
  LayoutDashboard,
  BookOpen,
  Wrench,
  Settings,
  AlertCircle,
} from 'lucide-react'

interface NavItem {
  to: string
  icon: React.ReactNode
  label: string
}

const DESIGNER_ITEMS: NavItem[] = [
  { to: '/graphs', icon: <GitBranch size={16} />, label: 'Designer' },
]

const OPERATOR_ITEMS: NavItem[] = [
  { to: '/dashboard', icon: <LayoutDashboard size={16} />, label: 'Dashboard' },
  { to: '/runs', icon: <GitBranch size={16} />, label: 'Runs' },
  { to: '/escalations', icon: <AlertCircle size={16} />, label: 'Escalations' },
]

const RESOURCE_ITEMS: NavItem[] = [
  { to: '/handbook', icon: <BookOpen size={16} />, label: 'Handbook' },
  { to: '/tools', icon: <Wrench size={16} />, label: 'Tools' },
]

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
      {label}
    </p>
  )
}

function NavItem({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-brand-50 text-brand-700 font-semibold'
            : 'text-gray-600 hover:bg-gray-100'
        }`
      }
    >
      {item.icon}
      {item.label}
    </NavLink>
  )
}

export default function Sidebar() {
  const navigate = useNavigate()
  return (
    <aside className="w-52 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen">
      {/* Logo */}
      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-2 px-4 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
      >
        <span className="text-lg font-bold text-brand-600">⊞</span>
        <span className="font-semibold text-gray-900 text-sm">Knotwork</span>
      </button>

      {/* Settings (top standalone) */}
      <div className="px-2 pt-3 pb-1">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-brand-50 text-brand-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-100'
            }`
          }
        >
          <Settings size={16} />
          Settings
        </NavLink>
      </div>

      <div className="border-t border-gray-100 mx-3 my-1" />

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
        <div>
          <SectionLabel label="Role" />
          <div className="space-y-0.5">
            {DESIGNER_ITEMS.map((item) => <NavItem key={item.to} item={item} />)}
            {OPERATOR_ITEMS.map((item) => <NavItem key={item.to} item={item} />)}
          </div>
        </div>

        <div>
          <SectionLabel label="Resources" />
          <div className="space-y-0.5">
            {RESOURCE_ITEMS.map((item) => <NavItem key={item.to} item={item} />)}
          </div>
        </div>
      </nav>
    </aside>
  )
}
