/**
 * KnowledgeFilePage — Markdown editor for a single Handbook file.
 * Route: /handbook/file?path=<path>
 *
 * Panels: editor | history | health + suggestions
 */
import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  useKnowledgeFile,
  useKnowledgeHistory,
  useKnowledgeHealth,
  useKnowledgeSuggestions,
  useUpdateKnowledgeFile,
  useRestoreKnowledgeFile,
} from '../api/knowledge'

type Tab = 'editor' | 'history' | 'health'

// ── HealthPanel ───────────────────────────────────────────────────────────────

function HealthPanel({ path }: { path: string }) {
  const { data: health, isLoading: hLoading } = useKnowledgeHealth(path)
  const { data: sugg, isLoading: sLoading } = useKnowledgeSuggestions(path)

  const score = health?.health_score ?? null
  const color =
    score === null ? 'text-gray-400' :
    score >= 4 ? 'text-green-600' :
    score >= 2.5 ? 'text-yellow-600' : 'text-red-600'

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-gray-500 uppercase mb-1">Health score</p>
        {hLoading ? (
          <p className="text-sm text-gray-400">Computing…</p>
        ) : (
          <p className={`text-3xl font-bold ${color}`}>
            {score !== null ? `${score.toFixed(1)}/5.0` : 'No data yet'}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          token 20% · confidence 30% · escalation 25% · rating 25%
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-500 uppercase mb-2">Mode B suggestions</p>
        {sLoading ? (
          <p className="text-sm text-gray-400">Generating…</p>
        ) : !sugg?.suggestions.length ? (
          <p className="text-sm text-gray-400">No suggestions yet — run this file through an agent first.</p>
        ) : (
          <ul className="space-y-2">
            {sugg.suggestions.map((s, i) => (
              <li key={i} className="text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
                💡 {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── HistoryPanel ──────────────────────────────────────────────────────────────

function HistoryPanel({ path }: { path: string }) {
  const { data: versions = [], isLoading } = useKnowledgeHistory(path)
  const restore = useRestoreKnowledgeFile(path)

  if (isLoading) return <p className="text-sm text-gray-400">Loading history…</p>
  if (!versions.length) return <p className="text-sm text-gray-400">No versions yet.</p>

  return (
    <ul className="space-y-2">
      {versions.map((v, i) => (
        <li key={v.version_id} className="flex items-start gap-3 text-sm border-b pb-2">
          <div className="flex-1">
            <p className="font-mono text-xs text-gray-500">{v.version_id.slice(0, 8)}…</p>
            <p className="text-gray-700">{v.change_summary ?? '(no summary)'}</p>
            <p className="text-xs text-gray-400">{new Date(v.saved_at).toLocaleString()}</p>
          </div>
          {i > 0 && (
            <button
              onClick={() => restore.mutate(v.version_id)}
              disabled={restore.isPending}
              className="text-xs text-blue-600 hover:underline shrink-0"
            >
              Restore
            </button>
          )}
          {i === 0 && <span className="text-xs text-green-600 shrink-0">Current</span>}
        </li>
      ))}
    </ul>
  )
}

// ── KnowledgeFilePage ─────────────────────────────────────────────────────────

export default function KnowledgeFilePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
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
  if (isLoading) return <div className="p-8 text-gray-400">Loading…</div>
  if (error) return <div className="p-8 text-red-500">File not found.</div>
  if (!file) return null

  const tokenCount = file.raw_token_count
  const tokenWarn = tokenCount < 300 || tokenCount > 6000

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <button onClick={() => navigate('/handbook')} className="text-sm text-blue-600 hover:underline mb-1">
            ← Handbook
          </button>
          <h1 className="text-xl font-semibold">{file.title}</h1>
          <p className="text-xs font-mono text-gray-500">{file.path}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${tokenWarn ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
            {tokenCount} tokens{tokenCount < 300 ? ' ⚠ sparse' : tokenCount > 6000 ? ' ⚠ large' : ''}
          </span>
          {file.health_score !== null && (
            <span className={`text-xs font-medium ${
              file.health_score >= 4 ? 'text-green-600' :
              file.health_score >= 2.5 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              ♥ {file.health_score.toFixed(1)}/5
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b mb-4 text-sm">
        {(['editor', 'history', 'health'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 capitalize ${tab === t ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            {t === 'health' ? 'Health & Suggestions' : t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'editor' && (
        <div className="space-y-3">
          <textarea
            className="w-full border rounded p-3 font-mono text-sm h-96 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={content}
            onChange={e => { setContent(e.target.value); setDirty(true) }}
          />
          {dirty && (
            <div className="flex items-center gap-3">
              <input
                className="border rounded px-2 py-1 text-sm flex-1"
                placeholder="Change summary (optional)"
                value={summary} onChange={e => setSummary(e.target.value)}
              />
              <button
                onClick={save}
                disabled={update.isPending}
                className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setContent(file.content); setDirty(false) }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && <HistoryPanel path={path} />}
      {tab === 'health' && <HealthPanel path={path} />}
    </div>
  )
}
