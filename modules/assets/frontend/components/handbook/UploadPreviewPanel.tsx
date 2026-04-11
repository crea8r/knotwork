/**
 * UploadPreviewPanel — shown after dropping a file onto the handbook tree.
 * Lets the user review the converted Markdown, edit path/title, then save.
 */
import { useState } from 'react'
import type { UploadPreview } from "@modules/assets/frontend/api/knowledge"
import Btn from '@ui/components/Btn'

interface Props {
  preview: UploadPreview
  onSaved: (path: string) => void
  onCancel: () => void
  onSave?: (payload: { path: string; title: string; content: string; file_type?: string }) => Promise<void>
  isSaving?: boolean
  saveLabel?: string
}

export default function UploadPreviewPanel({
  preview,
  onSaved,
  onCancel,
  onSave,
  isSaving = false,
  saveLabel = 'Save to Handbook',
}: Props) {
  const [path, setPath] = useState(preview.suggested_path)
  const [title, setTitle] = useState(preview.suggested_title)
  const [content, setContent] = useState(preview.converted_content)

  async function save() {
    if (!onSave) return
    await onSave({ path, title, content, file_type: preview.asset_type ?? 'md' })
    onSaved(path)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-3 border-b">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Upload Preview</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Converted from <span className="font-mono">{preview.original_filename}</span>
              {' '}({preview.format})
            </p>
          </div>
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">
            Cancel
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Path</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder="folder/filename.md"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Title</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
        </div>

        {preview.asset_type === 'presentation' ? (
          <div className="space-y-2">
            <label className="block text-xs text-gray-500">Presentation summary</label>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <pre className="whitespace-pre-wrap text-sm text-gray-700">{preview.summary ?? 'Slides imported successfully.'}</pre>
            </div>
            <p className="text-xs text-gray-400">
              The imported deck will open in the presentation editor after save.
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Content preview (edit if needed)</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 font-mono text-sm h-72 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
          <Btn size="sm" loading={isSaving} onClick={save} disabled={!path || !title || !onSave}>
            {saveLabel}
          </Btn>
        </div>
      </div>
    </div>
  )
}
