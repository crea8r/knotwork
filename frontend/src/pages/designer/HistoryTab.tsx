import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Globe, Pencil, X } from 'lucide-react'
import HistoryDetailPanel from './HistoryDetailPanel'
import VersionHistoryCanvas from './VersionHistoryCanvas'
import type { HistorySelection } from './graphVersionUtils'
import { formatVersionName } from './graphVersionUtils'
import type { GraphVersion } from '@/types'

export default function HistoryTab({
  workspaceId, graphId,
  namedVersions, activeDraft, versionsLoading,
  showArchivedVersions, setShowArchivedVersions,
  graphDefaultVersionId, resolvedParentVersionId,
  versionActionPending,
  onOpenVersion, onRenameVersion, onViewVersion,
  onSetDefault, onForkVersion, onArchiveVersion, onUnarchiveVersion, onDeleteVersion,
  onManagePublic, onPublish,
  historySelection, onSelectHistoryItem,
}: {
  workspaceId: string
  graphId: string
  namedVersions: GraphVersion[]
  activeDraft: GraphVersion | null
  versionsLoading: boolean
  showArchivedVersions: boolean
  setShowArchivedVersions: (v: boolean) => void
  graphDefaultVersionId: string | null
  resolvedParentVersionId: string | null
  versionActionPending: boolean
  onOpenVersion: (version: GraphVersion) => void
  onRenameVersion: (version: GraphVersion) => void
  onViewVersion: (version: GraphVersion) => void
  onSetDefault: (version: GraphVersion) => void
  onForkVersion: (version: GraphVersion) => void
  onArchiveVersion: (version: GraphVersion) => void
  onUnarchiveVersion: (version: GraphVersion) => void
  onDeleteVersion: (version: GraphVersion) => void
  onManagePublic: (version: GraphVersion) => void
  onPublish: () => void
  historySelection: HistorySelection | null
  onSelectHistoryItem: (sel: HistorySelection) => void
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => { if (!historySelection) setDetailOpen(false) }, [historySelection])

  const rootDraft = activeDraft?.parent_version_id === null ? activeDraft : null

  // Node ID to zoom to in the canvas (null = fit-to-view)
  const zoomToNodeId = detailOpen && historySelection
    ? (historySelection.kind === 'version' ? `v:${historySelection.id}` : `d:${historySelection.id}`)
    : null

  // Derive objects for the detail panel
  const historyVersionMap = useMemo(() => new Map(namedVersions.map((v) => [v.id, v])), [namedVersions])
  const selectedDraftParentId = historySelection?.kind === 'draft' ? historySelection.parentVersionId : null
  const selectedHistoryVersion = historySelection?.kind === 'version'
    ? (historyVersionMap.get(historySelection.id) ?? null)
    : selectedDraftParentId ? (historyVersionMap.get(selectedDraftParentId) ?? null) : null
  const selectedHistoryDraft = historySelection?.kind === 'root-draft'
    ? (activeDraft?.parent_version_id === null ? activeDraft : null)
    : historySelection?.kind === 'draft'
      ? (selectedHistoryVersion?.draft?.id === historySelection.id ? selectedHistoryVersion.draft : null)
      : null

  const detailProps = {
    historySelection, selectedHistoryDraft, selectedHistoryVersion,
    graphDefaultVersionId, resolvedParentVersionId, versionActionPending,
    onOpenVersion, onEdit: onOpenVersion, onRename: onRenameVersion, onView: onViewVersion,
    onSetDefault, onFork: onForkVersion, onArchive: onArchiveVersion,
    onUnarchive: onUnarchiveVersion, onDelete: onDeleteVersion,
    onManagePublic, onPublish,
  }

  const headerItem = selectedHistoryVersion ?? selectedHistoryDraft
  const detailContent: ReactNode | null = detailOpen && historySelection ? (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 flex-shrink-0 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {headerItem ? formatVersionName(headerItem) : (historySelection.kind === 'version' ? 'Version' : 'Draft')}
          </p>
          {headerItem && (
            <button className="p-0.5 text-gray-400 hover:text-gray-700 flex-shrink-0" onClick={() => onRenameVersion(headerItem)} title="Rename">
              <Pencil size={11} />
            </button>
          )}
          {selectedHistoryVersion?.is_public && (
            <button className="p-0.5 text-purple-500 hover:text-purple-700 flex-shrink-0" onClick={() => onManagePublic(selectedHistoryVersion)} title="Public link">
              <Globe size={12} />
            </button>
          )}
        </div>
        <button onClick={() => setDetailOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex-shrink-0" aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <div className="overflow-y-auto p-4">
        <HistoryDetailPanel workspaceId={workspaceId} graphId={graphId} {...detailProps} />
      </div>
    </>
  ) : null

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50/40">
      <div className="border-b border-gray-200 bg-white px-5 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Version history</p>
            <p className="mt-0.5 text-xs text-gray-500">Siblings share a row · click a node to inspect</p>
          </div>
          <button onClick={() => setShowArchivedVersions(!showArchivedVersions)} className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap">
            {showArchivedVersions ? 'Hide archived' : 'Show archived'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {versionsLoading
          ? <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading…</div>
          : <VersionHistoryCanvas
              namedVersions={namedVersions} rootDraft={rootDraft}
              graphDefaultVersionId={graphDefaultVersionId}
              historySelection={historySelection}
              zoomToNodeId={zoomToNodeId}
              detailContent={detailContent}
              onSelectHistoryItem={(sel) => { onSelectHistoryItem(sel); setDetailOpen(true) }}
              onBackgroundClick={() => setDetailOpen(false)}
            />}
      </div>
    </div>
  )
}
