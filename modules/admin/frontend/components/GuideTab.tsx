/**
 * GuideTab — Settings → Guide
 * Owners edit the workspace guide (company rulebook for all participants).
 * Agents fetch this via GET /workspaces/{id}/guide at startup.
 */
import { useEffect, useState } from 'react'
import { useAuthStore } from '@auth'
import { useWorkspaceGuide, useUpdateWorkspaceGuide } from "@modules/admin/frontend/api/auth"
import Card from '@ui/components/Card'
import Spinner from '@ui/components/Spinner'
import MarkdownWysiwygEditor from '@modules/assets/frontend/components/handbook/MarkdownWysiwygEditor'
import MarkdownViewer from '@ui/components/MarkdownViewer'

export default function GuideTab() {
  const workspaceId = useAuthStore((s) => s.workspaceId)
  const role = useAuthStore((s) => s.role)
  const isOwner = role === 'owner'

  const { data: guide, isLoading } = useWorkspaceGuide(workspaceId)
  const update = useUpdateWorkspaceGuide(workspaceId)

  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (guide !== undefined) {
      setDraft(guide.guide_md ?? '')
    }
  }, [guide])

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    update.mutate(draft, {
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      },
    })
  }

  const isDirty = guide !== undefined && draft !== (guide.guide_md ?? '')

  return (
    <div data-ui="admin.guide.tab" className="space-y-4">
      <Card data-ui="admin.guide.card" className="p-4">
        <div className="mb-3">
          <p className="text-sm font-medium text-gray-700">Workspace guide</p>
          <p className="mt-1 text-xs text-gray-400">
            The rulebook for everyone in this workspace — human and agent alike. Agents load
            this on startup and reload it whenever the version changes.
          </p>
        </div>

        {isLoading ? (
          <div data-ui="admin.guide.loading" className="flex justify-center py-8"><Spinner /></div>
        ) : isOwner ? (
          <form data-ui="admin.guide.form" onSubmit={handleSave}>
            <div data-ui="admin.guide.editor">
              <MarkdownWysiwygEditor value={draft} onChange={(md) => { setDraft(md); setSaved(false) }} />
            </div>

            <div data-ui="admin.guide.actions" className="mt-3 flex items-center justify-between">
              <div className="text-xs text-gray-400">
                {guide && <span>Version {guide.guide_version}</span>}
              </div>
              <div className="flex items-center gap-3">
                {saved && <span className="text-xs text-green-600">✓ Saved</span>}
                <button
                  type="submit"
                  disabled={update.isPending || !isDirty}
                  data-ui="admin.guide.save"
                  className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {update.isPending ? 'Saving…' : 'Save guide'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div data-ui="admin.guide.viewer" className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <MarkdownViewer content={draft} />
            </div>
            {guide && (
              <p className="text-xs text-gray-400">Version {guide.guide_version} · read-only</p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
