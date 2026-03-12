import { useMemo, useState } from 'react'
import { Copy, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  useCreateGraphPublicLink,
  useDisableGraphPublicLink,
  useGraphPublicLinks,
  useUpdateGraphPublicLink,
} from '@/api/publicWorkflows'
import MarkdownWysiwygEditor from '@/components/handbook/MarkdownWysiwygEditor'

interface Props {
  workspaceId: string
  graphId: string
  currentVersionId: string | null
  onClose: () => void
}

type Mode = 'create' | 'edit'

export default function PublicLinksModal({ workspaceId, graphId, currentVersionId, onClose }: Props) {
  const { data: links = [], isLoading, error } = useGraphPublicLinks(workspaceId, graphId)
  const createLink = useCreateGraphPublicLink(workspaceId, graphId)
  const updateLink = useUpdateGraphPublicLink(workspaceId, graphId)
  const disableLink = useDisableGraphPublicLink(workspaceId, graphId)

  const [mode, setMode] = useState<Mode>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [pinCurrentVersion, setPinCurrentVersion] = useState(true)
  const [err, setErr] = useState('')
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const modalTitle = mode === 'create' ? 'Create public link' : 'Edit public link'
  const canSave = description.trim().length > 0 && description.trim().length <= 1000
  const publicBase = useMemo(() => window.location.origin, [])

  function beginCreate() {
    setMode('create')
    setEditingId(null)
    setDescription('')
    setPinCurrentVersion(true)
    setErr('')
  }

  function beginEdit(link: { id: string; description_md: string; graph_version_id: string | null }) {
    setMode('edit')
    setEditingId(link.id)
    setDescription(link.description_md)
    setPinCurrentVersion(link.graph_version_id !== null)
    setErr('')
  }

  async function handleSave() {
    setErr('')
    if (!canSave) {
      setErr('Description is required (max 1000 characters).')
      return
    }
    const payload = {
      description_md: description.trim(),
      graph_version_id: pinCurrentVersion ? currentVersionId : null,
    }
    try {
      if (mode === 'create') {
        await createLink.mutateAsync(payload)
        beginCreate()
        return
      }
      if (!editingId) return
      await updateLink.mutateAsync({ linkId: editingId, ...payload })
      beginCreate()
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Failed to save public link'
      setErr(String(msg))
    }
  }

  async function handleDisable(linkId: string) {
    const ok = window.confirm('Disable this public link? Existing token URL will stop working.')
    if (!ok) return
    try {
      await disableLink.mutateAsync(linkId)
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Failed to disable public link'
      window.alert(String(msg))
    }
  }

  async function copyLink(token: string) {
    const url = `${publicBase}/public/workflows/${token}`
    await navigator.clipboard.writeText(url)
    setCopiedToken(token)
    window.setTimeout(() => setCopiedToken(null), 1600)
  }

  const isSaving = createLink.isPending || updateLink.isPending

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <p className="text-base font-semibold text-gray-900">Public Links</p>
            <p className="text-xs text-gray-500 mt-0.5">Owner-only. Share secret URLs for external experts to trigger runs.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 flex-1 min-h-0">
          <div className="border-r border-gray-200 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-800">{modalTitle}</p>
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={beginCreate}
                  className="text-xs border border-gray-300 rounded-md px-2 py-1 text-gray-600 hover:bg-gray-50"
                >
                  Cancel edit
                </button>
              )}
            </div>

            <label className="block text-xs font-medium text-gray-500 mb-2">Description (markdown, max 1000 chars)</label>
            <MarkdownWysiwygEditor value={description} onChange={setDescription} />
            <p className="mt-2 text-[11px] text-gray-500">{description.length}/1000</p>

            <div className="mt-4 rounded-lg border border-gray-200 p-3 bg-gray-50">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={pinCurrentVersion}
                  onChange={(e) => setPinCurrentVersion(e.target.checked)}
                />
                Pin to current workflow version
              </label>
              <p className="text-xs text-gray-500 mt-1">
                {pinCurrentVersion
                  ? 'Stable preview: this link always runs the current saved version at publish time.'
                  : 'Dynamic preview: this link runs the latest saved version at trigger time.'}
              </p>
            </div>

            {err && <p className="mt-3 text-xs text-red-600">{err}</p>}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave || isSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {mode === 'create' ? 'Create link' : 'Save changes'}
              </button>
            </div>
          </div>

          <div className="p-4 overflow-y-auto">
            <p className="text-sm font-semibold text-gray-800 mb-3">Existing links</p>
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading links…</p>
            ) : error ? (
              <p className="text-sm text-red-600">
                {(error as any)?.response?.data?.detail ?? 'Cannot load public links'}
              </p>
            ) : links.length === 0 ? (
              <p className="text-sm text-gray-500">No public links yet.</p>
            ) : (
              <div className="space-y-3">
                {links.map((link) => {
                  const url = `${publicBase}/public/workflows/${link.token}`
                  return (
                    <div key={link.id} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500">Token</p>
                          <p className="font-mono text-xs text-gray-700 truncate">{link.token}</p>
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                          link.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-200 text-gray-600'
                        }`}>
                          {link.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-2 break-all">{url}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {link.graph_version_id ? 'Pinned version' : 'Latest on trigger'} · {new Date(link.created_at).toLocaleString()}
                      </p>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyLink(link.token)}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          <Copy size={12} />
                          {copiedToken === link.token ? 'Copied' : 'Copy URL'}
                        </button>
                        <button
                          type="button"
                          onClick={() => beginEdit(link)}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          <Pencil size={12} />
                          Edit
                        </button>
                        {link.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => void handleDisable(link.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            <Trash2 size={12} />
                            Disable
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
