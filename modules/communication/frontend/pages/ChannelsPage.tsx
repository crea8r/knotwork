import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronDown, ChevronRight, Hash, Megaphone, GitBranch, PlayCircle, Search } from 'lucide-react'
import { useChannelMessages, useChannels, useMyChannelSubscriptions } from '@modules/communication/frontend/api/channels'
import { useObjectives } from "@modules/projects/frontend/api/projects"
import { useGraphs } from "@modules/workflows/frontend/api/graphs"
import { useRuns } from "@modules/workflows/frontend/api/runs"
import { projectObjectivePath } from '@app-shell/paths'
import { useAuthStore } from '@auth'
import Spinner from '@ui/components/Spinner'
import EmptyState from '@ui/components/EmptyState'
import { workflowAssetLinkForGraph } from '@modules/workflows/frontend/lib/workflowAssetLinks'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const PAGE_SIZE = 10

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

  const { data: channels = [], isLoading: channelsLoading } = useChannels(workspaceId)
  const { data: subscriptions = [] } = useMyChannelSubscriptions(workspaceId)
  const { data: workflows = [] } = useGraphs(workspaceId)
  const { data: runs = [], isLoading: runsLoading } = useRuns(workspaceId)
  const { data: objectives = [] } = useObjectives(workspaceId)
  const [search, setSearch] = useState('')

  const [freeChatPage, setFreeChatPage] = useState(1)
  const [runPage, setRunPage] = useState(1)
  const [workflowPage, setWorkflowPage] = useState(1)
  const [knowledgePage, setKnowledgePage] = useState(1)
  const [objectivePage, setObjectivePage] = useState(1)
  const [bulletinOpen, setBulletinOpen] = useState(true)
  const [freeChatOpen, setFreeChatOpen] = useState(true)
  const [objectiveOpen, setObjectiveOpen] = useState(true)
  const [runsOpen, setRunsOpen] = useState(true)
  const [workflowsOpen, setWorkflowsOpen] = useState(true)
  const [knowledgeOpen, setKnowledgeOpen] = useState(true)

  useEffect(() => {
    setFreeChatPage(1)
    setRunPage(1)
    setWorkflowPage(1)
    setKnowledgePage(1)
    setObjectivePage(1)
  }, [search])

  const q = search.trim().toLowerCase()
  const workflowById = useMemo(() => new Map(workflows.map((workflow) => [workflow.id, workflow])), [workflows])

  const bulletinChannels = useMemo(() => {
    const bulletins = channels.filter((c) => c.channel_type === 'bulletin')
    const filtered = q ? bulletins.filter((c) => c.name.toLowerCase().includes(q)) : bulletins
    return [...filtered].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [channels, q])
  const primaryBulletin = bulletinChannels[0] ?? null
  const { data: bulletinMessages = [] } = useChannelMessages(workspaceId, primaryBulletin?.slug ?? '')
  const latestBulletinMessage = bulletinMessages.length > 0 ? bulletinMessages[bulletinMessages.length - 1] : null

  const freeChats = useMemo(() => {
    const normals = channels.filter((c) => c.channel_type === 'normal' || c.channel_type === 'agent_main')
    const filtered = q ? normals.filter((c) => c.name.toLowerCase().includes(q)) : normals
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [channels, q])

  const objectiveByChannelId = useMemo(
    () => new Map(objectives.filter((objective) => objective.channel_id).map((objective) => [objective.channel_id as string, objective])),
    [objectives],
  )

  const objectiveChannels = useMemo(() => {
    const rows = channels.filter((c) => c.channel_type === 'objective')
    const filtered = q
      ? rows.filter((channel) => {
          const objective = objectiveByChannelId.get(channel.id)
          const label = objective ? [objective.code, objective.title].filter(Boolean).join(' ') : channel.name
          return `${label} ${channel.name}`.toLowerCase().includes(q)
        })
      : rows
    return filtered
      .map((channel) => ({
        channel,
        objective: objectiveByChannelId.get(channel.id) ?? null,
      }))
      .sort((a, b) => new Date(b.channel.updated_at).getTime() - new Date(a.channel.updated_at).getTime())
  }, [channels, objectiveByChannelId, q])

  const workflowChannels = useMemo(() => {
    const workflows = channels.filter((c) => c.channel_type === 'workflow')
    const filtered = q ? workflows.filter((c) => c.name.toLowerCase().includes(q)) : workflows
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [channels, q])

  const knowledgeChannels = useMemo(() => {
    const knowledge = channels.filter((c) => c.channel_type === 'knowledge')
    const filtered = q ? knowledge.filter((c) => c.name.toLowerCase().includes(q)) : knowledge
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
  const subscribedChannelIds = new Set(subscriptions.filter((row) => row.subscribed).map((row) => row.channel_id))

  return (
    <div data-ui="channels.page" className="p-6 md:p-8 max-w-5xl mx-auto space-y-5">
      <div data-ui="channels.header">
        <h1 data-ui="channels.header.title" className="text-xl font-semibold text-gray-900">Channels</h1>
        <p className="text-sm text-gray-500 mt-1">Workspace bulletin, free chat, objective threads, knowledge, runs, and workflows in one place.</p>
      </div>

      <div data-ui="channels.search" className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search channels and runs..."
          data-ui="channels.search.input"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {isLoading ? (
        <div data-ui="channels.loading" className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : bulletinChannels.length === 0 && freeChats.length === 0 && objectiveChannels.length === 0 && workflowChannels.length === 0 && knowledgeChannels.length === 0 && runItems.length === 0 ? (
        <div data-ui="channels.empty">
          <EmptyState heading="No items found" subtext="Try a different search or create new items." />
        </div>
      ) : (
        <>
          <section data-ui="channels.section.bulletin">
            <div data-ui="channels.section.bulletin.header" className="flex items-center justify-between mb-2">
              <button
                onClick={() => setBulletinOpen((v) => !v)}
                data-ui="channels.section.bulletin.toggle"
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {bulletinOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Bulletin
              </button>
              <p className="text-xs text-gray-400">{bulletinChannels.length}</p>
            </div>
            {bulletinOpen && (
              <div data-ui="channels.section.bulletin.list" className="space-y-2">
                {bulletinChannels.map((ch) => (
                  <Link
                    key={ch.id}
                    to={`/channels/${ch.slug}`}
                    data-ui="channels.section.bulletin.item"
                    className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 hover:border-amber-300"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Megaphone size={15} className="text-amber-700 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{ch.name}</p>
                        <p className="text-xs text-amber-800 truncate">
                          {latestBulletinMessage?.channel_id === ch.id
                            ? latestBulletinMessage.content
                            : 'Workspace-wide announcements and shared updates'}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      {subscribedChannelIds.has(ch.id) ? 'following' : 'muted'}
                    </span>
                  </Link>
                ))}
                {bulletinChannels.length === 0 && <p className="text-sm text-gray-500">No workspace bulletin yet.</p>}
              </div>
            )}
          </section>

          <section data-ui="channels.section.free-chat">
            <div data-ui="channels.section.free-chat.header" className="flex items-center justify-between mb-2">
              <button
                onClick={() => setFreeChatOpen((v) => !v)}
                data-ui="channels.section.free-chat.toggle"
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {freeChatOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Free chat
              </button>
              <p className="text-xs text-gray-400">{freeChats.length}</p>
            </div>
            {freeChatOpen && (
              <>
                <div data-ui="channels.section.free-chat.list" className="space-y-2">
                  {paginate(freeChats, freeChatPage).map((ch) => (
                    <Link
                      key={ch.id}
                      to={`/channels/${ch.slug}`}
                      data-ui="channels.section.free-chat.item"
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Hash size={15} className="text-gray-500 shrink-0" />
                        <p className="text-sm text-gray-800 truncate">{ch.name}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {subscribedChannelIds.has(ch.id) ? 'following' : 'muted'}
                      </span>
                    </Link>
                  ))}
                  {freeChats.length === 0 && <p className="text-sm text-gray-500">No free chats.</p>}
                </div>
                <Pager page={freeChatPage} setPage={setFreeChatPage} total={freeChats.length} />
              </>
            )}
          </section>

          <section data-ui="channels.section.objectives" className="pt-1">
            <div data-ui="channels.section.objectives.header" className="flex items-center justify-between mb-2">
              <button
                onClick={() => setObjectiveOpen((v) => !v)}
                data-ui="channels.section.objectives.toggle"
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {objectiveOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Objectives
              </button>
              <p className="text-xs text-gray-400">{objectiveChannels.length}</p>
            </div>
            {objectiveOpen && (
              <>
                <div data-ui="channels.section.objectives.list" className="space-y-2">
                  {paginate(objectiveChannels, objectivePage).map(({ channel, objective }) => (
                    <Link
                      key={channel.id}
                      to={objective?.project_slug ? projectObjectivePath(objective.project_slug, objective.slug) : `/channels/${channel.slug}`}
                      data-ui="channels.section.objectives.item"
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Hash size={15} className="text-stone-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm text-gray-800 truncate">
                            {objective ? [objective.code, objective.title].filter(Boolean).join(' · ') : channel.name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{channel.name}</p>
                        </div>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {subscribedChannelIds.has(channel.id) ? 'following' : 'muted'}
                      </span>
                    </Link>
                  ))}
                  {objectiveChannels.length === 0 && <p className="text-sm text-gray-500">No objective channels.</p>}
                </div>
                <Pager page={objectivePage} setPage={setObjectivePage} total={objectiveChannels.length} />
              </>
            )}
          </section>

          <section data-ui="channels.section.runs" className="pt-1">
            <div data-ui="channels.section.runs.header" className="flex items-center justify-between mb-2">
              <button
                onClick={() => setRunsOpen((v) => !v)}
                data-ui="channels.section.runs.toggle"
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {runsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Runs
              </button>
              <p className="text-xs text-gray-400">{runItems.length}</p>
            </div>
            {runsOpen && (
              <>
                <div data-ui="channels.section.runs.list" className="space-y-2">
                  {paginate(runItems, runPage).map((r) => (
                    <Link
                      key={r.id}
                      to={`/runs/${r.id}`}
                      data-ui="channels.section.runs.item"
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

          <section data-ui="channels.section.workflows" className="pt-1">
            <div data-ui="channels.section.workflows.header" className="flex items-center justify-between mb-2">
              <button
                onClick={() => setWorkflowsOpen((v) => !v)}
                data-ui="channels.section.workflows.toggle"
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {workflowsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Workflows
              </button>
              <p className="text-xs text-gray-400">{workflowChannels.length}</p>
            </div>
            {workflowsOpen && (
              <>
                <div data-ui="channels.section.workflows.list" className="space-y-2">
                  {paginate(workflowChannels, workflowPage).map((ch) => (
                    <Link
                      key={ch.id}
                      to={ch.graph_id && workflowById.get(ch.graph_id)
                        ? workflowAssetLinkForGraph(workflowById.get(ch.graph_id)!, { assetChat: true })
                        : `/channels/${ch.slug}`}
                      data-ui="channels.section.workflows.item"
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch size={15} className="text-brand-600 shrink-0" />
                        <p className="text-sm text-gray-800 truncate">{ch.name}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {subscribedChannelIds.has(ch.id) ? 'following' : 'muted'}
                      </span>
                    </Link>
                  ))}
                  {workflowChannels.length === 0 && <p className="text-sm text-gray-500">No workflow channels.</p>}
                </div>
                <Pager page={workflowPage} setPage={setWorkflowPage} total={workflowChannels.length} />
              </>
            )}
          </section>

          <section data-ui="channels.section.knowledge" className="pt-1">
            <div data-ui="channels.section.knowledge.header" className="flex items-center justify-between mb-2">
              <button
                onClick={() => setKnowledgeOpen((v) => !v)}
                data-ui="channels.section.knowledge.toggle"
                className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {knowledgeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Knowledge
              </button>
              <p className="text-xs text-gray-400">{knowledgeChannels.length}</p>
            </div>
            {knowledgeOpen && (
              <>
                <div data-ui="channels.section.knowledge.list" className="space-y-2">
                  {paginate(knowledgeChannels, knowledgePage).map((ch) => (
                    <Link
                      key={ch.id}
                      to={`/channels/${ch.slug}`}
                      data-ui="channels.section.knowledge.item"
                      className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-brand-300"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen size={15} className="text-emerald-600 shrink-0" />
                        <p className="text-sm text-gray-800 truncate">{ch.name}</p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">knowledge</span>
                    </Link>
                  ))}
                  {knowledgeChannels.length === 0 && <p className="text-sm text-gray-500">No knowledge channels.</p>}
                </div>
                <Pager page={knowledgePage} setPage={setKnowledgePage} total={knowledgeChannels.length} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
