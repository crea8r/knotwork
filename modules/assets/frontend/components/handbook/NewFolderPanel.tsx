/**
 * NewFolderPanel — inline panel for creating a new folder (mirrors NewFilePanel UX).
 */
import { useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { useCreateFolder } from "@modules/assets/frontend/api/folders"
import Btn from '@ui/components/Btn'

interface Props {
  parentPath: string
  onCreate: (path: string) => void
  onCancel: () => void
}

export default function NewFolderPanel({ parentPath, onCreate, onCancel }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const createFolder = useCreateFolder()
  const trimmed = name.trim().replace(/\//g, '-')
  const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed

  async function handleCreate() {
    if (!trimmed) return
    setError(null)
    try {
      await createFolder.mutateAsync(fullPath)
      onCreate(fullPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder.')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
        <FolderPlus size={18} className="text-amber-500 flex-shrink-0" />
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">New Folder</h2>
          {parentPath && <p className="text-xs text-gray-400 mt-0.5">in {parentPath}</p>}
        </div>
      </div>

      <div className="flex-1 p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Folder name</label>
          <input
            ref={inputRef}
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') onCancel() }}
            placeholder="e.g. legal, marketing/campaigns"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {trimmed && (
          <p className="text-xs text-gray-400">
            Will create: <span className="font-mono text-gray-600">{fullPath}</span>
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center gap-2 pt-2">
          <Btn
            onClick={() => { void handleCreate() }}
            loading={createFolder.isPending}
            disabled={!trimmed}
          >
            Create Folder
          </Btn>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  )
}
