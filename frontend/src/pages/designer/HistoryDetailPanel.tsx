import { FileEdit, Globe, Pencil } from 'lucide-react'
import Badge from '@/components/shared/Badge'
import Btn from '@/components/shared/Btn'
import HistoryDetailCard from './HistoryDetailCard'
import type { HistorySelection } from './graphVersionUtils'
import { formatVersionName, formatVersionStamp } from './graphVersionUtils'
import type { GraphVersion } from '@/types'

export default function HistoryDetailPanel({
  historySelection,
  selectedHistoryDraft,
  selectedHistoryVersion,
  graphDefaultVersionId,
  resolvedParentVersionId,
  versionActionPending,
  onOpenVersion,
  onEdit,
  onRename,
  onView,
  onSetDefault,
  onFork,
  onArchive,
  onUnarchive,
  onDelete,
  onManagePublic,
  onPublish,
}: {
  historySelection: HistorySelection | null
  selectedHistoryDraft: GraphVersion | null
  selectedHistoryVersion: GraphVersion | null
  graphDefaultVersionId: string | null
  resolvedParentVersionId: string | null
  versionActionPending: boolean
  onOpenVersion: (version: GraphVersion) => void
  onEdit: (version: GraphVersion) => void
  onRename: (version: GraphVersion) => void
  onView: (version: GraphVersion) => void
  onSetDefault: (version: GraphVersion) => void
  onFork: (version: GraphVersion) => void
  onArchive: (version: GraphVersion) => void
  onUnarchive: (version: GraphVersion) => void
  onDelete: (version: GraphVersion) => void
  onManagePublic: (version: GraphVersion) => void
  onPublish: () => void
}) {
  if (historySelection?.kind === 'root-draft' && selectedHistoryDraft) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <FileEdit size={14} className="text-amber-500 flex-shrink-0" />
            <p className="truncate text-sm font-semibold text-amber-900">{formatVersionName(selectedHistoryDraft)}</p>
            <Badge variant="orange">Draft</Badge>
            <Badge variant="orange">Live</Badge>
          </div>
          <p className="mt-1 text-xs text-amber-700">{formatVersionStamp(selectedHistoryDraft.updated_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="secondary" onClick={onPublish}>
            <Globe size={12} /> Publish
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => onRename(selectedHistoryDraft)}>
            <Pencil size={12} /> Rename
          </Btn>
        </div>
      </div>
    )
  }

  if (historySelection?.kind === 'draft' && selectedHistoryDraft && selectedHistoryVersion) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <FileEdit size={14} className="text-amber-500 flex-shrink-0" />
            <p className="truncate text-sm font-semibold text-amber-900">{formatVersionName(selectedHistoryDraft)}</p>
            <Badge variant="orange">Draft</Badge>
            <Badge variant="orange">Live</Badge>
          </div>
          <p className="mt-1 text-xs text-amber-700">
            Based on {formatVersionName(selectedHistoryVersion)} · {formatVersionStamp(selectedHistoryDraft.updated_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="secondary" onClick={() => onOpenVersion(selectedHistoryVersion)}>
            <Pencil size={12} /> Edit draft
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => onRename(selectedHistoryDraft)}>
            <Pencil size={12} /> Rename
          </Btn>
        </div>
      </div>
    )
  }

  if (selectedHistoryVersion) {
    return (
      <HistoryDetailCard
        version={selectedHistoryVersion}
        graphDefaultVersionId={graphDefaultVersionId}
        isActiveDraftBase={resolvedParentVersionId === selectedHistoryVersion.id}
        isPending={versionActionPending}
        onEdit={onEdit}
        onView={onView}
        onRename={onRename}
        onSetDefault={onSetDefault}
        onFork={onFork}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
        onManagePublic={onManagePublic}
      />
    )
  }

  return (
    <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
      Select a version or draft node to interact with it.
    </p>
  )
}
