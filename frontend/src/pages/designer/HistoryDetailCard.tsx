import { Archive, Copy, FileEdit, GitBranch, Globe, Pencil, Star, Trash2 } from 'lucide-react'
import Badge from '@/components/shared/Badge'
import Btn from '@/components/shared/Btn'
import type { GraphVersion } from '@/types'
import { formatVersionName, formatVersionStamp } from './graphVersionUtils'

export default function HistoryDetailCard({
  version,
  graphDefaultVersionId,
  isActiveDraftBase,
  isPending,
  onView,
  onRename,
  onSetDefault,
  onFork,
  onArchive,
  onUnarchive,
  onDelete,
  onManagePublic,
  onEdit,
}: {
  version: GraphVersion
  graphDefaultVersionId: string | null
  isActiveDraftBase: boolean
  isPending: boolean
  onView: (version: GraphVersion) => void
  onRename: (version: GraphVersion) => void
  onSetDefault: (version: GraphVersion) => void
  onFork: (version: GraphVersion) => void
  onArchive: (version: GraphVersion) => void
  onUnarchive: (version: GraphVersion) => void
  onDelete: (version: GraphVersion) => void
  onManagePublic: (version: GraphVersion) => void
  onEdit: (version: GraphVersion) => void
}) {
  const isDefault = graphDefaultVersionId === version.id
  const isArchived = !!version.archived_at

  return (
    <div className={`rounded-xl border p-4 ${isDefault ? 'border-green-300 bg-green-50/60' : 'border-gray-200 bg-white'}`}>
      {/* Name row — name is clickable "view", pencil = rename, globe = public link */}
      <div className="flex items-start gap-2 mb-1">
        <GitBranch size={14} className="flex-shrink-0 text-gray-400 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              className="text-sm font-semibold text-brand-700 hover:underline underline-offset-2 truncate text-left"
              onClick={() => onView(version)}
              title="View this version"
            >
              {formatVersionName(version)}
            </button>
            <button
              className="p-0.5 text-gray-400 hover:text-gray-700 flex-shrink-0"
              onClick={() => onRename(version)}
              title="Rename"
              disabled={isPending}
            >
              <Pencil size={11} />
            </button>
            {version.is_public && (
              <button
                className="p-0.5 text-purple-500 hover:text-purple-700 flex-shrink-0"
                onClick={() => onManagePublic(version)}
                title="View public link"
              >
                <Globe size={12} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {isDefault && <Badge variant="green">Default</Badge>}
            {isActiveDraftBase && version.draft && <Badge variant="orange">Draft active</Badge>}
            {isArchived && <Badge variant="gray">Archived</Badge>}
            <span className="text-xs text-gray-400">
              {formatVersionStamp(version.version_created_at)} · {version.run_count} run(s)
            </span>
          </div>
        </div>
      </div>

      {/* Primary actions: Edit + Clone */}
      <div className="mt-3 flex flex-wrap gap-2">
        {!version.draft && (
          <Btn size="sm" variant="primary" disabled={isPending} onClick={() => onEdit(version)}>
            <FileEdit size={12} /> Edit
          </Btn>
        )}
        <Btn size="sm" variant="secondary" disabled={isPending} onClick={() => onFork(version)}>
          <Copy size={12} /> Clone workflow
        </Btn>
      </div>

      {/* Secondary actions: Default + Public */}
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn size="sm" variant={isDefault ? 'ghost' : 'secondary'} disabled={isPending || isDefault} onClick={() => onSetDefault(version)}>
          <Star size={12} /> Default
        </Btn>
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onManagePublic(version)}>
          <Globe size={12} /> {version.is_public ? 'Edit public link' : 'Make public'}
        </Btn>
      </div>

      {/* Destructive actions: Archive + Delete (same row, delete in red) */}
      <div className="mt-2 flex flex-wrap gap-2">
        {isArchived ? (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onUnarchive(version)}>Unarchive</Btn>
        ) : (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onArchive(version)}>
            <Archive size={12} /> Archive
          </Btn>
        )}
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onDelete(version)}
          className="text-red-600 hover:text-red-700 hover:bg-red-50">
          <Trash2 size={12} /> Delete
        </Btn>
      </div>
    </div>
  )
}
