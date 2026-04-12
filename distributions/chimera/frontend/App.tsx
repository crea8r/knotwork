import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth, AppLayout } from '@app-shell/index'
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
import { chimeraDistribution } from './manifest'

export default function ChimeraApp() {
  const enabledModules = new Set(chimeraDistribution.enabledModules)
  const hasAdmin = enabledModules.has('admin')
  const hasAssets = enabledModules.has('assets')
  const hasCommunication = enabledModules.has('communication')
  const hasProjects = enabledModules.has('projects')
  const hasWorkflows = enabledModules.has('workflows')

  return (
    <Routes>
      {hasAdmin && <Route path="/login" element={<LoginPage />} />}
      {hasAdmin && <Route path="/accept-invite" element={<AcceptInvitePage />} />}
      {chimeraDistribution.publicRoutes.workflows && (
        <Route path="/public/workflows/:graphSlug/:versionSlug" element={<PublicWorkflowPage />} />
      )}
      {chimeraDistribution.publicRoutes.workflows && (
        <Route path="/public/workflows/:token" element={<PublicWorkflowPage />} />
      )}
      {chimeraDistribution.publicRoutes.runs && (
        <Route path="/public/runs/:token" element={<PublicRunPage />} />
      )}

      <Route path="/" element={<Navigate to={chimeraDistribution.defaultRoute} replace />} />
      <Route path="/dashboard" element={<Navigate to={chimeraDistribution.defaultRoute} replace />} />
      {hasWorkflows && (
        <Route
          path="/graphs/:graphId"
          element={
            <RequireAuth>
              <GraphDetailPage />
            </RequireAuth>
          }
        />
      )}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        {hasProjects && <Route path="/projects" element={<ProjectsPage />} />}
        {hasProjects && (
          <Route path="/projects/:projectSlug" element={<ProjectDetailPage />}>
            <Route index element={<ProjectMainContent />} />
            <Route path="assets" element={<ProjectAssetsPage />} />
            <Route path="channels/:channelSlug" element={<ProjectChannelPage />} />
            <Route path="objectives/:objectiveSlug" element={<ObjectiveDetailPanel />} />
          </Route>
        )}
        {hasProjects && <Route path="/objectives/:objectiveSlug" element={<ObjectiveDetailPage />} />}
        {hasWorkflows && <Route path="/graphs" element={<GraphsPage />} />}
        {hasWorkflows && <Route path="/runs" element={<RunsPage />} />}
        {hasWorkflows && <Route path="/runs/:runId" element={<RunDetailPage />} />}
        {hasAssets && <Route path="/knowledge" element={<KnowledgePage />} />}
        {hasAssets && <Route path="/knowledge/file" element={<KnowledgeFilePage />} />}
        {hasAssets && <Route path="/handbook" element={<Navigate to="/knowledge" replace />} />}
        {hasAssets && <Route path="/handbook/file" element={<KnowledgeFilePage />} />}
        {hasAdmin && <Route path="/settings" element={<SettingsPage />} />}
        {hasCommunication && communicationRoutes()}
      </Route>
    </Routes>
  )
}
