import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, FolderOpen, GripVertical, Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import OnboardingExperience from './OnboardingExperience'
import AssetWorkspacePanel from './AssetWorkspacePanel'
import { renderShellHeaderIcon } from './ShellHeaderMeta'
import ShellTopBar from './ShellTopBar'
import { ShellTopBarSlotsProvider, useShellTopBarSlots } from './ShellTopBarSlots'
import { SHELL_ICON_BUTTON_CLASS, SHELL_RAIL_CLASS, SHELL_RAIL_INNER_CLASS } from './layoutChrome'
import { assetChatReturnHref, readAssetChatReturnTarget } from './assetChatNavigation'
import VersionWarningBanner from '@ui/components/VersionWarningBanner'
import { useActiveDistribution } from './distribution'
import { readNamespacedStorage, writeNamespacedStorage } from '@storage'
import { formatAssetSelectionLabel, isSameAssetScope, useAssetWorkspaceStore, type AssetWorkspaceScope } from '@app-shell/state/assetWorkspace'
import { useAuthStore } from '@auth'
import { projectAssetsPath } from './paths'

const NAV_COLLAPSED_STORAGE_KEY = 'nav-collapsed'
const CHAT_COLLAPSED_STORAGE_KEY = 'shell-chat-collapsed'
const ASSET_PANEL_WIDTH_STORAGE_KEY = 'shell-asset-panel-width'
const MIN_ASSET_PANEL_WIDTH = 320
const MAX_ASSET_PANEL_WIDTH = 720
const DEFAULT_ASSET_PANEL_WIDTH = 440
const COLLAPSED_CHAT_RAIL_WIDTH = 56
const ASSET_RESIZE_HANDLE_WIDTH = 16

function clampAssetPanelWidth(width: number): number {
  return Math.max(MIN_ASSET_PANEL_WIDTH, Math.min(MAX_ASSET_PANEL_WIDTH, width))
}

function readStoredAssetPanelWidth(): number {
  const raw = readNamespacedStorage(ASSET_PANEL_WIDTH_STORAGE_KEY, ['kw-shell-asset-panel-width'])
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isNaN(value)) return DEFAULT_ASSET_PANEL_WIDTH
  return clampAssetPanelWidth(value)
}

function CollapsedChatRail({
  onExpand,
  showAssetChat,
  visible,
}: {
  onExpand: () => void
  showAssetChat: boolean
  visible: boolean
}) {
  const { snapshot } = useShellTopBarSlots()
  const selection = useAssetWorkspaceStore((state) => state.selection)
  const assetLabel = formatAssetSelectionLabel(selection)
  const railTitle = showAssetChat
    ? (assetLabel || 'Asset chat')
    : (snapshot?.title?.trim() || 'Chat')
  const railSubtitle = showAssetChat
    ? 'Asset chat'
    : (snapshot?.subtitle?.trim() || 'Current chat')
  const railIcon = showAssetChat
    ? renderShellHeaderIcon(selection?.assetType === 'folder' ? 'asset-folder' : 'asset-file')
    : renderShellHeaderIcon(snapshot?.iconKind ?? 'channel')

  return (
    <aside
      data-ui="shell.chat.rail"
      aria-hidden={!visible}
      className={`group relative hidden shrink-0 overflow-hidden border-l bg-white md:flex md:flex-col motion-safe:transition-[width,opacity,border-color] motion-safe:duration-200 motion-safe:ease-in-out motion-reduce:transition-none ${
        visible ? 'w-14 border-stone-200 opacity-100' : 'pointer-events-none w-0 border-transparent opacity-0'
      }`}
    >
      <div data-ui="shell.chat.rail.header" className={SHELL_RAIL_CLASS}>
        <div data-ui="shell.chat.rail.header.inner" className={`${SHELL_RAIL_INNER_CLASS} justify-center px-2`}>
          <button
            type="button"
            onClick={onExpand}
            data-ui="shell.chat.rail.expand"
            className={`${SHELL_ICON_BUTTON_CLASS} aspect-square`}
            aria-label="Expand chat column"
            title="Expand chat column"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div data-ui="shell.chat.rail.body" className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-1 pb-3">
        <div
          data-ui="shell.chat.rail.hint"
          aria-hidden="true"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-500"
        >
          {railIcon}
        </div>
        <div
          data-ui="shell.chat.rail.flyout"
          className="pointer-events-none absolute right-[calc(100%-0.25rem)] top-1/2 z-20 hidden w-56 -translate-y-1/2 rounded-2xl border border-stone-200 bg-white p-3 shadow-xl opacity-0 transition duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100 md:block"
          aria-hidden="true"
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-600">
              {railIcon}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-5 text-stone-900">{railTitle}</p>
              <p className="mt-0.5 truncate text-xs leading-4 text-stone-500">{railSubtitle}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

/**
 * App shell: collapsible sidebar + scrollable main area.
 */
export default function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(
    () => readNamespacedStorage(NAV_COLLAPSED_STORAGE_KEY, ['kw-nav-collapsed']) === 'true',
  )
  const [chatCollapsed, setChatCollapsed] = useState(
    () => readNamespacedStorage(CHAT_COLLAPSED_STORAGE_KEY, ['kw-shell-chat-collapsed']) === 'true',
  )
  const [assetPanelWidth, setAssetPanelWidth] = useState(readStoredAssetPanelWidth)
  const location = useLocation()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((state) => state.workspaceId) ?? (import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace')
  const assetWorkspaceOpen = useAssetWorkspaceStore((state) => state.isOpen)
  const assetChatOpen = useAssetWorkspaceStore((state) => state.isAssetChatOpen)
  const assetWorkspaceScope = useAssetWorkspaceStore((state) => state.scope)
  const openAssetWorkspace = useAssetWorkspaceStore((state) => state.open)
  const toggleAssetWorkspace = useAssetWorkspaceStore((state) => state.toggle)
  const openAssetChat = useAssetWorkspaceStore((state) => state.openAssetChat)
  const closeAssetWorkspace = useAssetWorkspaceStore((state) => state.close)
  const closeAssetChat = useAssetWorkspaceStore((state) => state.closeAssetChat)
  const distribution = useActiveDistribution()
  const enabledModules = new Set(distribution.enabledModules)
  const hasProjects = enabledModules.has('projects')
  const hasCommunication = enabledModules.has('communication')
  const hasWorkflows = enabledModules.has('workflows')
  const hasAssets = enabledModules.has('assets')
  const hasAdmin = enabledModules.has('admin')

  function setStoredNavCollapsed(next: boolean) {
    setNavCollapsed(next)
    writeNamespacedStorage(NAV_COLLAPSED_STORAGE_KEY, String(next), ['kw-nav-collapsed'])
  }

  function toggleNav() {
    setNavCollapsed((value) => {
      const next = !value
      writeNamespacedStorage(NAV_COLLAPSED_STORAGE_KEY, String(next), ['kw-nav-collapsed'])
      return next
    })
  }

  function setStoredChatCollapsed(next: boolean) {
    setChatCollapsed(next)
    writeNamespacedStorage(CHAT_COLLAPSED_STORAGE_KEY, String(next), ['kw-shell-chat-collapsed'])
  }

  function toggleChatColumn() {
    setChatCollapsed((value) => {
      const next = !value
      writeNamespacedStorage(CHAT_COLLAPSED_STORAGE_KEY, String(next), ['kw-shell-chat-collapsed'])
      return next
    })
  }

  function updateAssetPanelWidth(nextWidth: number) {
    const clamped = clampAssetPanelWidth(nextWidth)
    setAssetPanelWidth(clamped)
    writeNamespacedStorage(ASSET_PANEL_WIDTH_STORAGE_KEY, String(clamped), ['kw-shell-asset-panel-width'])
  }

  function handleAssetResizeMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
    const startX = event.clientX
    const startWidth = assetPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(moveEvent: MouseEvent) {
      updateAssetPanelWidth(startWidth - (moveEvent.clientX - startX))
    }

    function onMouseUp() {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function handleAssetResizeKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      updateAssetPanelWidth(assetPanelWidth + 24)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      updateAssetPanelWidth(assetPanelWidth - 24)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      updateAssetPanelWidth(MAX_ASSET_PANEL_WIDTH)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      updateAssetPanelWidth(MIN_ASSET_PANEL_WIDTH)
    }
  }

  useEffect(() => {
    if (!mobileNavOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mobileNavOpen])

  const routeAssetScope = useMemo<AssetWorkspaceScope | null>(() => {
    const projectMatch = matchPath('/projects/:projectSlug/*', location.pathname) ?? matchPath('/projects/:projectSlug', location.pathname)
    if (projectMatch?.params.projectSlug) {
      return {
        kind: 'project',
        workspaceId,
        projectSlug: projectMatch.params.projectSlug,
      }
    }
    if (location.pathname.startsWith('/knowledge')) {
      return { kind: 'knowledge', workspaceId }
    }
    return null
  }, [location.pathname, workspaceId])

  const locationSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const locationTargetsAsset = (
    locationSearchParams.has('path')
    || locationSearchParams.has('folder')
  )
  const routeIsProjectHome = !!matchPath('/projects/:projectSlug', location.pathname)
  const routeIsProjectAssets = !!(
    matchPath('/projects/:projectSlug/assets', location.pathname)
    ?? matchPath('/projects/:projectSlug/assets/*', location.pathname)
  )
  const routeIsProjectChannel = !!(
    matchPath('/projects/:projectSlug/channels/:channelSlug', location.pathname)
    ?? matchPath('/projects/:projectSlug/channels/:channelSlug/*', location.pathname)
  )
  const routeIsProjectObjective = !!(
    matchPath('/projects/:projectSlug/objectives/:objectiveSlug', location.pathname)
    ?? matchPath('/projects/:projectSlug/objectives/:objectiveSlug/*', location.pathname)
  )
  const routeIsKnowledgeAsset = location.pathname === '/knowledge'
  const routeShowsAssetWorkspaceFromUrl = routeAssetScope !== null && locationTargetsAsset
  const routeHasAssetChatParam = locationSearchParams.get('assetChat') === '1'
  const routeHasCurrentChat = routeIsProjectHome || routeIsProjectChannel || routeIsProjectObjective
  const routeShowsAssetChat = (routeIsProjectAssets || routeIsKnowledgeAsset) && locationTargetsAsset && routeHasAssetChatParam

  const routeSupportsAssetChat = routeAssetScope !== null
  const showAssetWorkspace = routeAssetScope !== null && (assetWorkspaceOpen || routeShowsAssetWorkspaceFromUrl)
  const showAssetChat = routeSupportsAssetChat && (assetChatOpen || routeShowsAssetChat)
  const assetChatFocusMode = showAssetWorkspace && showAssetChat
  const hideMainForAssetWorkspace = showAssetWorkspace && !routeHasCurrentChat
  const showDesktopAssetRail = routeAssetScope !== null
  const showCollapsedChatRail = routeHasCurrentChat && showAssetWorkspace && (chatCollapsed || assetChatFocusMode)
  const canToggleAssetWorkspace = routeAssetScope !== null && !routeShowsAssetChat
  const assetChatReturnTarget = readAssetChatReturnTarget(location)
  const previousPathnameRef = useRef(location.pathname)

  useEffect(() => {
    if (!showAssetWorkspace || !routeAssetScope) return
    if (!isSameAssetScope(assetWorkspaceScope, routeAssetScope)) {
      openAssetWorkspace(routeAssetScope)
    }
  }, [assetWorkspaceScope, openAssetWorkspace, routeAssetScope, showAssetWorkspace])

  useEffect(() => {
    if (!routeAssetScope) {
      closeAssetChat()
      return
    }
    if (!routeShowsAssetChat) {
      closeAssetChat()
      return
    }
    openAssetWorkspace(routeAssetScope)
    openAssetChat()
  }, [closeAssetChat, openAssetChat, openAssetWorkspace, routeAssetScope, routeShowsAssetChat])

  useEffect(() => {
    const previousPathname = previousPathnameRef.current
    const pathnameChanged = previousPathname !== location.pathname
    previousPathnameRef.current = location.pathname

    if (!pathnameChanged) return

    if (routeHasCurrentChat && showAssetWorkspace && chatCollapsed) {
      setChatCollapsed(false)
      writeNamespacedStorage(CHAT_COLLAPSED_STORAGE_KEY, 'false', ['kw-shell-chat-collapsed'])
    }

    if (!assetChatOpen) return

    const projectChannelMatch = matchPath('/projects/:projectSlug/channels/:channelSlug', location.pathname)
      ?? matchPath('/projects/:projectSlug/channels/:channelSlug/*', location.pathname)

    if (projectChannelMatch) {
      closeAssetChat()
    }
  }, [assetChatOpen, chatCollapsed, closeAssetChat, location.pathname, routeHasCurrentChat, showAssetWorkspace])

  useEffect(() => {
    if (!showAssetWorkspace && chatCollapsed) {
      setStoredChatCollapsed(false)
    }
  }, [chatCollapsed, showAssetWorkspace])

  function exitAssetFocusMode({
    expandNav = false,
    expandChat = false,
  }: {
    expandNav?: boolean
    expandChat?: boolean
  } = {}) {
    if (expandNav) setStoredNavCollapsed(false)
    if (expandChat) setStoredChatCollapsed(false)
    closeAssetChat()

    if (assetChatReturnTarget) {
      navigate(assetChatReturnHref(assetChatReturnTarget), { replace: true })
      return
    }
    if (routeShowsAssetChat) {
      const nextSearchParams = new URLSearchParams(location.search)
      nextSearchParams.delete('assetChat')
      const nextSearch = nextSearchParams.toString()
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: true },
      )
      return
    }
    if (routeAssetScope?.kind === 'project') {
      navigate(projectAssetsPath(routeAssetScope.projectSlug), { replace: true })
      return
    }
    if (routeAssetScope?.kind === 'knowledge') {
      navigate('/knowledge', { replace: true })
    }
  }

  function handleToggleNavCollapse() {
    if (assetChatFocusMode) {
      exitAssetFocusMode({ expandNav: true })
      return
    }
    toggleNav()
  }

  function handleExpandChatColumn() {
    if (assetChatFocusMode) {
      exitAssetFocusMode({ expandChat: true })
      return
    }
    setStoredChatCollapsed(false)
  }

  function handleToggleChatColumn() {
    if (assetChatFocusMode) {
      exitAssetFocusMode({ expandChat: true })
      return
    }
    toggleChatColumn()
  }

  function clearAssetSelectionFromUrl() {
    const nextSearchParams = new URLSearchParams(location.search)
    nextSearchParams.delete('path')
    nextSearchParams.delete('folder')
    nextSearchParams.delete('assetChat')
    const nextSearch = nextSearchParams.toString()
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true, state: location.state },
    )
  }

  function handleCloseAssetWorkspace() {
    if (routeShowsAssetChat) {
      exitAssetFocusMode()
      return
    }
    closeAssetChat()
    closeAssetWorkspace()
    if (routeShowsAssetWorkspaceFromUrl) {
      clearAssetSelectionFromUrl()
    }
  }

  function handleToggleAssetWorkspace() {
    if (!routeAssetScope || !canToggleAssetWorkspace) return
    if (showAssetWorkspace) {
      handleCloseAssetWorkspace()
      return
    }
    toggleAssetWorkspace(routeAssetScope)
  }

  const mobileTitle = (() => {
    if (hasCommunication && location.pathname.startsWith('/inbox')) return 'Now'
    if (hasProjects && location.pathname.startsWith('/projects')) return 'Project'
    if (location.pathname.startsWith('/objectives')) return 'Objective'
    if (hasCommunication && location.pathname.startsWith('/channels')) return 'Channels'
    if (hasWorkflows && location.pathname.startsWith('/runs')) return 'Runs'
    if (hasWorkflows && (location.pathname.startsWith('/workflows') || location.pathname.startsWith('/graphs'))) return 'Workflows'
    if (hasAssets && location.pathname.startsWith('/knowledge')) {
      return 'Knowledge'
    }
    if (hasAdmin && location.pathname.startsWith('/settings')) return 'Settings'
    return distribution.displayName
  })()
  const shouldRenderMainRoute = !hideMainForAssetWorkspace
  const showAnimatedChatColumn = showAssetWorkspace && routeHasCurrentChat
  const showChatRailRegion = showAssetWorkspace && routeHasCurrentChat
  const chatColumnClass = hideMainForAssetWorkspace
    ? 'hidden'
    : showAnimatedChatColumn
      ? `motion-safe:transition-[max-width,opacity,transform] motion-safe:duration-200 motion-safe:ease-in-out motion-reduce:transition-none ${
          showCollapsedChatRail
            ? 'md:pointer-events-none md:max-w-0 md:flex-[0_0_0px] md:-translate-x-3 md:opacity-0'
            : 'md:max-w-[999rem] md:flex-[1_1_0%] md:translate-x-0 md:opacity-100'
        }`
      : 'md:max-w-none md:translate-x-0 md:opacity-100'
  const assetDesktopWidth = showCollapsedChatRail
    ? `calc(100% - ${COLLAPSED_CHAT_RAIL_WIDTH}px)`
    : `${assetPanelWidth}px`
  const showAnimatedAssetColumn = showAssetWorkspace && !hideMainForAssetWorkspace

  return (
    <ShellTopBarSlotsProvider>
      <div data-ui="shell.root" className="flex h-screen overflow-hidden bg-gray-50">
        {mobileNavOpen && (
          <button className="fixed inset-0 bg-black/30 z-30 md:hidden"
            onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />
        )}
        <Sidebar
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
          collapsed={navCollapsed || assetChatFocusMode}
          onToggleCollapse={handleToggleNavCollapse}
        />
        <div data-ui="shell.workspace" className="flex flex-1 min-w-0 overflow-hidden">
          <div data-ui="shell.chat.column" className={`relative flex min-w-0 flex-1 overflow-hidden ${chatColumnClass}`}>
            <main
              data-ui="shell.main"
              className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
            >
              <VersionWarningBanner />
              <OnboardingExperience />
              <ShellTopBar
                showChatCollapseControl={routeHasCurrentChat && showAssetWorkspace && !assetChatFocusMode}
                onToggleChatCollapse={handleToggleChatColumn}
              />
              <header data-ui="shell.mobile-header" className="md:hidden sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
                <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700"
                  onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
                  <Menu size={16} />
                </button>
                <p className="text-sm font-semibold text-gray-900">{mobileTitle}</p>
              </header>
              <div className="flex-1 min-h-0 overflow-hidden">
                {shouldRenderMainRoute ? (
                  <div data-ui="shell.chat.route" className="h-full">
                    <Outlet />
                  </div>
                ) : null}
              </div>
            </main>
          </div>

          {showChatRailRegion ? (
            <CollapsedChatRail
              onExpand={handleExpandChatColumn}
              showAssetChat={showAssetChat}
              visible={showCollapsedChatRail}
            />
          ) : null}

          {showAssetWorkspace && !hideMainForAssetWorkspace ? (
            <button
              type="button"
              data-ui="shell.asset.resize"
              className={`hidden shrink-0 items-center justify-center overflow-hidden border-l bg-white text-stone-300 motion-safe:transition-[width,opacity,border-color] motion-safe:duration-200 motion-safe:ease-in-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 md:flex ${
                showCollapsedChatRail
                  ? 'pointer-events-none w-0 border-transparent opacity-0'
                  : 'w-4 border-stone-100 opacity-100 transition-colors hover:bg-stone-50 hover:text-stone-500'
              }`}
              style={{ width: showCollapsedChatRail ? 0 : ASSET_RESIZE_HANDLE_WIDTH }}
              onMouseDown={showCollapsedChatRail ? undefined : handleAssetResizeMouseDown}
              onKeyDown={showCollapsedChatRail ? undefined : handleAssetResizeKeyDown}
              aria-label="Resize assets column"
              title="Resize assets column"
              aria-hidden={showCollapsedChatRail}
              tabIndex={showCollapsedChatRail ? -1 : 0}
            >
              <GripVertical size={14} />
            </button>
          ) : null}

          {showAssetWorkspace ? (
            <aside
              data-ui="shell.asset"
              className={`border-l border-stone-200 bg-white ${
                hideMainForAssetWorkspace
                  ? 'hidden min-w-0 flex-1 md:flex'
                  : `hidden shrink-0 md:block ${showAnimatedAssetColumn ? 'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-in-out motion-reduce:transition-none' : ''}`
              }`}
              style={hideMainForAssetWorkspace ? undefined : { width: assetDesktopWidth }}
            >
              <AssetWorkspacePanel
                key={assetWorkspaceScope ? JSON.stringify(assetWorkspaceScope) : 'closed'}
                onToggleWorkspace={canToggleAssetWorkspace ? handleToggleAssetWorkspace : undefined}
                assetToggleDisabled={!canToggleAssetWorkspace}
                assetChatActive={showAssetChat}
              />
            </aside>
          ) : showDesktopAssetRail ? (
            <aside data-ui="shell.asset.rail" className="hidden w-12 shrink-0 border-l border-stone-200 bg-white md:flex md:flex-col">
              <div data-ui="shell.asset.rail.header" className={SHELL_RAIL_CLASS}>
                <div data-ui="shell.asset.rail.header.inner" className={`${SHELL_RAIL_INNER_CLASS} justify-center px-2`}>
                  <button
                    type="button"
                    onClick={handleToggleAssetWorkspace}
                    data-ui="shell.asset.rail.toggle"
                    className={SHELL_ICON_BUTTON_CLASS}
                    aria-label={routeAssetScope?.kind === 'project' ? 'Open project assets' : 'Open knowledge assets'}
                    title={routeAssetScope?.kind === 'project' ? 'Open project assets' : 'Open knowledge assets'}
                  >
                    <FolderOpen size={15} />
                  </button>
                </div>
              </div>
            </aside>
          ) : null}
        </div>

        {showAssetWorkspace && (
          <>
            <button
              data-ui="shell.asset.overlay"
              className="fixed inset-0 z-40 bg-black/35 md:hidden"
              onClick={handleCloseAssetWorkspace}
              aria-label="Close assets workspace"
            />
            <div data-ui="shell.asset.mobile" className="fixed inset-x-2 bottom-2 top-16 z-50 overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-2xl md:hidden">
              <AssetWorkspacePanel
                key={`${assetWorkspaceScope ? JSON.stringify(assetWorkspaceScope) : 'closed'}-mobile`}
                onToggleWorkspace={canToggleAssetWorkspace ? handleToggleAssetWorkspace : undefined}
                assetToggleDisabled={!canToggleAssetWorkspace}
                assetChatActive={showAssetChat}
              />
            </div>
          </>
        )}
      </div>
    </ShellTopBarSlotsProvider>
  )
}
