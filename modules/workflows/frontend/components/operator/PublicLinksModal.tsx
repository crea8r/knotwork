import { useEffect, useState } from 'react'
import { Copy, Globe, Loader2, Trash2, X } from 'lucide-react'
import { usePublishVersion, useUnpublishVersion } from "@modules/workflows/frontend/api/publicWorkflows"
import MarkdownWysiwygEditor from '@modules/assets/frontend/components/handbook/MarkdownWysiwygEditor'
import type { Graph, GraphVersion } from '@data-models'

interface Props {
  workspaceId: string
  graphId: string
  graph: Graph
  version: GraphVersion
  onClose: () => void
}

export default function PublicLinksModal({ workspaceId, graphId, graph, version, onClose }: Props) {
  const publish = usePublishVersion(workspaceId, graphId)
  const unpublish = useUnpublishVersion(workspaceId, graphId)

  const isPublished = !!version.version_slug
  const publicUrl = (graph.slug && version.version_slug)
    ? `${window.location.origin}/public/workflows/${graph.slug}/${version.version_slug}`
    : null

  const [description, setDescription] = useState(version.public_description_md ?? '')
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { setDescription(version.public_description_md ?? '') }, [version.id])

  const isSaving = publish.isPending || unpublish.isPending
  const canSave = description.trim().length > 0 && description.trim().length <= 1000

  function copyLink() {
    if (!publicUrl) return
    void navigator.clipboard.writeText(publicUrl)
    setCopied(true); setTimeout(() => setCopied(false), 1600)
  }

  async function handlePublish() {
    setErr('')
    if (!canSave) { setErr('Description is required (max 1000 characters).'); return }
    try {
      await publish.mutateAsync({ versionId: version.id, description_md: description.trim() })
      setDone(true)
      setTimeout(onClose, 1200)
    } catch (e: any) {
      setErr(String(e?.response?.data?.detail ?? 'Failed to publish'))
    }
  }

  async function handleUnpublish() {
    if (!window.confirm('Remove public link? The URL will stop working.')) return
    try {
      await unpublish.mutateAsync(version.id)
      onClose()
    } catch (e: any) {
      window.alert(String(e?.response?.data?.detail ?? 'Failed to unpublish'))
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-lg max-h-[92vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <p className="text-base font-semibold text-gray-900">Public link</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Share a URL for external visitors to trigger runs on this version.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4 flex-1">
          {publicUrl && (
            <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2.5">
              <Globe size={13} className="flex-shrink-0 text-purple-500" />
              <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs font-mono text-purple-700 hover:underline">
                {publicUrl}
              </a>
              <button onClick={copyLink} className="flex-shrink-0 text-xs text-purple-600 hover:text-purple-800">
                {copied ? 'Copied' : <Copy size={12} />}
              </button>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Public description
              <span className="ml-1 font-normal text-gray-400">(shown to visitors, markdown)</span>
            </label>
            <MarkdownWysiwygEditor value={description} onChange={setDescription} />
            <p className="mt-1 text-[11px] text-gray-400">{description.length}/1000</p>
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}
          {done && <p className="text-xs text-green-600 font-medium">✓ Published! Closing…</p>}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => void handlePublish()}
              disabled={isSaving || done}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-brand-700">
              {isSaving && publish.isPending && <Loader2 size={14} className="animate-spin" />}
              {isPublished ? 'Update' : 'Make public'}
            </button>
            {isPublished && (
              <button type="button" onClick={() => void handleUnpublish()}
                disabled={unpublish.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
