import { useEffect, useMemo, useState } from 'react'
import { Archive, ChevronDown, Pin, Plus, Send } from 'lucide-react'
import Badge from '@/components/shared/Badge'
import Btn from '@/components/shared/Btn'
import type { Run, Objective } from '@/types'
import type { ProjectChannelNavItem } from '@/pages/ProjectDetailPage'

interface ProjectSummary {
  id: string
  title: string
  status: string
  deadline?: string | null
  description?: string | null
  run_count: number
  latest_status_update?: { summary: string; created_at: string } | null
}

interface ProjectDashboardProps {
  project: ProjectSummary
  objectives: Objective[]
  runs: Run[]
  channels: ProjectChannelNavItem[]
  onObjectiveClick: (id: string) => void
  onRunClick: (id: string) => void
  onChannelClick: (channel: ProjectChannelNavItem) => void
  onUpdateStatus: () => void
  onNewObjective?: () => void
  pinned?: boolean
  onTogglePin?: () => void
}

type DashboardFilter = 'objectives' | 'runs' | 'channels'

const PAGE_SIZE = 10

function statusVariant(status: string): 'gray' | 'green' | 'orange' | 'red' {
  if (status === 'done' || status === 'completed') return 'green'
  if (status === 'blocked' || status === 'failed') return 'red'
  if (status === 'in_progress' || status === 'running') return 'orange'
  return 'gray'
}

export default function ProjectDashboard({
  project,
  objectives,
  runs,
  channels,
  onObjectiveClick,
  onRunClick,
  onChannelClick,
  onUpdateStatus,
  onNewObjective,
  pinned = false,
  onTogglePin,
}: ProjectDashboardProps) {
  const storageKey = `kw-dash-collapsed-${project.id}`
  const seenKey = `kw-dash-seen-${project.id}`

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(storageKey) === 'true'
  })
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('objectives')
  const [pageByFilter, setPageByFilter] = useState<Record<DashboardFilter, number>>({
    objectives: 0,
    runs: 0,
    channels: 0,
  })

  const channelItems = useMemo(() => (
    channels
      .filter((channel) => channel.kind === 'channel')
      .sort((a, b) => {
        if (!!a.archivedAt === !!b.archivedAt) {
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        }
        return a.archivedAt ? 1 : -1
      })
  ), [channels])
  const currentItems = activeFilter === 'objectives'
    ? objectives
    : activeFilter === 'runs'
      ? runs
      : channelItems
  const currentPage = pageByFilter[activeFilter]
  const pageCount = Math.ceil(currentItems.length / PAGE_SIZE)
  const pagedItems = currentItems.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  // Auto-expand when there's a new status update since last seen
  useEffect(() => {
    const lastSeen = localStorage.getItem(seenKey)
    const latestTs = project.latest_status_update?.created_at
    if (latestTs && (!lastSeen || new Date(latestTs) > new Date(lastSeen))) {
      setCollapsed(false)
      localStorage.removeItem(storageKey)
    }
  }, [project.latest_status_update?.created_at, seenKey, storageKey])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(storageKey, String(next))
    if (!next && project.latest_status_update?.created_at) {
      localStorage.setItem(seenKey, project.latest_status_update.created_at)
    }
  }

  function switchFilter(next: DashboardFilter) {
    setActiveFilter(next)
    setPageByFilter((current) => ({ ...current, [next]: 0 }))
  }

  function changePage(next: number) {
    setPageByFilter((current) => ({ ...current, [activeFilter]: next }))
  }

  return (
    <div className="border-b border-stone-200 bg-[#faf7f1] flex-shrink-0">
      {/* Header row — always visible */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-2 text-left flex-1 min-w-0 hover:opacity-80 transition-opacity"
        >
          <span className="text-sm font-medium text-stone-700 truncate">
            {project.latest_status_update?.summary ?? project.description ?? project.title}
          </span>
          <ChevronDown
            size={14}
            className={`flex-shrink-0 text-stone-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          />
        </button>
        <div className="flex gap-1 ml-2 flex-shrink-0">
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                pinned ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-transparent text-stone-400 hover:border-stone-200 hover:bg-white hover:text-stone-700'
              }`}
              title={pinned ? 'Unpin project from Work' : 'Pin project to Work'}
              aria-label={pinned ? 'Unpin project from Work' : 'Pin project to Work'}
            >
              <Pin size={13} className={pinned ? 'fill-current' : ''} />
            </button>
          )}
          {onNewObjective && (
            <Btn size="sm" variant="ghost" onClick={onNewObjective}>
              <Plus size={12} /> Objective
            </Btn>
          )}
          <Btn size="sm" variant="ghost" onClick={onUpdateStatus}>
            <Send size={12} /> Update
          </Btn>
        </div>
      </div>

      {/* Body — shown when expanded */}
      {!collapsed && (
        <div className="px-4 pb-3 space-y-1.5 border-t border-stone-200">
          <div className="flex flex-wrap gap-1 pt-2">
            {([
              ['objectives', `Objectives ${objectives.length}`],
              ['runs', `Runs ${runs.length}`],
              ['channels', `Channels ${channelItems.length}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => switchFilter(key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  activeFilter === key
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeFilter === 'objectives' && (
            pagedItems.length === 0 ? (
              <p className="text-xs text-stone-400 py-2">
                No objectives yet. Add one to track what this project is trying to achieve.
              </p>
            ) : (
              (pagedItems as Objective[]).map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => onObjectiveClick(obj.id)}
                  className="w-full flex items-center gap-3 text-left hover:bg-stone-100 rounded-lg px-2 py-1.5 transition-colors"
                >
                  <Badge variant={statusVariant(obj.status)} size="sm">
                    {obj.status.replace('_', ' ')}
                  </Badge>
                  <span className="text-sm text-stone-800 flex-1 truncate">
                    {[obj.code, obj.title].filter(Boolean).join(' · ')}
                  </span>
                  {obj.progress_percent !== undefined && obj.progress_percent !== null && (
                    <span className="text-xs text-stone-400 flex-shrink-0">{obj.progress_percent}%</span>
                  )}
                </button>
              ))
            )
          )}

          {activeFilter === 'runs' && (
            pagedItems.length === 0 ? (
              <p className="text-xs text-stone-400 py-2">No runs yet for this project.</p>
            ) : (
              (pagedItems as Run[]).map((run) => (
                <button
                  key={run.id}
                  onClick={() => onRunClick(run.id)}
                  className="w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-stone-100"
                >
                  <Badge variant={statusVariant(run.status)} size="sm">
                    {run.status.replace('_', ' ')}
                  </Badge>
                  <span className="flex-1 truncate text-sm text-stone-800">
                    {run.name?.trim() || `Run ${run.id.slice(0, 8)}`}
                  </span>
                </button>
              ))
            )
          )}

          {activeFilter === 'channels' && (
            pagedItems.length === 0 ? (
              <p className="text-xs text-stone-400 py-2">No additional channels yet for this project.</p>
            ) : (
              (pagedItems as ProjectChannelNavItem[]).map((channel) => (
                <button
                  key={channel.channel.id}
                  onClick={() => onChannelClick(channel)}
                  className="w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-stone-100"
                >
                  {channel.archivedAt ? <Archive size={13} className="text-stone-400" /> : null}
                  <span className="flex-1 truncate text-sm text-stone-800">{channel.label}</span>
                </button>
              ))
            )
          )}

          {pageCount > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => changePage(currentPage - 1)}
                disabled={currentPage === 0}
                className="text-xs text-stone-500 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-[11px] text-stone-400">
                {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => changePage(currentPage + 1)}
                disabled={currentPage >= pageCount - 1}
                className="text-xs text-stone-500 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
