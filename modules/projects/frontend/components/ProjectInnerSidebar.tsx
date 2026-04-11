import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, Hash, MessageSquare, PlayCircle, Star } from 'lucide-react'
import type { ProjectActiveItem, ProjectChannelNavItem } from '@modules/projects/frontend/pages/ProjectDetailPage'

interface ProjectInnerSidebarProps {
  projectTitle: string
  channels: ProjectChannelNavItem[]
  activeItem: ProjectActiveItem
  onSelectHome: () => void
  onSelectAssets: () => void
  onSelectObjective: (objectiveId: string) => void
  onSelectChannel: (channelId: string) => void
}

const VISIBLE_SLOTS = 2

export default function ProjectInnerSidebar({
  projectTitle,
  channels,
  activeItem,
  onSelectHome,
  onSelectAssets,
  onSelectObjective,
  onSelectChannel,
}: ProjectInnerSidebarProps) {
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => [...channels].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [channels],
  )
  const visible = sorted.slice(0, VISIBLE_SLOTS)
  const remaining = sorted.slice(VISIBLE_SLOTS)

  function isActiveChannel(item: ProjectChannelNavItem) {
    if (item.kind === 'objective' && item.objectiveId) {
      return activeItem.kind === 'objective' && activeItem.objectiveId === item.objectiveId
    }
    return activeItem.kind === 'channel' && activeItem.channelId === item.channel.id
  }

  function iconForItem(item: ProjectChannelNavItem) {
    if (item.channel.channel_type === 'run') return <PlayCircle size={13} className="flex-shrink-0 text-indigo-500" />
    if (item.kind === 'objective') return <Hash size={13} className="flex-shrink-0 text-stone-400" />
    return <MessageSquare size={13} className="flex-shrink-0 text-stone-400" />
  }

  function renderChannelButton(item: ProjectChannelNavItem) {
    return (
      <button
        key={item.channel.id}
        onClick={() => {
          if (item.kind === 'objective' && item.objectiveId) {
            onSelectObjective(item.objectiveId)
            return
          }
          onSelectChannel(item.channel.id)
        }}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
          isActiveChannel(item)
            ? 'bg-brand-50 text-brand-700 font-medium'
            : 'text-stone-600 hover:bg-stone-100'
        }`}
      >
        {iconForItem(item)}
        <span className="truncate text-xs">{item.label}</span>
      </button>
    )
  }

  return (
    <aside className="w-56 flex-shrink-0 border-r border-stone-200 flex flex-col bg-white overflow-y-auto">
      <nav className="flex-1 py-2 px-2 space-y-0.5">

        {/* Pinned: project-wide channel */}
        <button
          onClick={onSelectHome}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeItem.kind === 'home'
              ? 'bg-brand-50 text-brand-700 font-medium'
              : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <Star size={13} className="flex-shrink-0 text-yellow-400" />
          <span className="truncate">{projectTitle}</span>
        </button>

        {visible.map(renderChannelButton)}

        {/* Expand / collapse remaining */}
        {remaining.length > 0 && (
          <>
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full px-2 py-1 text-xs text-stone-400 hover:text-stone-600 text-left transition-colors"
            >
              {showAll ? 'Show less' : `+ ${remaining.length} more`}
            </button>
            {showAll && remaining.map(renderChannelButton)}
          </>
        )}

        {/* Divider */}
        <div className="border-t border-stone-100 my-1 mx-1" />

        {/* Assets */}
        <button
          onClick={onSelectAssets}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeItem.kind === 'assets'
              ? 'bg-brand-50 text-brand-700 font-medium'
              : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <FolderOpen size={13} className="flex-shrink-0" />
          <span>Assets</span>
        </button>

      </nav>

      <div className="border-t border-stone-100 p-2">
        <Link to="/projects?view=list" className="block rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-900">
          Switch project
        </Link>
      </div>
    </aside>
  )
}
