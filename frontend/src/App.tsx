/**
 * App root. Defines routes.
 * Conversational shell: /inbox, /channels, /channels/:id
 * Structured assets: /runs, /runs/:id, /graphs, /graphs/:id
 * Handbook: /handbook (Files + Proposals tabs)
 * Settings: /settings
 */
import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import GraphsPage from './pages/GraphsPage'
import GraphDetailPage from './pages/GraphDetailPage'
import RunDetailPage from './pages/RunDetailPage'
import RunsPage from './pages/RunsPage'
import InboxPage from './pages/InboxPage'
import ChannelsPage from './pages/ChannelsPage'
import ChannelDetailPage from './pages/ChannelDetailPage'
import HandbookPage from './pages/HandbookPage'
import KnowledgeFilePage from './pages/KnowledgeFilePage'
import EscalationsPage from './pages/EscalationsPage'
import EscalationDetailPage from './pages/EscalationDetailPage'
import SettingsPage from './pages/SettingsPage'
import AgentProfilePage from './pages/AgentProfilePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/inbox" replace />} />
      <Route path="/dashboard" element={<Navigate to="/inbox" replace />} />
      {/* GraphDetailPage uses its own full-viewport layout */}
      <Route path="/graphs/:graphId" element={<GraphDetailPage />} />
      {/* All other routes get the app shell */}
      <Route element={<AppLayout />}>
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
        <Route path="/graphs" element={<GraphsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/escalations" element={<EscalationsPage />} />
        <Route path="/escalations/:escalationId" element={<EscalationDetailPage />} />
        <Route path="/handbook" element={<HandbookPage />} />
        <Route path="/handbook/file" element={<KnowledgeFilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/agents/:agentId" element={<AgentProfilePage />} />
      </Route>
    </Routes>
  )
}
