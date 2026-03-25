import { Archive, FileEdit, GitBranch, Globe, Pencil, Star, Trash2 } from 'lucide-react'
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <GitBranch size={14} className="flex-shrink-0 text-gray-400" />
            <p className="truncate text-sm font-semibold text-gray-900">{formatVersionName(version)}</p>
            {isDefault && <Badge variant="green">Default</Badge>}
            {isActiveDraftBase && version.draft && <Badge variant="orange">Draft active</Badge>}
            {isArchived && <Badge variant="gray">Archived</Badge>}
            {version.is_public && (
              <button
                onClick={() => onManagePublic(version)}
                className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors"
              >
                <Globe size={10} /> Public
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Created {formatVersionStamp(version.version_created_at)} · {version.run_count} run(s)
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!version.draft && (
          <Btn size="sm" variant="primary" disabled={isPending} onClick={() => onEdit(version)}>
            <FileEdit size={12} /> Edit
          </Btn>
        )}
        <Btn size="sm" variant="secondary" disabled={isPending} onClick={() => onView(version)}>View</Btn>
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onRename(version)}>
          <Pencil size={12} /> Rename
        </Btn>
        <Btn size="sm" variant={isDefault ? 'ghost' : 'secondary'} disabled={isPending || isDefault} onClick={() => onSetDefault(version)}>
          <Star size={12} /> {isDefault ? 'Default' : 'Set as default'}
        </Btn>
        {!version.is_public ? (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onManagePublic(version)}>
            <Globe size={12} /> Make public
          </Btn>
        ) : (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onManagePublic(version)}>
            <Globe size={12} /> Manage public link
          </Btn>
        )}
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onFork(version)}>
          Copy as new workflow
        </Btn>
        {isArchived ? (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onUnarchive(version)}>Unarchive</Btn>
        ) : (
          <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onArchive(version)}>
            <Archive size={12} /> Archive
          </Btn>
        )}
        <Btn size="sm" variant="ghost" disabled={isPending} onClick={() => onDelete(version)}>
          <Trash2 size={12} /> Delete
        </Btn>
      </div>
    </div>
  )
}
