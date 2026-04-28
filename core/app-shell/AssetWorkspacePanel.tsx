import { FolderOpen } from 'lucide-react'
import { useProjectDashboard } from '@modules/projects/frontend/api/projects'
import KnowledgeAssetsWorkspacePanel from '@modules/assets/frontend/components/KnowledgeAssetsWorkspacePanel'
import ProjectAssetsWorkspacePanel from '@modules/assets/frontend/components/ProjectAssetsWorkspacePanel'
import Spinner from '@ui/components/Spinner'
import AssetWorkspaceChatPanel from './AssetWorkspaceChatPanel'
import { SHELL_ICON_BUTTON_CLASS } from './layoutChrome'
import { useAssetWorkspaceStore } from '@app-shell/state/assetWorkspace'

export default function AssetWorkspacePanel({
  onToggleWorkspace,
  assetToggleDisabled = false,
  assetChatActive,
}: {
  onToggleWorkspace?: () => void
  assetToggleDisabled?: boolean
  assetChatActive?: boolean
}) {
  const scope = useAssetWorkspaceStore((state) => state.scope)
  const storeAssetChatOpen = useAssetWorkspaceStore((state) => state.isAssetChatOpen)
  const assetChatOpen = assetChatActive ?? storeAssetChatOpen
  const { data: projectDashboard, isLoading } = useProjectDashboard(
    scope?.kind === 'project' ? scope.workspaceId : '',
    scope?.kind === 'project' ? scope.projectSlug : '',
  )

  if (!scope) return null

  const assetChatPanel = <AssetWorkspaceChatPanel />

  const railActions = (
    <button
      type="button"
      onClick={onToggleWorkspace}
      disabled={!onToggleWorkspace || assetToggleDisabled}
      data-ui="shell.asset.header.toggle"
      className={`${SHELL_ICON_BUTTON_CLASS} border-brand-300 bg-brand-50 text-brand-700 hover:border-brand-300 hover:bg-brand-100 hover:text-brand-800 disabled:pointer-events-none disabled:opacity-60`}
      aria-label={scope.kind === 'project' ? 'Toggle project assets' : 'Toggle knowledge assets'}
      title={scope.kind === 'project' ? 'Toggle project assets' : 'Toggle knowledge assets'}
    >
      <FolderOpen size={15} />
    </button>
  )

  return (
    <div data-ui="shell.asset.panel" className="h-full min-h-0 w-full bg-white">
      <div data-ui="shell.asset.panel.content" className="h-full min-h-0 w-full">
        {scope.kind === 'project' ? (
          isLoading || !projectDashboard?.project ? (
            <div data-ui="shell.asset.panel.loading" className="flex h-full items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : (
            <ProjectAssetsWorkspacePanel
              workspaceId={scope.workspaceId}
              projectSlug={scope.projectSlug}
              projectId={projectDashboard.project.id}
              projectTitle={projectDashboard.project.title}
              railActions={railActions}
              assetChatVisible={assetChatOpen}
              assetChatPanel={assetChatPanel}
            />
          )
        ) : (
          <KnowledgeAssetsWorkspacePanel
            workspaceId={scope.workspaceId}
            railActions={railActions}
            assetChatVisible={assetChatOpen}
            assetChatPanel={assetChatPanel}
          />
        )}
      </div>
    </div>
  )
}
