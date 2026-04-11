import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Badge from '@ui/components/Badge'
import type { GraphVersion, Run } from '@data-models'
import { isDraftRun } from '@data-models'
import { compareRunsDesc, formatRunVersionLabel, formatVersionName, getRunSearchText } from './graphVersionUtils'

export default function UsagePanel({
  graphId,
  runs,
  namedVersions,
}: {
  graphId: string
  runs: Run[]
  namedVersions: GraphVersion[]
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [versionFilter, setVersionFilter] = useState('all')

  const graphRuns = useMemo(() => runs.filter((r) => r.graph_id === graphId).sort(compareRunsDesc), [graphId, runs])
  const versionNameById = useMemo(() => new Map(namedVersions.map((v) => [v.id, formatVersionName(v)])), [namedVersions])
  const versionOptions = useMemo(() => [
    { value: 'all', label: 'All versions' }, { value: 'draft', label: 'Draft' },
    ...namedVersions.map((v) => ({ value: v.id, label: `${formatVersionName(v)} (${v.version_id})` })),
  ], [namedVersions])
  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return graphRuns.filter((run) => {
      if (needle && !getRunSearchText(run).includes(needle)) return false
      if (versionFilter === 'all') return true
      if (versionFilter === 'draft') return isDraftRun(run) || run.graph_version_id === null
      return run.graph_version_id === versionFilter || run.draft_parent_version_id === versionFilter
    })
  }, [graphRuns, query, versionFilter])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search run detail…"
            className="min-w-[220px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            value={versionFilter}
            onChange={(e) => setVersionFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          >
            {versionOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {filteredRuns.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No runs match the current filters.</p>
        ) : (
          <div className="space-y-3">
            {filteredRuns.map((run) => (
              <button key={run.id} onClick={() => navigate(`/runs/${run.id}`)} className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-50">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-gray-900">{run.name?.trim() || `Run ${run.id.slice(0, 8)}`}</p>
                      <Badge variant={run.status === 'completed' ? 'green' : run.status === 'failed' ? 'orange' : 'blue'}>{run.status}</Badge>
                      <Badge variant="gray">{formatRunVersionLabel(run, versionNameById)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{new Date(run.created_at).toLocaleString()}</p>
                    {(run.output_summary || run.error) && (
                      <p className="mt-2 line-clamp-2 text-sm text-gray-600">{run.error ?? run.output_summary}</p>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">{run.total_tokens ? `${run.total_tokens} tok` : 'No token data'}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
