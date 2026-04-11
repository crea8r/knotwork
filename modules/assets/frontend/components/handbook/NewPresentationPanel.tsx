import { useState } from 'react'
import Btn from '@ui/components/Btn'
import { useCreateKnowledgeFile } from '@modules/assets/frontend/api/knowledge'
import {
  createDefaultPresentationDocument,
  presentationDocumentToString,
  slugToTitle,
} from './presentationDocument'

interface Props {
  folder: string
  onCreate: (path: string) => void
  onCancel: () => void
}

export default function NewPresentationPanel({ folder, onCreate, onCancel }: Props) {
  const [filename, setFilename] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateKnowledgeFile()

  const resolvedName = filename.endsWith('.pptx') ? filename : `${filename}.pptx`
  const fullPath = folder ? `${folder}/${resolvedName}` : resolvedName
  const title = slugToTitle(resolvedName)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!filename.trim()) return
    setError(null)
    try {
      const created = await create.mutateAsync({
        path: fullPath,
        title,
        content: presentationDocumentToString(createDefaultPresentationDocument(title)),
        file_type: 'presentation',
      })
      onCreate(created.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create presentation.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-5 pt-5 pb-3">
        <div>
          <h2 className="font-semibold text-gray-900">New Presentation</h2>
          {folder && <p className="mt-0.5 text-xs text-gray-400">in <span className="font-mono">{folder}/</span></p>}
        </div>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      <form onSubmit={submit} className="flex-1 space-y-4 p-5">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Filename</label>
          <input
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            required
            placeholder="quarterly-review.pptx"
          />
          {filename && (
            <p className="mt-1 text-xs text-gray-400">
              Path: <span className="font-mono">{fullPath}</span>
            </p>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-800">Editable slide deck</p>
          <p className="mt-1 text-xs text-gray-500">
            Creates a presentation asset you can edit visually in Assets and export as `.pptx`.
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-2">
          <Btn type="submit" size="sm" loading={create.isPending}>Create</Btn>
          <Btn type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </form>
    </div>
  )
}
