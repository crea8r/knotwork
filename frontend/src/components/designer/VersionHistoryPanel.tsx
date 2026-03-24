/**
 * VersionHistoryPanel — timeline/branch view of all named versions for a workflow.
 * Shows: version name, ID, created date, run count, production highlight, draft branch.
 */
import { useState } from 'react'
import { GitBranch, Star, Archive, Trash2, Copy } from 'lucide-react'
import {
  useGraphVersions,
  useSetProduction,
  useArchiveVersion,
  useDeleteVersion,
  useRenameVersion,
  useForkVersion,
} from '@/api/graphs'
import { useAuthStore } from '@/store/auth'
import type { GraphVersion } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

interface Props {
  graphId: string
  productionVersionId: string | null
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function VersionRow({
  version,
  isProduction,
  graphId,
  workspaceId,
  onSetProduction,
  onArchive,
  onDelete,
  onFork,
}: {
  version: GraphVersion
  isProduction: boolean
  graphId: string
  workspaceId: string
  onSetProduction: (id: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onFork: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(version.version_name ?? '')
  const renameVersion = useRenameVersion(workspaceId, graphId)

  function commitRename() {
    if (nameInput.trim() && nameInput !== version.version_name) {
      renameVersion.mutate({ versionRowId: version.id, name: nameInput.trim() })
    }
    setEditing(false)
  }

  return (
    <div
      className={`relative flex items-start gap-3 rounded-lg border px-4 py-3 ${
        isProduction
          ? 'border-green-300 bg-green-50'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      {/* Timeline dot */}
      <div className="mt-1 flex-shrink-0">
        <div
          className={`h-3 w-3 rounded-full border-2 ${
            isProduction ? 'border-green-500 bg-green-500' : 'border-gray-400 bg-white'
          }`}
        />
      </div>

      <div className="min-w-0 flex-1">
        {/* Name row */}
        <div className="flex items-center gap-2 flex-wrap">
          {editing ? (
            <input
              autoFocus
              className="border border-brand-400 rounded px-1.5 py-0.5 text-sm font-medium focus:outline-none"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <button
              className="text-sm font-medium text-gray-900 hover:underline text-left"
              onClick={() => setEditing(true)}
              title="Click to rename"
            >
              {version.version_name ?? 'Unnamed'}
            </button>
          )}
          {isProduction && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 border border-green-200">
              Production
            </span>
          )}
          <span className="font-mono text-xs text-gray-400">{version.version_id}</span>
        </div>

        {/* Meta row */}
        <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-400">
          <span>{fmt(version.version_created_at)}</span>
          <span>{version.run_count} run{version.run_count !== 1 ? 's' : ''}</span>
        </div>

        {/* Draft branch indicator */}
        {version.draft && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
            <GitBranch size={11} />
            <span className="font-medium">Draft</span>
            <span className="text-amber-500">
              · last edited {fmt(version.draft.updated_at)}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isProduction && (
          <button
            title="Set as production"
            className="rounded p-1 text-gray-400 hover:text-green-600 hover:bg-green-50"
            onClick={() => onSetProduction(version.id)}
          >
            <Star size={14} />
          </button>
        )}
        <button
          title="Fork to new workflow"
          className="rounded p-1 text-gray-400 hover:text-brand-600 hover:bg-brand-50"
          onClick={() => onFork(version.id)}
        >
          <Copy size={14} />
        </button>
        {!isProduction && (
          <>
            <button
              title="Archive version"
              className="rounded p-1 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
              onClick={() => onArchive(version.id)}
            >
              <Archive size={14} />
            </button>
            {version.run_count === 0 && !version.is_public && (
              <button
                title="Delete version"
                className="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50"
                onClick={() => onDelete(version.id)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function VersionHistoryPanel({ graphId, productionVersionId }: Props) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const [includeArchived, setIncludeArchived] = useState(false)
  const { data: versions, isLoading } = useGraphVersions(workspaceId, graphId, includeArchived)
  const setProduction = useSetProduction(workspaceId, graphId)
  const archiveVersion = useArchiveVersion(workspaceId, graphId)
  const deleteVersion = useDeleteVersion(workspaceId, graphId)
  const forkVersion = useForkVersion(workspaceId, graphId)

  function handleFork(versionRowId: string) {
    const name = prompt('Name for the new workflow:')
    if (name?.trim()) {
      forkVersion.mutate({ versionRowId, name: name.trim() })
    }
  }

  function handleDelete(versionRowId: string) {
    if (confirm('Delete this version? This cannot be undone.')) {
      deleteVersion.mutate(versionRowId)
    }
  }

  const namedVersions = versions?.filter((v) => v.version_id !== null) ?? []
  const rootDraft = versions?.find((v) => v.version_id === null && v.parent_version_id === null)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Version history</h3>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="h-3 w-3"
          />
          Show archived
        </label>
      </div>

      {isLoading && <p className="text-xs text-gray-400">Loading…</p>}

      {/* Root draft (no parent version yet) */}
      {rootDraft && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <GitBranch size={12} />
          <span className="font-medium">Draft</span>
          <span className="text-amber-600">· last edited {fmt(rootDraft.updated_at)}</span>
        </div>
      )}

      {/* Version timeline */}
      <div className="relative">
        {/* Vertical line */}
        {namedVersions.length > 1 && (
          <div className="absolute left-[22px] top-4 bottom-4 w-px bg-gray-200" />
        )}
        <div className="space-y-2">
          {namedVersions.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              isProduction={v.id === productionVersionId}
              graphId={graphId}
              workspaceId={workspaceId}
              onSetProduction={(id) => setProduction.mutate(id)}
              onArchive={(id) => archiveVersion.mutate(id)}
              onDelete={handleDelete}
              onFork={handleFork}
            />
          ))}
        </div>
      </div>

      {!isLoading && namedVersions.length === 0 && !rootDraft && (
        <p className="text-xs text-gray-400 italic">No versions yet. Save the draft as a version to start tracking history.</p>
      )}
    </div>
  )
}
