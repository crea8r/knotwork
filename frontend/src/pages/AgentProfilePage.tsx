import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, ChevronRight, Pencil, RefreshCw, X } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import Badge from '@/components/shared/Badge'
import AgentChatTab from '@/components/agents/AgentChatTab'
import {
  useAgent,
  useAgentCapabilityLatest,
  useAgentDebugLinks,
  useAgentUsage,
  useAgentMainChatMessages,
  useAskAgentMainChat,
  useEnsureAgentMainChat,
  useOpenClawDebugState,
  useRefreshCapabilities,
  useUpdateAgent,
} from '@/api/agents'
import { AVATAR_OPTIONS } from '@/utils/agentAvatars'

type ProfileTab = 'chat' | 'skills' | 'history' | 'logs'
const USAGE_PAGE_SIZE = 15
const SKILLS_REPLY_KEY = (id: string) => `knotwork:skills-reply:${id}`

interface StoredSkillsReply { reply: string; timestamp: string }

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'A'
}

function variantByStatus(s?: string): 'green' | 'gray' | 'red' | 'orange' | 'purple' {
  if (s === 'active') return 'green'
  if (s === 'fail') return 'red'
  if (s === 'warning') return 'orange'
  if (s === 'inactive') return 'gray'
  return 'purple'
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function PageButtons({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null
  const pages = Array.from({ length: total }, (_, i) => i + 1)
  const visible = pages.filter((p) => p === 1 || p === total || Math.abs(p - page) <= 1)
  const withGaps: (number | '…')[] = []
  visible.forEach((p, i) => {
    if (i > 0 && (p as number) - (visible[i - 1] as number) > 1) withGaps.push('…')
    withGaps.push(p)
  })
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(page - 1)} disabled={page <= 1}
        className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center disabled:opacity-30 hover:bg-gray-50">
        <ChevronLeft size={13} />
      </button>
      {withGaps.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-gray-400">…</span>
        ) : (
          <button key={p} onClick={() => onChange(p as number)}
            className={`w-7 h-7 rounded-lg text-xs border transition-colors ${
              p === page
                ? 'bg-brand-600 text-white border-brand-600'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {p}
          </button>
        )
      )}
      <button onClick={() => onChange(page + 1)} disabled={page >= total}
        className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center disabled:opacity-30 hover:bg-gray-50">
        <ChevronRight size={13} />
      </button>
    </div>
  )
}

export default function AgentProfilePage() {
  const { agentId = '' } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const { data: agent, isLoading } = useAgent(agentId)
  const { data: usage = [] } = useAgentUsage(agentId)
  const { data: capabilityLatest, isLoading: capabilityLoading } = useAgentCapabilityLatest(agentId)
  const { data: debugLinks = [] } = useAgentDebugLinks(agentId)
  const { data: debugState } = useOpenClawDebugState()

  const ensureMainChat = useEnsureAgentMainChat(agentId)
  const { data: chatMessages = [], isLoading: chatMsgLoading } = useAgentMainChatMessages(agentId)
  const ask = useAskAgentMainChat(agentId)
  const update = useUpdateAgent(agentId)
  const refresh = useRefreshCapabilities(agentId)

  const [tab, setTab] = useState<ProfileTab>('chat')
  const [logFilter, setLogFilter] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [showAvatarPanel, setShowAvatarPanel] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [bio, setBio] = useState('')
  const [editingBio, setEditingBio] = useState(false)

  const [chatReady, setChatReady] = useState(false)
  const [chatStatusMsg, setChatStatusMsg] = useState('Connecting…')
  const [sessionName, setSessionName] = useState<string | null>(null)

  const [skillsReply, setSkillsReply] = useState<string | null>(null)
  const [skillsReplyAt, setSkillsReplyAt] = useState<string | null>(null)
  const [askingSkills, setAskingSkills] = useState(false)
  const [usagePage, setUsagePage] = useState(1)

  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const allAvatars = useMemo(() => AVATAR_OPTIONS, [])

  // Load persisted skills reply from localStorage
  useEffect(() => {
    if (!agentId) return
    const raw = localStorage.getItem(SKILLS_REPLY_KEY(agentId))
    if (raw) {
      try {
        const stored: StoredSkillsReply = JSON.parse(raw)
        setSkillsReply(stored.reply)
        setSkillsReplyAt(stored.timestamp)
      } catch {}
    }
  }, [agentId])

  useEffect(() => {
    if (!agent) return
    setDisplayName(agent.display_name)
    setAvatarUrl(agent.avatar_url ?? '')
    setBio(agent.bio ?? '')
    if (agent.provider !== 'openclaw') setTab('skills')
  }, [agent?.id, agent?.provider])

  // Bootstrap main chat for OpenClaw agents
  useEffect(() => {
    if (agent?.provider !== 'openclaw') return
    let cancelled = false
    const deadline = Date.now() + 120_000
    async function boot() {
      while (!cancelled && Date.now() < deadline) {
        try {
          const r = await ensureMainChat.mutateAsync()
          if (r.ready) {
            if (!cancelled) { setChatReady(true); if (r.session_name) setSessionName(r.session_name) }
            return
          }
          if (r.status === 'timeout') { if (!cancelled) setChatStatusMsg('Initialization timed out.'); return }
          if (!cancelled) setChatStatusMsg(r.message || 'Connecting…')
        } catch (e: any) {
          const httpStatus: number = e?.response?.status ?? 0
          const detail: string = e?.response?.data?.detail ?? e?.message ?? 'Connection failed.'
          if (!cancelled) setChatStatusMsg(detail)
          // 4xx = permanent config error (e.g. integration not bound) — stop retrying
          if (httpStatus >= 400 && httpStatus < 500) return
          // 5xx / network errors — keep retrying until deadline
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (!cancelled) setChatStatusMsg('Initialization timed out.')
    }
    void boot()
    return () => { cancelled = true }
  }, [agent?.id, agent?.provider])

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (!agent) return <div className="p-8 text-red-500">Agent not found.</div>

  const isOpenClaw = agent.provider === 'openclaw'
  const totalPages = Math.ceil(usage.length / USAGE_PAGE_SIZE)
  const pagedUsage = usage.slice((usagePage - 1) * USAGE_PAGE_SIZE, usagePage * USAGE_PAGE_SIZE)

  // Bridge debug filtered for this agent
  const agentTasks = debugState?.recent_tasks.filter((t) => t.agent_ref === agent.agent_ref) ?? []
  const agentIntegrationIds = new Set(agentTasks.map((t) => t.integration_id))
  const agentIntegrations = debugState?.integrations.filter((i) => agentIntegrationIds.has(i.integration_id)) ?? []

  async function cropAndCompress(src: string): Promise<string> {
    const img = new Image()
    img.src = src
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('load')) })
    const iw = img.naturalWidth, ih = img.naturalHeight
    const base = Math.max(64, Math.min(iw, ih) / zoom)
    const mx = Math.max(0, (iw - base) / 2), my = Math.max(0, (ih - base) / 2)
    const sx = Math.min(iw - base, Math.max(0, (iw - base) / 2 + (offsetX / 100) * mx))
    const sy = Math.min(ih - base, Math.max(0, (ih - base) / 2 + (offsetY / 100) * my))
    const c = document.createElement('canvas'); c.width = 256; c.height = 256
    c.getContext('2d')!.drawImage(img, sx, sy, base, base, 0, 0, 256, 256)
    return c.toDataURL('image/webp', 0.82)
  }

  function saveSkillsReply(reply: string) {
    const entry: StoredSkillsReply = { reply, timestamp: new Date().toISOString() }
    localStorage.setItem(SKILLS_REPLY_KEY(agentId), JSON.stringify(entry))
    setSkillsReply(reply)
    setSkillsReplyAt(entry.timestamp)
  }

  async function handleAskSkills() {
    if (askingSkills) return
    setAskingSkills(true)
    if (isOpenClaw && chatReady) {
      try {
        const res = await ask.mutateAsync({
          message: 'What skills and tools do you have? Please list each one with a short description of what it does. Exclude file and shell skills from your response.',
        })
        if (res.status === 'completed' && res.reply) {
          saveSkillsReply(res.reply)
          refresh.mutate({ save_snapshot: true })
        } else if (res.status === 'timeout') {
          saveSkillsReply(
            `⏱ Request timed out — the OpenClaw plugin did not respond within 5 minutes.\n\nTask ID: ${res.task_id}\nCheck that the plugin is running and polling.`
          )
        } else if (res.status === 'failed') {
          saveSkillsReply(`❌ Agent returned an error: ${res.reply ?? 'Unknown error'}\n\nTask ID: ${res.task_id}`)
        } else if (res.status === 'escalated') {
          saveSkillsReply(`🙋 Agent needs input: ${res.question ?? ''}`)
        } else {
          saveSkillsReply(res.reply ?? 'No reply received.')
        }
      } catch (e: any) {
        saveSkillsReply(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Request failed'}`)
      }
    } else {
      refresh.mutate({ save_snapshot: true })
    }
    setAskingSkills(false)
  }

  const TABS: { key: ProfileTab; label: string }[] = [
    { key: 'chat', label: 'Chat' },
    { key: 'skills', label: 'Skills & Tools' },
    { key: 'history', label: 'History' },
    { key: 'logs', label: 'Logs' },
  ]

  return (
    <div className="flex flex-col">
      {/* ── Identity header ── */}
      <div className="border-b bg-white px-6 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-10 h-10 rounded-full object-cover border border-gray-200" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-semibold text-sm">
                  {initials(displayName || agent.display_name)}
                </div>
              )}
              <button type="button" onClick={() => setShowAvatarPanel((v) => !v)}
                className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full border border-gray-200 bg-white text-gray-600 flex items-center justify-center hover:text-brand-700">
                <Pencil size={10} />
              </button>
            </div>

            {/* Name */}
            {editingName ? (
              <input autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => { setEditingName(false); if (displayName.trim()) update.mutate({ display_name: displayName.trim(), avatar_url: avatarUrl || null }) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className="text-base font-semibold text-gray-900 border-b border-brand-400 outline-none bg-transparent min-w-0" />
            ) : (
              <button type="button" onClick={() => setEditingName(true)}
                className="text-base font-semibold text-gray-900 hover:text-brand-700 truncate text-left">
                {agent.display_name}
              </button>
            )}

            <Badge variant={isOpenClaw ? 'purple' : 'gray'} className="flex-shrink-0">{agent.provider}</Badge>
          </div>

          <button onClick={() => navigate('/settings?tab=agents')}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:border-gray-400 text-gray-500">
            ← Settings
          </button>
        </div>

        {/* Bio */}
        {editingBio ? (
          <textarea
            autoFocus
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            onBlur={() => {
              setEditingBio(false)
              update.mutate({ display_name: displayName, avatar_url: avatarUrl || null, bio: bio.trim() || null })
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditingBio(false) }}
            rows={2}
            maxLength={1000}
            placeholder="Describe what this agent does in your workspace…"
            className="w-full text-sm text-gray-700 border border-brand-300 rounded-lg px-3 py-2 outline-none resize-none bg-white"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingBio(true)}
            className="text-left w-full text-sm text-gray-500 hover:text-gray-700 italic"
          >
            {bio.trim() ? bio : <span className="text-gray-300">Add a short bio about what this agent does…</span>}
          </button>
        )}

        {/* Avatar edit panel */}
        {showAvatarPanel && (
          <div className="border border-gray-200 rounded-xl p-3 space-y-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Choose avatar</p>
              <button type="button" onClick={() => { setShowAvatarPanel(false); setCropSrc(null) }} className="text-gray-400 hover:text-gray-700"><X size={13} /></button>
            </div>
            {!cropSrc ? (
              <>
                <div className="flex items-center gap-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 6 * 1024 * 1024) { alert('Max 6 MB'); return }
                      const r = new FileReader()
                      r.onload = () => { const v = String(r.result || ''); if (v) { setCropSrc(v); setZoom(1); setOffsetX(0); setOffsetY(0) } }
                      r.readAsDataURL(f)
                    }}
                  />
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-600">Upload</button>
                  <button type="button" onClick={() => { setAvatarUrl(''); update.mutate({ display_name: displayName, avatar_url: null }) }} className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-600">Clear avatar</button>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {allAvatars.map((opt) => (
                    <button key={opt.id} type="button" onClick={() => { setAvatarUrl(opt.url); update.mutate({ display_name: displayName, avatar_url: opt.url }) }} title={opt.label}
                      className={`rounded-xl p-0.5 border aspect-square ${avatarUrl === opt.url ? 'border-brand-500 ring-2 ring-brand-200' : 'border-gray-200 hover:border-gray-400'}`}>
                      <img src={opt.url} alt={opt.label} className="w-full h-full rounded-lg object-cover" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="w-36 h-36 rounded-full overflow-hidden border border-gray-200 mx-auto relative">
                  <img src={cropSrc} alt="crop" className="absolute inset-0 w-full h-full object-cover"
                    style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`, transformOrigin: 'center' }} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                  <label>Zoom<input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-full" /></label>
                  <label>X<input type="range" min={-100} max={100} value={offsetX} onChange={(e) => setOffsetX(+e.target.value)} className="w-full" /></label>
                  <label>Y<input type="range" min={-100} max={100} value={offsetY} onChange={(e) => setOffsetY(+e.target.value)} className="w-full" /></label>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={async () => { try { const u = await cropAndCompress(cropSrc); setAvatarUrl(u); update.mutate({ display_name: displayName, avatar_url: u }); setCropSrc(null) } catch { alert('Crop failed.') } }} className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-lg">Apply</button>
                  <button type="button" onClick={() => setCropSrc(null)} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-600">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 -mb-4">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm rounded-t-lg border-x border-t transition-colors ${
                tab === key
                  ? 'bg-white border-gray-200 text-brand-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}>
              {label}
              {key === 'chat' && !isOpenClaw && <span className="ml-1 text-[10px] text-gray-400">(OpenClaw)</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div>

        {/* Chat */}
        {tab === 'chat' && (
          <div className="flex flex-col" style={{ height: 'calc(100vh - 220px)' }}>
            {!isOpenClaw ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-gray-400 italic">Main chat is available for OpenClaw agents only.</p>
              </div>
            ) : (
              <AgentChatTab
                agent={agent}
                chatReady={chatReady}
                chatStatusMsg={chatStatusMsg}
                sessionName={sessionName}
                chatMessages={chatMessages}
                chatMsgLoading={chatMsgLoading}
                isPending={ask.isPending}
                onSend={async (message, attachments) => {
                  const res = await ask.mutateAsync({ message, attachments })
                  return res
                }}
              />
            )}
          </div>
        )}

        {/* Skills & Tools */}
        {tab === 'skills' && (
          <div className="p-6 space-y-4 max-w-3xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-800">Skills & Tools</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isOpenClaw ? 'Ask the agent directly what it can do.' : "Fetched from the agent's capability contract."}
                </p>
              </div>
              <button onClick={handleAskSkills} disabled={askingSkills || (!chatReady && isOpenClaw)}
                className="text-sm px-4 py-2 bg-brand-600 text-white rounded-lg inline-flex items-center gap-2 disabled:opacity-50">
                <RefreshCw size={13} className={askingSkills ? 'animate-spin' : ''} />
                {askingSkills ? 'Asking…' : isOpenClaw ? 'Ask agent' : 'Refresh'}
              </button>
            </div>

            {isOpenClaw && (
              <div className={`rounded-xl border p-4 space-y-2 transition-colors ${
                skillsReply
                  ? skillsReply.startsWith('❌') || skillsReply.startsWith('⏱')
                    ? 'border-red-200 bg-red-50'
                    : 'border-brand-200 bg-brand-50'
                  : 'border-gray-200 bg-gray-50'
              }`}>
                {askingSkills ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Spinner /> Asking {agent.display_name}…
                  </div>
                ) : skillsReply ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-[11px] font-semibold uppercase tracking-wide ${
                        skillsReply.startsWith('❌') || skillsReply.startsWith('⏱') ? 'text-red-600' : 'text-brand-600'
                      }`}>
                        {skillsReply.startsWith('❌') || skillsReply.startsWith('⏱') ? 'Error' : `${agent.display_name} replied`}
                      </p>
                      {skillsReplyAt && (
                        <p className="text-[10px] text-gray-400">
                          {new Date(skillsReplyAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="prose prose-sm max-w-none text-gray-800">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{skillsReply}</ReactMarkdown>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 italic">
                    {chatReady
                      ? `Click "Ask agent" to find out what ${agent.display_name} can do.`
                      : `Waiting for chat connection… (${chatStatusMsg})`}
                  </p>
                )}
              </div>
            )}

            {/* Structured capability contract */}
            {capabilityLoading ? (
              <div className="pt-2"><Spinner /></div>
            ) : capabilityLatest && capabilityLatest.tools.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  Structured contract · last updated {new Date(capabilityLatest.refreshed_at).toLocaleString()}
                  {capabilityLatest.version ? ` · v${capabilityLatest.version}` : ''}
                </p>
                {capabilityLatest.tools.map((tool) => (
                  <div key={tool.name} className="border border-gray-200 rounded-lg p-3 bg-white flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{tool.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{tool.description}</p>
                    </div>
                    {tool.risk_class && <span className="flex-shrink-0"><Badge variant="gray">{tool.risk_class}</Badge></span>}
                  </div>
                ))}
                {(capabilityLatest.policy_notes ?? []).length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-gray-500 space-y-1 pt-1">
                    {capabilityLatest.policy_notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
              </div>
            ) : capabilityLatest ? (
              <p className="text-sm text-gray-400 italic">No structured tools in capability contract.</p>
            ) : !isOpenClaw ? (
              <p className="text-sm text-gray-400 italic">No capability contract yet. Click Refresh.</p>
            ) : null}
          </div>
        )}

        {/* History */}
        {tab === 'history' && (
          <div className="p-6 space-y-3 max-w-3xl">
            {usage.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No usage history yet.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">{usage.length} entries</p>
                  <PageButtons page={usagePage} total={totalPages} onChange={setUsagePage} />
                </div>
                <ul className="space-y-2">
                  {pagedUsage.map((u, idx) => (
                    <li key={`${u.type}-${u.run_id ?? u.workflow_id ?? idx}`}
                      className="border border-gray-100 rounded-lg p-3 bg-white flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm text-gray-800">
                          {u.type === 'run' && u.run_id ? (
                            <Link to={`/runs/${u.run_id}`} className="text-brand-700 hover:underline">
                              {u.workflow_name ?? u.run_id.slice(0, 8)}
                            </Link>
                          ) : u.workflow_name ?? 'Workflow'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(u.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={variantByStatus(u.status ?? 'inactive')}>{u.status ?? u.type}</Badge>
                    </li>
                  ))}
                </ul>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-gray-400">
                      {(usagePage - 1) * USAGE_PAGE_SIZE + 1}–{Math.min(usagePage * USAGE_PAGE_SIZE, usage.length)} of {usage.length}
                    </p>
                    <PageButtons page={usagePage} total={totalPages} onChange={setUsagePage} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Logs */}
        {tab === 'logs' && (
          <div className="p-6 space-y-5">

            {/* Bridge debug — OpenClaw only */}
            {isOpenClaw && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Bridge logs</p>
                {agentIntegrations.length === 0 && agentTasks.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No bridge activity for this agent yet.</p>
                ) : (
                  <div className="space-y-3">
                    {agentIntegrations.map((it) => {
                      const ageSec = Math.max(0, Math.floor((Date.now() - new Date(it.last_seen_at).getTime()) / 1000))
                      return (
                        <div key={it.integration_id} className="rounded-lg border border-gray-200 bg-white p-3 text-xs space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={ageSec < 20 ? 'green' : ageSec < 120 ? 'orange' : 'red'}>
                              heartbeat {ageSec}s ago
                            </Badge>
                            <span className="font-mono text-gray-600">{it.plugin_instance_id}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-x-4 text-gray-500">
                            <span>pending: <strong className="text-gray-700">{it.pending_count}</strong></span>
                            <span>completed: <strong className="text-gray-700">{it.completed_count}</strong></span>
                            <span>failed: <strong className="text-gray-700">{it.failed_count}</strong></span>
                          </div>
                        </div>
                      )
                    })}

                    {agentTasks.length > 0 && (() => {
                      const q = logFilter.trim().toLowerCase()
                      const filtered = q
                        ? agentTasks.filter((t) =>
                            t.task_id.toLowerCase().includes(q) ||
                            (t.node_id ?? '').toLowerCase().includes(q) ||
                            t.status.toLowerCase().includes(q) ||
                            (t.run_id ?? '').toLowerCase().includes(q)
                          )
                        : agentTasks
                      return (
                        <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
                          <div className="px-3 py-2 bg-gray-50 border-b flex items-center gap-2">
                            <span className="font-semibold text-gray-500 text-[11px] uppercase tracking-wide flex-shrink-0">
                              Tasks
                            </span>
                            <input
                              type="text"
                              value={logFilter}
                              onChange={(e) => setLogFilter(e.target.value)}
                              placeholder="Filter by task ID, node, status, run ID…"
                              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:border-brand-400 bg-white"
                            />
                            {logFilter && (
                              <button onClick={() => setLogFilter('')} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                                <X size={12} />
                              </button>
                            )}
                            {q && (
                              <span className="text-[10px] text-gray-400 flex-shrink-0">{filtered.length} / {agentTasks.length}</span>
                            )}
                          </div>
                          <div className="max-h-[60vh] overflow-auto">
                            <table className="w-full">
                              <thead className="bg-white sticky top-0 border-b border-gray-100">
                                <tr className="text-left text-gray-500">
                                  <th className="px-3 py-2">Task</th>
                                  <th className="px-3 py-2">Node</th>
                                  <th className="px-3 py-2">Status</th>
                                  <th className="px-3 py-2">Failed at</th>
                                  <th className="px-3 py-2">Events</th>
                                  <th className="px-3 py-2">Created</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filtered.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="px-3 py-4 text-center text-gray-400 italic">No tasks match "{logFilter}"</td>
                                  </tr>
                                ) : filtered.map((t) => (
                                  <Fragment key={t.task_id}>
                                    <tr className="border-t border-gray-50 align-top">
                                      <td className="px-3 py-2 font-mono text-gray-700">{t.task_id.slice(0, 8)}</td>
                                      <td className="px-3 py-2 text-gray-600">{t.node_id}</td>
                                      <td className="px-3 py-2">
                                        <Badge variant={t.status === 'completed' ? 'green' : t.status === 'failed' ? 'red' : t.status === 'pending' ? 'orange' : 'gray'}>
                                          {t.status}
                                        </Badge>
                                      </td>
                                      <td className="px-3 py-2 text-gray-500">
                                        {t.status === 'failed' ? formatTimestamp(t.failed_at) : '—'}
                                      </td>
                                      <td className="px-3 py-2 text-gray-600">{t.event_count}</td>
                                      <td className="px-3 py-2 text-gray-400">{formatTimestamp(t.created_at)}</td>
                                    </tr>
                                    {t.status === 'failed' && t.error_message && (
                                      <tr className="border-t border-red-50 bg-red-50/60">
                                        <td className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                                          Error
                                        </td>
                                        <td colSpan={5} className="px-3 py-2">
                                          <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-red-700">
                                            {t.error_message}
                                          </pre>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Provider debug links */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Provider debug links</p>
              {debugLinks.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No provider debug links yet.</p>
              ) : (
                <ul className="space-y-2">
                  {debugLinks.map((d, idx) => (
                    <li key={`${d.run_id}-${d.node_id ?? ''}-${idx}`}
                      className="border border-gray-100 rounded-lg p-3 bg-white text-xs text-gray-600 space-y-1">
                      <p>
                        <Link to={`/runs/${d.run_id}`} className="text-brand-700 hover:underline font-medium">
                          Run {d.run_id.slice(0, 8)}
                        </Link>
                        {d.node_id ? <span className="text-gray-400"> · {d.node_id}</span> : null}
                      </p>
                      {d.provider_request_id && <p className="font-mono text-gray-500 break-all">req: {d.provider_request_id}</p>}
                      {d.provider_trace_id && <p className="font-mono text-gray-500 break-all">trace: {d.provider_trace_id}</p>}
                      <p className="text-gray-400">{new Date(d.created_at).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
