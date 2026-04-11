/**
 * NewFilePanel — create a new Markdown file in the current folder.
 * File is always created inside the folder the user is currently in.
 * No free-form path editing.
 */
import { useState } from 'react'
import { useCreateKnowledgeFile } from "@modules/assets/frontend/api/knowledge"
import Btn from '@ui/components/Btn'

interface Props {
  folder: string        // current folder path e.g. "legal" or "" for root
  onCreate: (path: string) => void
  onCancel: () => void
}

export default function NewFilePanel({ folder, onCreate, onCancel }: Props) {
  const [filename, setFilename] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateKnowledgeFile()

  const fullPath = folder
    ? `${folder}/${filename.endsWith('.md') ? filename : filename + '.md'}`
    : (filename.endsWith('.md') ? filename : filename + '.md')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!filename.trim()) return
    setError(null)
    try {
      const created = await create.mutateAsync({ path: fullPath, content: '' })
      onCreate(created.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create file.')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">New Text File</h2>
          {folder && (
            <p className="text-xs text-gray-400 mt-0.5">
              in <span className="font-mono">{folder}/</span>
            </p>
          )}
        </div>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>
      <form onSubmit={submit} className="flex-1 p-5 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Filename</label>
          <input
            autoFocus
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={filename}
            onChange={e => setFilename(e.target.value)}
            required
            placeholder="guide.md"
          />
          {filename && (
            <p className="text-xs text-gray-400 mt-1">
              Path: <span className="font-mono">{fullPath}</span>
            </p>
          )}
        </div>
        <p className="text-xs text-gray-400">Creates a Markdown handbook document.</p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Btn type="submit" size="sm" loading={create.isPending}>Create</Btn>
          <Btn type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </form>
    </div>
  )
}
