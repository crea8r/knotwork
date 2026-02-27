/**
 * HandbookPage — Handbook file tree with health badges and folder grouping.
 * Route: /handbook
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useKnowledgeFiles,
  useCreateKnowledgeFile,
  useDeleteKnowledgeFile,
  type KnowledgeFile,
} from '../api/knowledge'

// ── HealthBadge ──────────────────────────────────────────────────────────────

function HealthBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-gray-400">—</span>
  const color =
    score >= 4 ? 'bg-green-100 text-green-800' :
    score >= 2.5 ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-800'
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
      {score.toFixed(1)}/5
    </span>
  )
}

// ── TokenBadge ───────────────────────────────────────────────────────────────

function TokenBadge({ count }: { count: number }) {
  const warn = count < 300 || count > 6000
  return (
    <span className={`text-xs ${warn ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
      {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count} tok
      {count < 300 && ' ⚠ sparse'}
      {count > 6000 && ' ⚠ large'}
    </span>
  )
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({
  file,
  onDelete,
}: {
  file: KnowledgeFile
  onDelete: (path: string) => void
}) {
  const navigate = useNavigate()
  return (
    <tr
      className="hover:bg-gray-50 cursor-pointer"
      onClick={() => navigate(`/handbook/file?path=${encodeURIComponent(file.path)}`)}
    >
      <td className="py-2 pr-4 font-mono text-sm text-blue-700">{file.path}</td>
      <td className="py-2 pr-4 text-sm text-gray-700">{file.title}</td>
      <td className="py-2 pr-4"><TokenBadge count={file.raw_token_count} /></td>
      <td className="py-2 pr-4"><HealthBadge score={file.health_score} /></td>
      <td className="py-2 text-right">
        <button
          className="text-xs text-red-500 hover:text-red-700"
          onClick={e => { e.stopPropagation(); onDelete(file.path) }}
        >
          Delete
        </button>
      </td>
    </tr>
  )
}

// ── NewFileForm ───────────────────────────────────────────────────────────────

function NewFileForm({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState('')
  const [title, setTitle] = useState('')
  const create = useCreateKnowledgeFile()
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const file = await create.mutateAsync({ path, title, content: '' })
    onClose()
    navigate(`/handbook/file?path=${encodeURIComponent(file.path)}`)
  }

  return (
    <form onSubmit={submit} className="bg-gray-50 border rounded p-4 mb-4 flex gap-3 items-end">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Path (e.g. legal/guide.md)</label>
        <input
          className="border rounded px-2 py-1 text-sm font-mono w-56"
          value={path} onChange={e => setPath(e.target.value)}
          required placeholder="folder/filename.md"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Title</label>
        <input
          className="border rounded px-2 py-1 text-sm w-40"
          value={title} onChange={e => setTitle(e.target.value)}
          required placeholder="Display title"
        />
      </div>
      <button
        type="submit" disabled={create.isPending}
        className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {create.isPending ? 'Creating…' : 'Create'}
      </button>
      <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
        Cancel
      </button>
    </form>
  )
}

// ── HandbookPage ─────────────────────────────────────────────────────────────

export default function HandbookPage() {
  const { data: files = [], isLoading, error } = useKnowledgeFiles()
  const deleteFile = useDeleteKnowledgeFile()
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = files.filter(
    f => f.path.toLowerCase().includes(search.toLowerCase()) ||
         f.title.toLowerCase().includes(search.toLowerCase())
  )

  function handleDelete(path: string) {
    if (confirm(`Delete ${path}?`)) deleteFile.mutate(path)
  }

  if (isLoading) return <div className="p-8 text-gray-400">Loading Handbook…</div>
  if (error) return <div className="p-8 text-red-500">Failed to load Handbook.</div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Handbook</h1>
        <button
          onClick={() => setShowNew(true)}
          className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded hover:bg-blue-700"
        >
          + New file
        </button>
      </div>

      {showNew && <NewFileForm onClose={() => setShowNew(false)} />}

      <input
        className="border rounded px-3 py-1.5 text-sm w-full mb-4"
        placeholder="Search files…"
        value={search} onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="text-gray-400 text-sm">No files yet. Create your first Handbook entry.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b text-xs text-gray-500 uppercase">
              <th className="pb-2 pr-4">Path</th>
              <th className="pb-2 pr-4">Title</th>
              <th className="pb-2 pr-4">Tokens</th>
              <th className="pb-2 pr-4">Health</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(f => (
              <FileRow key={f.id} file={f} onDelete={handleDelete} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
