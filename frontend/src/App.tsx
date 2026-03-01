/**
 * App root. Defines routes.
 * Designer mode: /graphs, /graphs/:id
 * Operator mode: /dashboard, /runs, /runs/:id, /escalations
 * Handbook: /handbook
 * Settings: /settings
 * Tools: /tools
 */
import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import GraphsPage from './pages/GraphsPage'
import GraphDetailPage from './pages/GraphDetailPage'
import RunDetailPage from './pages/RunDetailPage'
import RunsPage from './pages/RunsPage'
import DashboardPage from './pages/DashboardPage'
import HandbookPage from './pages/HandbookPage'
import KnowledgeFilePage from './pages/KnowledgeFilePage'
import EscalationsPage from './pages/EscalationsPage'
import EscalationDetailPage from './pages/EscalationDetailPage'
import ToolsPage from './pages/ToolsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {/* GraphDetailPage uses its own full-viewport layout */}
      <Route path="/graphs/:graphId" element={<GraphDetailPage />} />
      {/* All other routes get the app shell */}
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/graphs" element={<GraphsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/escalations" element={<EscalationsPage />} />
        <Route path="/escalations/:escalationId" element={<EscalationDetailPage />} />
        <Route path="/handbook" element={<HandbookPage />} />
        <Route path="/handbook/file" element={<KnowledgeFilePage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
