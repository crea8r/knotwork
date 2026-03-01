import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  useKnowledgeFile,
  useKnowledgeHistory,
  useKnowledgeHealth,
  useKnowledgeSuggestions,
  useUpdateKnowledgeFile,
  useRestoreKnowledgeFile,
} from '../api/knowledge'
import Card from '@/components/shared/Card'
import HealthDots from '@/components/shared/HealthDots'
import Btn from '@/components/shared/Btn'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'

type Tab = 'editor' | 'history' | 'health'

function HealthPanel({ path }: { path: string }) {
  const { data: health, isLoading: hLoading } = useKnowledgeHealth(path)
  const { data: sugg, isLoading: sLoading } = useKnowledgeSuggestions(path)
  const score = health?.health_score ?? null

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Health score</p>
        {hLoading ? <Spinner /> : (
          <div className="flex items-center gap-3">
            <HealthDots score={score} />
            <span className="text-2xl font-bold text-gray-800">
              {score !== null ? `${score.toFixed(1)}/5` : 'No data'}
            </span>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          token 20% · confidence 30% · escalation 25% · rating 25%
        </p>
      </Card>

      <Card className="p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Mode B Suggestions
        </p>
        {sLoading ? <Spinner /> : !sugg?.suggestions.length ? (
          <p className="text-sm text-gray-400">No suggestions yet — run this file through an agent first.</p>
        ) : (
          <ul className="space-y-2">
            {sugg.suggestions.map((s, i) => (
              <li key={i} className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                💡 {s}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function HistoryPanel({ path }: { path: string }) {
  const { data: versions = [], isLoading } = useKnowledgeHistory(path)
  const restore = useRestoreKnowledgeFile(path)

  if (isLoading) return <Spinner />
  if (!versions.length) return <p className="text-sm text-gray-400">No versions yet.</p>

  return (
    <Card className="divide-y">
      {versions.map((v, i) => (
        <div key={v.version_id} className="flex items-start gap-4 p-4">
          <div className="flex-1">
            <p className="font-mono text-xs text-gray-500">{v.version_id.slice(0, 8)}…</p>
            <p className="text-sm text-gray-700">{v.change_summary ?? '(no summary)'}</p>
            <p className="text-xs text-gray-400">{new Date(v.saved_at).toLocaleString()}</p>
          </div>
          {i === 0
            ? <Badge variant="green">Current</Badge>
            : <Btn variant="ghost" size="sm" loading={restore.isPending} onClick={() => restore.mutate(v.version_id)}>Restore</Btn>
          }
        </div>
      ))}
    </Card>
  )
}

export default function KnowledgeFilePage() {
  const [params] = useSearchParams()
  const path = params.get('path') ?? ''

  const { data: file, isLoading, error } = useKnowledgeFile(path || null)
  const update = useUpdateKnowledgeFile(path)

  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('editor')

  useEffect(() => {
    if (file) { setContent(file.content); setDirty(false) }
  }, [file?.version_id])

  async function save() {
    await update.mutateAsync({ content, change_summary: summary || undefined })
    setSummary('')
    setDirty(false)
  }

  if (!path) return <div className="p-8 text-red-500">No file path specified.</div>
  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) return <div className="p-8 text-red-500">File not found.</div>
  if (!file) return null

  const tokenCount = file.raw_token_count
  const tokenWarn = tokenCount < 300 || tokenCount > 6000

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link to="/handbook" className="hover:text-gray-600">Handbook</Link>
        <span>›</span>
        <span className="text-gray-600 font-mono">{path}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{file.title}</h1>
          <p className="text-xs font-mono text-gray-500 mt-0.5">{file.path}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${tokenWarn ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
            {tokenCount} tokens{tokenCount < 300 ? ' ⚠ sparse' : tokenCount > 6000 ? ' ⚠ large' : ''}
          </span>
          <HealthDots score={file.health_score} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b mb-6 text-sm">
        {(['editor', 'history', 'health'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 capitalize ${
              tab === t
                ? 'border-b-2 border-brand-500 text-brand-600 font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'health' ? 'Health & Suggestions' : t}
          </button>
        ))}
      </div>

      {tab === 'editor' && (
        <div className="space-y-3">
          <textarea
            className="w-full border border-gray-200 rounded-xl p-4 font-mono text-sm h-96 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={content}
            onChange={(e) => { setContent(e.target.value); setDirty(true) }}
          />
          {dirty && (
            <div className="flex items-center gap-3">
              <input
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1"
                placeholder="Change summary (optional)"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
              <Btn size="sm" loading={update.isPending} onClick={save}>Save</Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => { setContent(file.content); setDirty(false) }}
              >
                Discard
              </Btn>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && <HistoryPanel path={path} />}
      {tab === 'health' && <HealthPanel path={path} />}
    </div>
  )
}
