/**
 * App root. Defines routes.
 * Designer mode: /graphs, /graphs/:id
 * Operator mode: /dashboard, /runs/:id, /escalations
 * Handbook: /handbook
 * Settings: /settings
 */
import { Routes, Route, Navigate } from 'react-router-dom'
import GraphsPage from './pages/GraphsPage'
import GraphDetailPage from './pages/GraphDetailPage'
import RunDetailPage from './pages/RunDetailPage'
import HandbookPage from './pages/HandbookPage'
import KnowledgeFilePage from './pages/KnowledgeFilePage'
import EscalationsPage from './pages/EscalationsPage'
import EscalationDetailPage from './pages/EscalationDetailPage'

const Placeholder = ({ name }: { name: string }) => (
  <div className="p-8 text-gray-500">Page: {name} — not yet implemented</div>
)

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/graphs" replace />} />
      <Route path="/dashboard" element={<Placeholder name="Dashboard" />} />
      <Route path="/graphs" element={<GraphsPage />} />
      <Route path="/graphs/:graphId" element={<GraphDetailPage />} />
      <Route path="/runs/:runId" element={<RunDetailPage />} />
      <Route path="/escalations" element={<EscalationsPage />} />
      <Route path="/escalations/:id" element={<EscalationDetailPage />} />
      <Route path="/handbook" element={<HandbookPage />} />
      <Route path="/handbook/file" element={<KnowledgeFilePage />} />
      <Route path="/tools" element={<Placeholder name="Tools" />} />
      <Route path="/settings" element={<Placeholder name="Settings" />} />
      <Route path="/login" element={<Placeholder name="Login" />} />
    </Routes>
  )
}
