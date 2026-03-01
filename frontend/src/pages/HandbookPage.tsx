import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { useKnowledgeFiles, useCreateKnowledgeFile } from '../api/knowledge'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import HealthDots from '@/components/shared/HealthDots'
import Btn from '@/components/shared/Btn'
import EmptyState from '@/components/shared/EmptyState'
import Spinner from '@/components/shared/Spinner'
import type { KnowledgeFile } from '../api/knowledge'

function TokenBadge({ count }: { count: number }) {
  const warn = count < 300 || count > 6000
  return (
    <span className={`text-xs ${warn ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
      {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count} tok
      {count < 300 && ' ⚠'}
      {count > 6000 && ' ⚠'}
    </span>
  )
}

function NewFileModal({ onClose }: { onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="font-semibold text-gray-900 mb-4">New File</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Path (e.g. legal/guide.md)</label>
            <input
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              required
              placeholder="folder/filename.md"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Title</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Display title"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Btn type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" size="sm" loading={create.isPending}>Create</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

function FileRow({ file }: { file: KnowledgeFile }) {
  const navigate = useNavigate()
  return (
    <tr
      className="hover:bg-gray-50 cursor-pointer border-b last:border-0"
      onClick={() => navigate(`/handbook/file?path=${encodeURIComponent(file.path)}`)}
    >
      <td className="py-3 pr-4 font-mono text-sm text-brand-700">{file.path}</td>
      <td className="py-3 pr-4 text-sm text-gray-700">{file.title}</td>
      <td className="py-3 pr-4"><TokenBadge count={file.raw_token_count} /></td>
      <td className="py-3"><HealthDots score={file.health_score} /></td>
    </tr>
  )
}

export default function HandbookPage() {
  const { data: files = [], isLoading, error } = useKnowledgeFiles()
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')

  const lowHealth = files.filter((f) => (f.health_score ?? 5) < 2.5)
  const filtered = files.filter(
    (f) =>
      f.path.toLowerCase().includes(search.toLowerCase()) ||
      f.title.toLowerCase().includes(search.toLowerCase()),
  )

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) return <div className="p-8 text-red-500">Failed to load Handbook.</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Handbook"
        subtitle="Knowledge files used by agent nodes."
        actions={
          <Btn size="sm" onClick={() => setShowNew(true)}>+ New File</Btn>
        }
      />

      {/* Needs Attention */}
      {lowHealth.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">
            Needs Attention
          </p>
          <div className="space-y-1.5">
            {lowHealth.map((f) => (
              <Link
                key={f.id}
                to={`/handbook/file?path=${encodeURIComponent(f.path)}`}
                className="flex items-center gap-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors"
              >
                <span className="font-mono text-xs text-red-700 flex-1">{f.path}</span>
                <HealthDots score={f.health_score} />
                <span className="text-xs text-red-500">Review →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <input
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 outline-none focus:ring-2 focus:ring-brand-500"
        placeholder="Search files…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={32} />}
          heading="No files yet"
          subtext="Create your first Handbook entry."
          action={{ label: '+ New File', onClick: () => setShowNew(true) }}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-xs text-gray-500 uppercase bg-gray-50">
                <th className="py-2 px-4">Path</th>
                <th className="py-2 px-4">Title</th>
                <th className="py-2 px-4">Tokens</th>
                <th className="py-2 px-4">Health</th>
              </tr>
            </thead>
            <tbody className="px-4">
              {filtered.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50 cursor-pointer border-b last:border-0"
                  onClick={() => window.location.href = `/handbook/file?path=${encodeURIComponent(f.path)}`}>
                  <td className="py-3 px-4 font-mono text-sm text-brand-700">{f.path}</td>
                  <td className="py-3 px-4 text-sm text-gray-700">{f.title}</td>
                  <td className="py-3 px-4"><TokenBadge count={f.raw_token_count} /></td>
                  <td className="py-3 px-4"><HealthDots score={f.health_score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showNew && <NewFileModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
