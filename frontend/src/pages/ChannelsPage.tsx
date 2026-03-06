import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, ChevronDown, ChevronRight, Hash, GitBranch, Plus, PlayCircle, Search, X } from 'lucide-react'
import { useChannels } from '@/api/channels'
import { useCreateGraph, useGraphs } from '@/api/graphs'
import { useRuns } from '@/api/runs'
import { useAuthStore } from '@/store/auth'
import RunTriggerModal from '@/components/operator/RunTriggerModal'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import { validateGraph } from '@/utils/validateGraph'
import type { GraphDefinition } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const PAGE_SIZE = 10

type CreateMode = 'menu' | 'workflow' | 'run' | 'chat'

type PagerProps = {
  page: number
  setPage: (n: number) => void
  total: number
}

function Pager({ page, setPage, total }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (total <= PAGE_SIZE) return null
  return (
    <div className="flex items-center justify-end gap-2 mt-2">
      <button
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 disabled:opacity-40"
      >
        Prev
      </button>
      <span className="text-xs text-gray-500">Page {page} / {totalPages}</span>
      <button
        onClick={() => setPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}

function runLabel(r: { name: string | null; id: string }) {
  if (r.name && r.name.trim()) return r.name.trim()
  return `Run ${r.id.slice(0, 8)}`
}

function paginate<T>(items: T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE
  return items.slice(start, start + PAGE_SIZE)
}

export default function ChannelsPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const navigate = useNavigate()

  const { data: channels = [], isLoading: channelsLoading } = useChannels(workspaceId)
  const { data: runs = [], isLoading: runsLoading } = useRuns(workspaceId)
  const { data: graphs = [] } = useGraphs(workspaceId)

  const createGraph = useCreateGraph(workspaceId)

  const [showCreate, setShowCreate] = useState(false)
  const [mode, setMode] = useState<CreateMode>('menu')
  const [search, setSearch] = useState('')

  const [workflowName, setWorkflowName] = useState('')
  const [selectedGraphId, setSelectedGraphId] = useState('')
  const [runTrigger, setRunTrigger] = useState<{ graphId: string; definition: GraphDefinition } | null>(null)

  const [freeChatPage, setFreeChatPage] = useState(1)
  const [runPage, setRunPage] = useState(1)
  const [workflowPage, setWorkflowPage] = useState(1)
  const [handbookPage, setHandbookPage] = useState(1)
  const [freeChatOpen, setFreeChatOpen] = useState(true)
  const [runsOpen, setRunsOpen] = useState(true)
  const [workflowsOpen, setWorkflowsOpen] = useState(true)
  const [handbookOpen, setHandbookOpen] = useState(true)

  useEffect(() => {
    setFreeChatPage(1)
    setRunPage(1)
    setWorkflowPage(1)
    setHandbookPage(1)
  }, [search])

  const runnableGraphs = useMemo(
    () =>
      graphs.filter((g) => {
        if (g.status === 'archived') return false
        const def = g.latest_version?.definition
        if (!def) return false
        return validateGraph(def).length === 0
      }),
    [graphs],
  )

  const q = search.trim().toLowerCase()

  const freeChats = useMemo(() => {
    const normals = channels.filter((c) => c.channel_type === 'normal')
    const filtered = q ? normals.filter((c) => c.name.toLowerCase().includes(q)) : normals
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [channels, q])

  const workflowChannels = useMemo(() => {
    const workflows = channels.filter((c) => c.channel_type === 'workflow')
    const filtered = q ? workflows.filter((c) => c.name.toLowerCase().includes(q)) : workflows
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [channels, q])

  const handbookChannels = useMemo(() => {
    const handbook = channels.filter((c) => c.channel_type === 'handbook')
    const filtered = q ? handbook.filter((c) => c.name.toLowerCase().includes(q)) : handbook
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [channels, q])

  const runItems = useMemo(() => {
    const filtered = q
      ? runs.filter((r) => runLabel(r).toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
      : runs
    const sorted = [...filtered]
    sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return sorted
  }, [runs, q])

  const isLoading = channelsLoading || runsLoading

  async function handleCreateWorkflow(e: React.FormEvent) {
    e.preventDefault()
    const name = workflowName.trim()
    if (!name) return
    const g = await createGraph.mutateAsync({ name })
    setShowCreate(false)
    setMode('menu')
    setWorkflowName('')
    navigate(`/graphs/${g.id}?chat=1`)
  }

  function handleCreateRun(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedGraphId) return
    const graph = runnableGraphs.find((g) => g.id === selectedGraphId)
    const def = graph?.latest_version?.definition
    if (!graph || !def) return
    setShowCreate(false)
    setMode('menu')
    setRunTrigger({ graphId: graph.id, definition: def })
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Channels</h1>
          <p className="text-sm text-gray-500 mt-1">Free chat, handbook, runs, and workflows in one place.</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setMode('menu') }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm"
        >
          <Plus size={14} /> Create
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search channels and runs..."
          className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : freeChats.length === 0 && workflowChannels.length === 0 && handbookChannels.length === 0 && runItems.length === 0 ? (
        <EmptyState heading="No items found" subtext="Try a different search or create new items." />
      ) : (
        <>
          <section>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setFreeChatOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {freeChatOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Free chat
              </button>
              <p className="text-xs text-gray-400">{freeChats.length}</p>
            </div>
            {freeChatOpen && (
              <>
                <div className="space-y-2">
                  {paginate(freeChats, freeChatPage).map((ch) => (
                    <Link
                      key={ch.id}
                      to={`/channels/${ch.id}`}
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Hash size={15} className="text-gray-500 shrink-0" />
                        <p className="text-sm text-gray-800 truncate">{ch.name}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">freechat</span>
                    </Link>
                  ))}
                  {freeChats.length === 0 && <p className="text-sm text-gray-500">No free chats.</p>}
                </div>
                <Pager page={freeChatPage} setPage={setFreeChatPage} total={freeChats.length} />
              </>
            )}
          </section>

          <section className="pt-1">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setRunsOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {runsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Runs
              </button>
              <p className="text-xs text-gray-400">{runItems.length}</p>
            </div>
            {runsOpen && (
              <>
                <div className="space-y-2">
                  {paginate(runItems, runPage).map((r) => (
                    <Link
                      key={r.id}
                      to={`/runs/${r.id}`}
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayCircle size={15} className="text-indigo-600 shrink-0" />
                        <p className="text-sm text-gray-800 truncate">{runLabel(r)}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{r.status}</span>
                    </Link>
                  ))}
                  {runItems.length === 0 && <p className="text-sm text-gray-500">No runs.</p>}
                </div>
                <Pager page={runPage} setPage={setRunPage} total={runItems.length} />
              </>
            )}
          </section>

          <section className="pt-1">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setWorkflowsOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {workflowsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Workflows
              </button>
              <p className="text-xs text-gray-400">{workflowChannels.length}</p>
            </div>
            {workflowsOpen && (
              <>
                <div className="space-y-2">
                  {paginate(workflowChannels, workflowPage).map((ch) => (
                    <Link
                      key={ch.id}
                      to={ch.graph_id ? `/graphs/${ch.graph_id}?chat=1` : `/channels/${ch.id}`}
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch size={15} className="text-brand-600 shrink-0" />
                        <p className="text-sm text-gray-800 truncate">{ch.name}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">workflow</span>
                    </Link>
                  ))}
                  {workflowChannels.length === 0 && <p className="text-sm text-gray-500">No workflow channels.</p>}
                </div>
                <Pager page={workflowPage} setPage={setWorkflowPage} total={workflowChannels.length} />
              </>
            )}
          </section>

          <section className="pt-1">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setHandbookOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {handbookOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Handbook
              </button>
              <p className="text-xs text-gray-400">{handbookChannels.length}</p>
            </div>
            {handbookOpen && (
              <>
                <div className="space-y-2">
                  {paginate(handbookChannels, handbookPage).map((ch) => (
                    <Link
                      key={ch.id}
                      to={`/channels/${ch.id}`}
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen size={15} className="text-emerald-600 shrink-0" />
                        <p className="text-sm text-gray-800 truncate">{ch.name}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">handbook</span>
                    </Link>
                  ))}
                  {handbookChannels.length === 0 && <p className="text-sm text-gray-500">No handbook channels.</p>}
                </div>
                <Pager page={handbookPage} setPage={setHandbookPage} total={handbookChannels.length} />
              </>
            )}
          </section>
        </>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Create</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>

            {mode === 'menu' && (
              <div className="grid gap-2">
                <button onClick={() => setMode('workflow')} className="text-left border border-gray-200 rounded-lg p-3 hover:border-brand-300">
                  <p className="text-sm font-medium text-gray-900">Create a workflow</p>
                  <p className="text-xs text-gray-500 mt-1">Start a new workflow design chat.</p>
                </button>
                <button onClick={() => setMode('run')} className="text-left border border-gray-200 rounded-lg p-3 hover:border-brand-300">
                  <p className="text-sm font-medium text-gray-900">Create a run</p>
                  <p className="text-xs text-gray-500 mt-1">Pick a runnable workflow and continue in Trigger Run dialog.</p>
                </button>
                <button
                  disabled
                  className="text-left border border-gray-200 rounded-lg p-3 bg-gray-50 text-gray-400 cursor-not-allowed"
                  title="Coming soon"
                >
                  <p className="text-sm font-medium">Create a free chat</p>
                  <p className="text-xs mt-1">Coming soon.</p>
                </button>
              </div>
            )}

            {mode === 'workflow' && (
              <form onSubmit={handleCreateWorkflow} className="space-y-3">
                <label className="block text-xs text-gray-500">Workflow name</label>
                <input
                  autoFocus
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Contract review"
                />
                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setMode('menu')} className="text-sm text-gray-600">Back</button>
                  <button type="submit" disabled={!workflowName.trim() || createGraph.isPending} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-40">Create workflow</button>
                </div>
              </form>
            )}

            {mode === 'run' && (
              <form onSubmit={handleCreateRun} className="space-y-3">
                <label className="block text-xs text-gray-500">Runnable workflow</label>
                <select
                  value={selectedGraphId}
                  onChange={(e) => setSelectedGraphId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select workflow...</option>
                  {runnableGraphs.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">Only eligible workflows are listed.</p>
                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setMode('menu')} className="text-sm text-gray-600">Back</button>
                  <button type="submit" disabled={!selectedGraphId} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-40">Next</button>
                </div>
              </form>
            )}

            {mode === 'chat' && (
              <form className="space-y-3">
                <label className="block text-xs text-gray-500">Channel name</label>
                <input
                  disabled
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Coming soon"
                />
                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setMode('menu')} className="text-sm text-gray-600">Back</button>
                  <button type="button" disabled className="px-3 py-2 rounded-lg bg-gray-300 text-white text-sm">Coming soon</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {runTrigger && (
        <RunTriggerModal
          graphId={runTrigger.graphId}
          definition={runTrigger.definition}
          onClose={() => setRunTrigger(null)}
        />
      )}
    </div>
  )
}
