import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

/**
 * App shell: sidebar + scrollable main area.
 * GraphDetailPage overrides this with its own full-viewport layout.
 */
export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
