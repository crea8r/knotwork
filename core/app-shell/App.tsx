import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth, AppLayout } from './index'
import {
  AcceptInvitePage,
  LoginPage,
  SettingsPage,
} from '@modules/admin/frontend/index'
import {
  communicationRoutes,
} from '@modules/communication/frontend/index'
import {
  KnowledgeFilePage,
  KnowledgePage,
} from '@modules/assets/frontend/index'
import {
  ObjectiveDetailPage,
  ObjectiveDetailPanel,
  ProjectAssetsPage,
  ProjectChannelPage,
  ProjectDetailPage,
  ProjectMainContent,
  ProjectsPage,
} from '@modules/projects/frontend/index'
import {
  GraphDetailPage,
  GraphsPage,
  PublicRunPage,
  PublicWorkflowPage,
  RunDetailPage,
  RunsPage,
} from '@modules/workflows/frontend/index'
import { LandingPage } from '@modules/marketing/frontend/index'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/public/workflows/:graphSlug/:versionSlug" element={<PublicWorkflowPage />} />
      <Route path="/public/workflows/:token" element={<PublicWorkflowPage />} />
      <Route path="/public/runs/:token" element={<PublicRunPage />} />

      <Route path="/" element={<LandingPage />} />
      <Route path="/dashboard" element={<Navigate to="/inbox" replace />} />
      <Route
        path="/graphs/:graphId"
        element={
          <RequireAuth>
            <GraphDetailPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectSlug" element={<ProjectDetailPage />}>
          <Route index element={<ProjectMainContent />} />
          <Route path="assets" element={<ProjectAssetsPage />} />
          <Route path="channels/:channelSlug" element={<ProjectChannelPage />} />
          <Route path="objectives/:objectiveSlug" element={<ObjectiveDetailPanel />} />
        </Route>
        <Route path="/objectives/:objectiveSlug" element={<ObjectiveDetailPage />} />
        <Route path="/graphs" element={<GraphsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/file" element={<KnowledgeFilePage />} />
        <Route path="/handbook" element={<Navigate to="/knowledge" replace />} />
        <Route path="/handbook/file" element={<KnowledgeFilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {communicationRoutes()}
      </Route>
    </Routes>
  )
}
