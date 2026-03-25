import { Copy, Globe } from 'lucide-react'
import Btn from '@/components/shared/Btn'
import PublicLinksModal from '@/components/operator/PublicLinksModal'
import type { GraphVersion } from '@/types'

export interface RenameDialog { version: GraphVersion; value: string }
export interface ForkDialog { versionRowId: string; value: string }

export default function GraphDialogs({
  workspaceId,
  graphId,
  publishDialog,
  onClosePublish,
  onPublishPublic,
  onPublishPrivate,
  publishPending,
  renameDialog,
  onRenameChange,
  onRenameSubmit,
  onRenameClose,
  renamePending,
  forkDialog,
  onForkChange,
  onForkSubmit,
  onForkClose,
  forkPending,
  publicLinksVersionId,
  onClosePublicLinks,
}: {
  workspaceId: string
  graphId: string
  publishDialog: boolean
  onClosePublish: () => void
  onPublishPublic: () => void
  onPublishPrivate: () => void
  publishPending: boolean
  renameDialog: RenameDialog | null
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameClose: () => void
  renamePending: boolean
  forkDialog: ForkDialog | null
  onForkChange: (value: string) => void
  onForkSubmit: () => void
  onForkClose: () => void
  forkPending: boolean
  publicLinksVersionId: string | null
  onClosePublicLinks: () => void
}) {
  return (
    <>
      {publicLinksVersionId && (
        <PublicLinksModal
          workspaceId={workspaceId}
          graphId={graphId}
          currentVersionId={publicLinksVersionId}
          onClose={onClosePublicLinks}
        />
      )}

      {publishDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-sm font-semibold text-gray-900">Publish draft</p>
            <p className="mt-1 text-xs text-gray-500">Choose how to publish this draft as a named version.</p>
            <div className="mt-4 space-y-3">
              <button
                onClick={onPublishPublic}
                disabled={publishPending}
                className="w-full rounded-xl border-2 border-brand-200 bg-brand-50 p-4 text-left hover:border-brand-400 hover:bg-brand-100 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <Globe size={16} className="text-brand-600 flex-shrink-0" />
                  <p className="text-sm font-semibold text-brand-900">Publish publicly</p>
                </div>
                <p className="mt-1 text-xs text-brand-700">Creates a version and a public link that anyone can use to trigger runs.</p>
              </button>
              <button
                onClick={onPublishPrivate}
                disabled={publishPending}
                className="w-full rounded-xl border-2 border-gray-200 bg-white p-4 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <Copy size={16} className="text-gray-500 flex-shrink-0" />
                  <p className="text-sm font-semibold text-gray-900">Save as version</p>
                </div>
                <p className="mt-1 text-xs text-gray-500">Creates a named version, accessible internally only.</p>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <Btn size="sm" variant="ghost" onClick={onClosePublish}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {renameDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-sm font-semibold text-gray-900">
              Rename {renameDialog.version.version_id ? 'version' : 'draft'}
            </p>
            <input
              autoFocus
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              value={renameDialog.value}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameClose() }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Btn size="sm" variant="ghost" onClick={onRenameClose}>Cancel</Btn>
              <Btn size="sm" loading={renamePending} onClick={onRenameSubmit}>Save</Btn>
            </div>
          </div>
        </div>
      )}

      {forkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-sm font-semibold text-gray-900">Copy as new workflow</p>
            <p className="mt-1 text-xs text-gray-500">Choose a name for the new workflow</p>
            <input
              autoFocus
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              value={forkDialog.value}
              onChange={(e) => onForkChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onForkSubmit(); if (e.key === 'Escape') onForkClose() }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Btn size="sm" variant="ghost" onClick={onForkClose}>Cancel</Btn>
              <Btn size="sm" loading={forkPending} onClick={onForkSubmit}>Create</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
