import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, X } from 'lucide-react'
import { useSearchKnowledgeFiles } from '@/api/knowledge'
import { useGraphs } from '@/api/graphs'
import { useAuthStore } from '@/store/auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

export default function LibrarySearch() {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const [query, setQuery] = useState('')
  const { data: allGraphs = [] } = useGraphs(workspaceId)
  const { data: knowledgeResults = [], isFetching: searching } = useSearchKnowledgeFiles(query)

  const results = query.trim()
    ? [
        ...knowledgeResults.map((item) => ({
          id: item.path, kind: 'file' as const,
          title: item.title || item.path.split('/').pop() || item.path,
          subtitle: item.path,
        })),
        ...allGraphs
          .filter((item) =>
            [item.name, item.description, item.path].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()),
          )
          .map((item) => ({
            id: item.id, kind: 'workflow' as const,
            title: item.name,
            subtitle: item.description ?? item.path ?? 'Workflow',
          })),
      ]
    : []

  return (
    <div className="hidden md:flex border-b border-gray-200 bg-white px-3 py-1.5">
      <div className="relative max-w-xs">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search handbook…"
          className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={13} />
          </button>
        )}
        {searching && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
        {query && (
          <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">No matches for "{query}"</p>
            ) : (
              results.map((result) => (
                <button
                  key={`${result.kind}-${result.id}`}
                  onClick={() => {
                    setQuery('')
                    if (result.kind === 'workflow') navigate(`/graphs/${result.id}`)
                    else navigate(`/handbook?path=${encodeURIComponent(result.id)}`)
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50"
                >
                  <p className="text-sm font-medium text-gray-900">{result.title}</p>
                  <p className="truncate text-xs text-gray-500">{result.subtitle}</p>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
