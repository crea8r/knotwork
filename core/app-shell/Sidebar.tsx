import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  FolderOpen,
  Hash,
  Inbox,
  MessageSquare,
  Pin,
  PlayCircle,
  Plus,
  Settings,
  X,
} from 'lucide-react'
import knotworkLogo from '@ui/assets/knotwork-logo.svg'
import { useCreateChannel, useInboxSummary } from '@modules/communication/frontend/api/channels'
import { api } from '@sdk'
import { useCreateProject, useProjectChannels, useProjectDashboard, useProjects } from "@modules/projects/frontend/api/projects"
import { useRuns } from "@modules/workflows/frontend/api/runs"
import { useAuthStore } from '@auth'
import { useActiveDistribution } from '@app-shell/distribution'
import { projectChannelPath, projectObjectivePath, projectPath } from '@app-shell/paths'
import type { Channel, Run } from '@data-models'

function NavItem({
  to,
  icon,
  label,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

function IconNavItem({
  to,
  icon,
  label,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      title={label}
      className={({ isActive }) =>
        `flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-100'
        }`
      }
    >
      {icon}
    </NavLink>
  )
}

function Divider({ collapsed }: { collapsed: boolean }) {
  return <div className={`border-t border-gray-100 my-1 ${collapsed ? 'mx-1' : 'mx-2'}`} />
}

type ProjectChannelNavItem = {
  channel: Channel
  label: string
  updatedAt: string
  kind: 'objective' | 'channel'
  objectiveId?: string
}

function channelIcon(channel: ProjectChannelNavItem) {
  if (channel.channel.channel_type === 'run') return <PlayCircle size={13} className="flex-shrink-0 text-indigo-500" />
  if (channel.kind === 'objective') return <Hash size={13} className="flex-shrink-0 text-stone-400" />
  return <MessageSquare size={13} className="flex-shrink-0 text-stone-400" />
}

export default function Sidebar({
  mobileOpen = false,
  onCloseMobile,
  collapsed = false,
  onToggleCollapse,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const distribution = useActiveDistribution()
  const enabledModules = new Set(distribution.enabledModules)
  const hasCommunication = enabledModules.has('communication')
  const hasProjects = enabledModules.has('projects')
  const hasAssets = enabledModules.has('assets')
  const hasWorkflows = enabledModules.has('workflows')
  const hasAdmin = enabledModules.has('admin')

  if (!hasCommunication && !hasProjects) {
    return (
      <MinimalSidebar
        mobileOpen={mobileOpen}
        onCloseMobile={onCloseMobile}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        displayName={distribution.displayName}
        defaultRoute={distribution.defaultRoute}
        hasAssets={hasAssets}
        hasWorkflows={hasWorkflows}
        hasAdmin={hasAdmin}
      />
    )
  }

  return (
    <WorkspaceSidebar
      mobileOpen={mobileOpen}
      onCloseMobile={onCloseMobile}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      displayName={distribution.displayName}
      defaultRoute={distribution.defaultRoute}
      hasAssets={hasAssets}
      hasAdmin={hasAdmin}
    />
  )
}

function MinimalSidebar({
  mobileOpen = false,
  onCloseMobile,
  collapsed = false,
  onToggleCollapse,
  displayName,
  defaultRoute,
  hasAssets,
  hasWorkflows,
  hasAdmin,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  displayName: string
  defaultRoute: string
  hasAssets: boolean
  hasWorkflows: boolean
  hasAdmin: boolean
}) {
  const navigate = useNavigate()
  const iconSize = collapsed ? 18 : 16
  const Item = collapsed ? IconNavItem : NavItem

  return (
    <aside className={`fixed md:static inset-y-0 left-0 z-40 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen transform transition-all duration-200 ${
      mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
    } ${collapsed ? 'w-14' : 'w-72'}`}>
      <div className={`flex items-center border-b border-gray-100 ${collapsed ? 'justify-center py-[13px]' : 'justify-between'}`}>
        {collapsed ? (
          <button
            onClick={() => navigate(defaultRoute)}
            className="hover:bg-gray-50 p-1.5 rounded-lg transition-colors"
            title={displayName}
          >
            <img src={knotworkLogo} alt={displayName} className="h-6 w-6" />
          </button>
        ) : (
          <>
            <button
              onClick={() => { navigate(defaultRoute); onCloseMobile?.() }}
              className="flex items-center gap-2 px-4 py-4 hover:bg-gray-50 transition-colors flex-1 text-left"
            >
              <img src={knotworkLogo} alt={displayName} className="h-6 w-6 flex-shrink-0" />
              <span className="font-semibold text-gray-900 text-sm">{displayName}</span>
            </button>
            <button onClick={onCloseMobile} className="md:hidden px-3 text-gray-400 hover:text-gray-700" aria-label="Close navigation">
              <X size={16} />
            </button>
          </>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto py-3 space-y-0.5 ${collapsed ? 'px-1 flex flex-col items-center' : 'px-2'}`}>
        {hasAssets && <Item to="/knowledge" icon={<BookOpen size={iconSize} />} label="Knowledge" onClick={onCloseMobile} />}
        {hasWorkflows && <Item to="/graphs" icon={<FolderOpen size={iconSize} />} label="Workflows" onClick={onCloseMobile} />}
        {hasWorkflows && <Item to="/runs" icon={<PlayCircle size={iconSize} />} label="Runs" onClick={onCloseMobile} />}
      </nav>

      {hasAdmin && (
        <div className={`border-t border-gray-100 p-2 ${collapsed ? 'flex justify-center' : ''}`}>
          {!collapsed ? (
            <NavLink
              to="/settings"
              onClick={onCloseMobile}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Settings size={16} />
              Settings
            </NavLink>
          ) : (
            <IconNavItem to="/settings" icon={<Settings size={18} />} label="Settings" onClick={onCloseMobile} />
          )}
        </div>
      )}

      <div className={`border-t border-gray-100 p-2 hidden md:flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>
    </aside>
  )
}

function WorkspaceSidebar({
  mobileOpen = false,
  onCloseMobile,
  collapsed = false,
  onToggleCollapse,
  displayName,
  defaultRoute,
  hasAssets,
  hasAdmin,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  displayName: string
  defaultRoute: string
  hasAssets: boolean
  hasAdmin: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
  const { data: inboxSummary } = useInboxSummary(workspaceId)
  const { data: projects = [] } = useProjects(workspaceId)
  const createProject = useCreateProject(workspaceId)
  const createChannel = useCreateChannel(workspaceId)

  const activeProjectSlug = useMemo(() => {
    const match = location.pathname.match(/^\/projects\/([^/]+)/)
    return match?.[1] ?? null
  }, [location.pathname])

  const { data: activeProjectDashboard } = useProjectDashboard(workspaceId, activeProjectSlug ?? '')
  const { data: activeProjectChannelsRaw = [] } = useProjectChannels(workspaceId, activeProjectSlug ?? '')
  const { data: runs = [] } = useRuns(workspaceId)
  const activeProjectId = activeProjectDashboard?.project.id ?? null

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(() => localStorage.getItem('kw-pinned-project'))
  const [showNewChannelDialog, setShowNewChannelDialog] = useState(false)
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
  const [newChannelProjectId, setNewChannelProjectId] = useState('')
  const [newChannelMessage, setNewChannelMessage] = useState('')
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')

  const Item = collapsed ? IconNavItem : NavItem
  const iconSize = collapsed ? 18 : 16
  const unreadCount = inboxSummary?.unread_count ?? 0
  const pinnedProject = useMemo(
    () => projects.find((project) => project.id === pinnedProjectId) ?? null,
    [pinnedProjectId, projects],
  )
  const recentProjects = useMemo(() => {
    const rest = projects.filter((project) => project.id !== pinnedProject?.id)
    return pinnedProject ? [pinnedProject, ...rest.slice(0, 4)] : rest.slice(0, 5)
  }, [pinnedProject, projects])
  const hasMoreProjects = projects.length > recentProjects.length
  const activeObjectives = activeProjectDashboard?.objectives ?? []
  const objectiveMap = useMemo(() => new Map(activeObjectives.map((objective) => [objective.id, objective])), [activeObjectives])
  const runByChannelName = useMemo<Map<string, Run>>(() => {
    return new Map<string, Run>(
      runs
        .filter((run) => run.project_id === activeProjectId)
        .map((run) => [`run:${run.id}`, run] as const),
    )
  }, [activeProjectId, runs])

  const activeProjectChannels = useMemo<ProjectChannelNavItem[]>(() => {
    return activeProjectChannelsRaw
      .filter((channel) => !channel.archived_at)
      .filter((channel) => channel.id !== activeProjectDashboard?.project.project_channel_id)
      .map((channel) => {
        if (channel.channel_type === 'objective' && channel.objective_id) {
          const objective = objectiveMap.get(channel.objective_id)
          return {
            channel,
            label: objective ? [objective.code, objective.title].filter(Boolean).join(' · ') : channel.name,
            updatedAt: channel.updated_at,
            kind: 'objective' as const,
            objectiveId: channel.objective_id,
          }
        }
        const run = channel.channel_type === 'run' ? runByChannelName.get(channel.name) : null
        return {
          channel,
          label: run?.name?.trim() || (run ? `Run ${run.id.slice(0, 8)}` : channel.name),
          updatedAt: channel.updated_at,
          kind: 'channel' as const,
        }
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [activeProjectChannelsRaw, activeProjectDashboard?.project.project_channel_id, objectiveMap, runByChannelName])

  const visibleChannels = activeProjectChannels.slice(0, 5)

  function openNewChannelDialog() {
    setNewChannelProjectId(activeProjectId ?? recentProjects[0]?.id ?? projects[0]?.id ?? '')
    setNewChannelMessage('')
    setShowNewChannelDialog(true)
  }

  function deriveChannelName() {
    const words = newChannelMessage
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .slice(0, 8)
    return words.join(' ') || 'New channel'
  }

  async function submitNewChannel() {
    const targetProjectId = newChannelProjectId || activeProjectId || recentProjects[0]?.id || projects[0]?.id
    if (!targetProjectId) return
    const targetProject = projects.find((project) => project.id === targetProjectId)
    if (!targetProject) return
    const channel = await createChannel.mutateAsync({
      name: deriveChannelName(),
      channel_type: 'normal',
      project_id: targetProjectId,
    })
    if (newChannelMessage.trim()) {
      await api.post(`/workspaces/${workspaceId}/channels/${channel.slug}/messages`, {
        content: newChannelMessage.trim(),
        role: 'user',
        author_type: 'human',
        author_name: 'You',
      })
    }
    setShowNewChannelDialog(false)
    onCloseMobile?.()
    navigate(projectChannelPath(targetProject.slug, channel.slug))
  }

  function openNewProjectDialog() {
    setNewProjectTitle('')
    setNewProjectDescription('')
    setShowNewProjectDialog(true)
  }

  async function submitNewProject() {
    const title = newProjectTitle.trim()
    const description = newProjectDescription.trim()
    if (!title || !description) return
    const project = await createProject.mutateAsync({ title, description })
    setShowNewProjectDialog(false)
    onCloseMobile?.()
    navigate(projectPath(project.slug))
  }

  function handleKnowledgeClick(e: React.MouseEvent<HTMLAnchorElement>) {
    onCloseMobile?.()
    if (!location.pathname.startsWith('/knowledge')) return
    e.preventDefault()
    navigate('/knowledge')
  }

  function isProjectExpanded(projectId: string) {
    if (expandedProjects[projectId] != null) return expandedProjects[projectId]
    return projectId === activeProjectId
  }

  function toggleProject(projectId: string) {
    const expanded = isProjectExpanded(projectId)
    const project = projects.find((item) => item.id === projectId)
    if (!expanded || projectId !== activeProjectId) {
      if (project) navigate(projectPath(project.slug))
    }
    setExpandedProjects((current) => ({
      ...current,
      [projectId]: !expanded,
    }))
  }

  function openNewObjective(projectId: string) {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    navigate(projectPath(project.slug), { state: { openObjectiveComposer: true } })
    onCloseMobile?.()
  }

  function togglePinProject(projectId: string) {
    const next = pinnedProjectId === projectId ? null : projectId
    setPinnedProjectId(next)
    if (next) {
      localStorage.setItem('kw-pinned-project', next)
    } else {
      localStorage.removeItem('kw-pinned-project')
    }
  }

  useEffect(() => {
    function handlePinnedProjectChanged(event: Event) {
      const customEvent = event as CustomEvent<{ projectId: string | null }>
      setPinnedProjectId(customEvent.detail?.projectId ?? null)
    }
    window.addEventListener('kw:pinned-project-changed', handlePinnedProjectChanged)
    return () => window.removeEventListener('kw:pinned-project-changed', handlePinnedProjectChanged)
  }, [])

  function isActiveChannel(channel: ProjectChannelNavItem) {
    if (channel.kind === 'objective' && channel.objectiveId) {
      const objective = activeObjectives.find((item) => item.id === channel.objectiveId)
      return objective ? location.pathname === projectObjectivePath(activeProjectDashboard?.project.slug ?? '', objective.slug) : false
    }
    return location.pathname === projectChannelPath(activeProjectDashboard?.project.slug ?? '', channel.channel.slug)
  }

  return (
    <>
      <aside className={`fixed md:static inset-y-0 left-0 z-40 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen transform transition-all duration-200 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      } ${collapsed ? 'w-14' : 'w-72'}`}>
      <div className={`flex items-center border-b border-gray-100 ${collapsed ? 'justify-center py-[13px]' : 'justify-between'}`}>
        {collapsed ? (
          <button
            onClick={() => navigate(defaultRoute)}
            className="hover:bg-gray-50 p-1.5 rounded-lg transition-colors"
            title={displayName}
          >
            <img src={knotworkLogo} alt={displayName} className="h-6 w-6" />
          </button>
        ) : (
          <>
            <button
              onClick={() => { navigate(defaultRoute); onCloseMobile?.() }}
              className="flex items-center gap-2 px-4 py-4 hover:bg-gray-50 transition-colors flex-1 text-left"
            >
              <img src={knotworkLogo} alt={displayName} className="h-6 w-6 flex-shrink-0" />
              <span className="font-semibold text-gray-900 text-sm">{displayName}</span>
            </button>
            <button onClick={onCloseMobile} className="md:hidden px-3 text-gray-400 hover:text-gray-700" aria-label="Close navigation">
              <X size={16} />
            </button>
          </>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto py-3 space-y-0.5 ${collapsed ? 'px-1 flex flex-col items-center' : 'px-2'}`}>
        {collapsed ? (
          <button
            type="button"
            onClick={openNewChannelDialog}
            title="New channel"
            aria-label="New channel"
            className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"
          >
            <Plus size={18} />
          </button>
        ) : (
          <button
            type="button"
            onClick={openNewChannelDialog}
            className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
          >
            <Plus size={16} />
            <span>New channel</span>
          </button>
        )}

        <Item
          to="/inbox"
          icon={(
            <span className="relative inline-flex">
              <Inbox size={iconSize} />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] leading-4 text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>
          )}
          label="Now"
          onClick={onCloseMobile}
        />

        {collapsed ? (
          <Item to={activeProjectId ? `/projects/${activeProjectId}` : '/projects?view=list'} icon={<FolderKanban size={iconSize} />} label="Work" onClick={onCloseMobile} />
        ) : (
          <div className="pt-2">
            <div className="flex items-center justify-between px-3 pb-1">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <FolderKanban size={12} />
                <span>Work</span>
              </div>
              <button
                type="button"
                onClick={openNewProjectDialog}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title="New project"
                aria-label="New project"
              >
                <Plus size={13} />
              </button>
            </div>
            <div className="space-y-1">
              {recentProjects.map((project) => {
                const expanded = isProjectExpanded(project.id)
                const active = project.id === activeProjectId
                return (
                  <div key={project.id} className="rounded-xl border border-transparent">
                    <div className={`flex items-center gap-1 rounded-lg px-2 py-1 ${active ? 'bg-brand-50' : 'hover:bg-gray-50'}`}>
                      <button
                        type="button"
                        onClick={() => toggleProject(project.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-white hover:text-gray-700"
                        aria-label={expanded ? 'Collapse project' : 'Expand project'}
                      >
                        <ChevronDown size={14} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
                      </button>
                      <Link
                        to={projectPath(project.slug)}
                        onClick={onCloseMobile}
                        className={`min-w-0 flex-1 rounded-md px-1.5 py-1 text-sm ${active ? 'font-semibold text-brand-800' : 'text-gray-700'}`}
                        title="Open project channel"
                      >
                        <span className="truncate block">{project.title}</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => togglePinProject(project.id)}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-white ${
                          pinnedProjectId === project.id ? 'text-brand-700' : 'text-gray-400 hover:text-gray-700'
                        }`}
                        title={pinnedProjectId === project.id ? 'Unpin project' : 'Pin project to Work'}
                        aria-label={pinnedProjectId === project.id ? 'Unpin project' : 'Pin project to Work'}
                      >
                        <Pin size={13} className={pinnedProjectId === project.id ? 'fill-current' : ''} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openNewObjective(project.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-white hover:text-gray-700"
                        title="New objective"
                        aria-label="New objective"
                      >
                        <span className="relative inline-flex h-4 w-4 items-center justify-center">
                          <Hash size={13} />
                          <Plus size={9} className="absolute -right-1 -top-1 rounded-full bg-white" />
                        </span>
                      </button>
                    </div>

                    {expanded && active && (
                      <div className="ml-8 mt-1 space-y-1 border-l border-gray-100 pl-3 pb-1">
                        {visibleChannels.map((channel) => (
                          <Link
                            key={channel.channel.id}
                            to={channel.kind === 'objective' && channel.objectiveId
                              ? projectObjectivePath(
                                project.slug,
                                activeObjectives.find((item) => item.id === channel.objectiveId)?.slug ?? channel.channel.slug,
                              )
                              : channel.channel.graph_id
                                ? `/graphs/${channel.channel.graph_id}?chat=1`
                              : projectChannelPath(project.slug, channel.channel.slug)}
                            onClick={onCloseMobile}
                            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                              isActiveChannel(channel)
                                ? 'bg-brand-50 text-brand-700 font-medium'
                                : 'text-stone-600 hover:bg-stone-100'
                            }`}
                          >
                            {channelIcon(channel)}
                            <span className="truncate text-xs">{channel.label}</span>
                          </Link>
                        ))}

                        <Link
                          to={`/projects/${project.slug}/assets`}
                          onClick={onCloseMobile}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                            location.pathname === `/projects/${project.slug}/assets`
                              ? 'bg-brand-50 text-brand-700 font-medium'
                              : 'text-stone-600 hover:bg-stone-100'
                          }`}
                        >
                          <FolderOpen size={13} className="flex-shrink-0" />
                          <span>Assets</span>
                        </Link>

                      </div>
                    )}
                  </div>
                )
              })}

              {hasMoreProjects && (
                <Link
                  to="/projects?view=list"
                  onClick={onCloseMobile}
                  className="block px-3 py-1 text-xs text-stone-500 hover:text-stone-900"
                >
                  See all
                </Link>
              )}

              {recentProjects.length === 0 && (
                <Link
                  to="/projects?view=list"
                  onClick={onCloseMobile}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                >
                  <FolderKanban size={16} />
                  Create your first project
                </Link>
              )}
            </div>
          </div>
        )}

        {hasAssets && (
          <>
            <Divider collapsed={collapsed} />
            <Item to="/knowledge" icon={<BookOpen size={iconSize} />} label="Knowledge" onClick={handleKnowledgeClick} />
          </>
        )}
      </nav>

      {hasAdmin && (
        <div className={`border-t border-gray-100 p-2 ${collapsed ? 'flex justify-center' : ''}`}>
          {!collapsed ? (
            <NavLink
              to="/settings"
              onClick={onCloseMobile}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Settings size={16} />
              Settings
            </NavLink>
          ) : (
            <IconNavItem to="/settings" icon={<Settings size={18} />} label="Settings" onClick={onCloseMobile} />
          )}
        </div>
      )}

      <div className={`border-t border-gray-100 p-2 hidden md:flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>
      </aside>
      {showNewChannelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="w-full max-w-2xl rounded-[32px] bg-white p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-stone-950">New channel</h2>
            <button
              type="button"
              onClick={() => setShowNewChannelDialog(false)}
              className="rounded-lg border border-stone-200 p-2 text-stone-500 hover:text-stone-900"
            >
              <X size={16} />
            </button>
          </div>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitNewChannel()
            }}
          >
            <label className="block text-sm text-stone-600">
              Project
              <select
                value={newChannelProjectId}
                onChange={(event) => setNewChannelProjectId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-stone-600">
              First message
              <textarea
                autoFocus
                rows={8}
                value={newChannelMessage}
                onChange={(event) => setNewChannelMessage(event.target.value)}
                placeholder="Start the thread here."
                className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewChannelDialog(false)}
                className="rounded-xl px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newChannelProjectId || createChannel.isPending}
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {createChannel.isPending ? 'Creating…' : 'Create channel'}
              </button>
            </div>
          </form>
          </div>
        </div>
      )}
      {showNewProjectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-stone-950">New project</h2>
              <button
                type="button"
                onClick={() => setShowNewProjectDialog(false)}
                className="rounded-lg border border-stone-200 p-2 text-stone-500 hover:text-stone-900"
              >
                <X size={16} />
              </button>
            </div>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submitNewProject()
              }}
            >
              <label className="block text-sm text-stone-600">
                Title
                <input
                  autoFocus
                  value={newProjectTitle}
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-stone-200 px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                  placeholder="Project name"
                />
              </label>

              <label className="block text-sm text-stone-600">
                Description
                <textarea
                  value={newProjectDescription}
                  onChange={(event) => setNewProjectDescription(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-2xl border border-stone-200 px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                  placeholder="What is this project for?"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewProjectDialog(false)}
                  className="rounded-full px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createProject.isPending || !newProjectTitle.trim() || !newProjectDescription.trim()}
                  className="rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  {createProject.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
