import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout, RequireAuth } from '@app-shell/index'
import {
  AcceptInvitePage,
  LoginPage,
  SettingsPage,
} from '@modules/admin/frontend/index'
import {
  KnowledgeFilePage,
  KnowledgePage,
} from '@modules/assets/frontend/index'
import {
  GraphsPage,
  PublicRunPage,
  PublicWorkflowPage,
  RunDetailPage,
  RunsPage,
} from '@modules/workflows/frontend/index'
import { manticoreDistribution } from './manifest'

export function ManticoreApp() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      {manticoreDistribution.publicRoutes.workflows && (
        <Route path="/public/workflows/:workflowSlug/:versionSlug" element={<PublicWorkflowPage />} />
      )}
      {manticoreDistribution.publicRoutes.workflows && (
        <Route path="/public/workflows/:token" element={<PublicWorkflowPage />} />
      )}
      {manticoreDistribution.publicRoutes.runs && (
        <Route path="/public/runs/:token" element={<PublicRunPage />} />
      )}

      <Route path="/" element={<Navigate to={manticoreDistribution.defaultRoute} replace />} />
      <Route path="/dashboard" element={<Navigate to={manticoreDistribution.defaultRoute} replace />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/graphs" element={<Navigate to="/workflows" replace />} />
        <Route path="/workflows" element={<GraphsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/file" element={<KnowledgeFilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
