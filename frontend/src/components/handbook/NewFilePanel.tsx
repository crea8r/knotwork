/**
 * NewFilePanel — inline form to create a new Handbook file.
 */
import { useState } from 'react'
import { useCreateKnowledgeFile } from '@/api/knowledge'
import Btn from '@/components/shared/Btn'

interface Props {
  initialFolder: string
  onCreate: (path: string) => void
  onCancel: () => void
}

export default function NewFilePanel({ initialFolder, onCreate, onCancel }: Props) {
  const [path, setPath] = useState(initialFolder ? `${initialFolder}/` : '')
  const [title, setTitle] = useState('')
  const create = useCreateKnowledgeFile()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await create.mutateAsync({ path, title, content: '' })
    onCreate(path)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">New File</h2>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>
      <form onSubmit={submit} className="flex-1 p-5 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Path (e.g. legal/guide.md)</label>
          <input
            autoFocus
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={path}
            onChange={e => setPath(e.target.value)}
            required
            placeholder="folder/filename.md"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Title</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            placeholder="Display title"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <Btn type="submit" size="sm" loading={create.isPending}>Create</Btn>
          <Btn type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn>
        </div>
      </form>
    </div>
  )
}
