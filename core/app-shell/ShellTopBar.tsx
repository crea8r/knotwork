import { Link, matchPath, useLocation } from 'react-router-dom'
import { ArrowLeft, ChevronLeft } from 'lucide-react'
import { useActiveDistribution } from './distribution'
import { useShellTopBarSlots } from './ShellTopBarSlots'
import { useAuthStore } from '@auth'
import { useProjectDashboard } from '@modules/projects/frontend/api/projects'
import { renderShellHeaderIcon, type ShellHeaderIconKind } from './ShellHeaderMeta'
import { assetChatReturnHref, readAssetChatReturnTarget, readAssetChatSourceHeader } from './assetChatNavigation'
import {
  SHELL_ICON_BUTTON_CLASS,
  SHELL_RAIL_LEADING_ICON_CLASS,
  SHELL_RAIL_CLASS,
  SHELL_RAIL_INNER_CLASS,
  SHELL_RAIL_SUBTITLE_CLASS,
  SHELL_RAIL_TITLE_CLASS,
  SHELL_TEXT_BUTTON_CLASS,
} from './layoutChrome'
import { formatAssetSelectionLabel, useAssetWorkspaceStore } from '@app-shell/state/assetWorkspace'

function topBarTitle(pathname: string, distributionName: string, projectTitle?: string | null): string {
  if (projectTitle && pathname.startsWith('/projects/')) return projectTitle
  if (pathname.startsWith('/projects')) return 'Work'
  if (pathname.startsWith('/objectives')) return 'Objective'
  if (pathname.startsWith('/channels')) return 'Channels'
  if (pathname.startsWith('/graphs')) return 'Workflows'
  if (pathname.startsWith('/runs')) return 'Runs'
  if (pathname.startsWith('/knowledge') || pathname.startsWith('/handbook')) return 'Knowledge'
  if (pathname.startsWith('/settings')) return 'Settings'
  if (pathname.startsWith('/inbox')) return 'Now'
  return distributionName
}

export default function ShellTopBar({
  showChatCollapseControl = false,
  onToggleChatCollapse,
}: {
  showChatCollapseControl?: boolean
  onToggleChatCollapse?: () => void
}) {
  const location = useLocation()
  const distribution = useActiveDistribution()
  const workspaceId = useAuthStore((state) => state.workspaceId) ?? (import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace')
  const projectMatch = matchPath('/projects/:projectSlug/*', location.pathname) ?? matchPath('/projects/:projectSlug', location.pathname)
  const projectSlug = projectMatch?.params.projectSlug ?? null
  const { data: projectDashboard } = useProjectDashboard(workspaceId, projectSlug ?? '')
  const projectTitle = projectDashboard?.project.title ?? null
  const title = topBarTitle(location.pathname, distribution.displayName, projectTitle)
  const {
    leadingTitle,
    leadingSubtitle,
    leadingIcon,
    leading: leadingOverride,
    actions: actionsOverride,
    context: contextOverride,
  } = useShellTopBarSlots()
  const assetChatOpen = useAssetWorkspaceStore((state) => state.isAssetChatOpen)
  const assetSelection = useAssetWorkspaceStore((state) => state.selection)
  const assetChatReturnTarget = readAssetChatReturnTarget(location)
  const assetChatSourceHeader = readAssetChatSourceHeader(location)
  const assetChatHeaderActive = (assetChatOpen || assetChatSourceHeader != null) && !!assetChatSourceHeader?.title
  const assetLabel = formatAssetSelectionLabel(assetSelection)
  const showAssetContext = (assetChatOpen || assetChatSourceHeader != null || assetChatReturnTarget != null) && !!assetLabel
  const assetIconKind: ShellHeaderIconKind = assetSelection?.assetType === 'folder' ? 'asset-folder' : 'asset-file'
  const resolvedLeadingTitle = assetChatHeaderActive
    ? (assetChatSourceHeader?.title ?? title)
    : (leadingTitle ?? title)
  const resolvedLeadingSubtitle = assetChatHeaderActive
    ? (assetChatSourceHeader?.subtitle ?? null)
    : leadingSubtitle
  const resolvedLeadingIcon = assetChatHeaderActive
    ? renderShellHeaderIcon(assetChatSourceHeader?.iconKind ?? 'channel')
    : leadingIcon
  const resolvedLeadingOverride = assetChatHeaderActive ? null : leadingOverride
  const assetContext = showAssetContext ? (
    <>
      <div
        data-ui="shell.chat.header.asset-context.pill"
        className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-900"
      >
        <span className="shrink-0 text-brand-700">{renderShellHeaderIcon(assetIconKind)}</span>
        <span className="truncate">
          Asset chat: <span className="font-semibold">{assetLabel}</span>
        </span>
      </div>
      {assetChatReturnTarget ? (
        <Link
          to={assetChatReturnHref(assetChatReturnTarget)}
          replace
          data-ui="shell.chat.header.asset-context.return"
          className={SHELL_TEXT_BUTTON_CLASS}
        >
          <ArrowLeft size={14} />
          <span className="truncate">Back to {assetChatReturnTarget.label}</span>
        </Link>
      ) : null}
    </>
  ) : null
  const combinedContext = contextOverride || assetContext ? (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {contextOverride}
      {assetContext}
    </div>
  ) : null

  return (
    <div data-ui="shell.chat.header" className={`hidden md:block ${SHELL_RAIL_CLASS}`}>
      <div data-ui="shell.chat.header.inner" className={`${SHELL_RAIL_INNER_CLASS} justify-between`}>
        <div data-ui="shell.chat.header.leading" className="flex min-w-0 items-center gap-3">
          {resolvedLeadingOverride ?? (
            <>
              {resolvedLeadingIcon ? (
                <div data-ui="shell.chat.header.icon" className={SHELL_RAIL_LEADING_ICON_CLASS}>
                  {resolvedLeadingIcon}
                </div>
              ) : null}
              <div data-ui="shell.chat.header.title-group" className="min-w-0">
                <p data-ui="shell.chat.header.title" className={SHELL_RAIL_TITLE_CLASS}>
                  {resolvedLeadingTitle}
                </p>
                {resolvedLeadingSubtitle ? (
                  <p data-ui="shell.chat.header.subtitle" className={SHELL_RAIL_SUBTITLE_CLASS}>
                    {resolvedLeadingSubtitle}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div data-ui="shell.chat.header.actions" className="flex min-w-0 items-center gap-2">
          {actionsOverride}
          {showChatCollapseControl && onToggleChatCollapse ? (
            <button
              type="button"
              onClick={onToggleChatCollapse}
              data-ui="shell.chat.collapse"
              className={SHELL_ICON_BUTTON_CLASS}
              aria-label="Collapse chat column"
              title="Collapse chat column"
            >
              <ChevronLeft size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {combinedContext ? (
        <div data-ui="shell.chat.header.context" className="border-t border-stone-200 px-3 py-2">
          {combinedContext}
        </div>
      ) : null}
    </div>
  )
}
