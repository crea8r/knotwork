import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, PlayCircle, Power, RefreshCw, Star, X } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import {
  useActivateAgent,
  useAgent,
  useAgentCapabilities,
  useAgentCapabilityLatest,
  useAgentDebugLinks,
  useAgentHistory,
  useAgentPreflightRuns,
  useAgentUsage,
  useDeactivateAgent,
  usePromotePreflightBaseline,
  useRefreshCapabilities,
  useRunPreflight,
  useUpdateAgent,
} from '@/api/agents'
import { AVATAR_OPTIONS } from '@/utils/agentAvatars'

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'A'
}

function variantByStatus(status?: string): 'green' | 'gray' | 'red' | 'orange' | 'purple' {
  if (status === 'active' || status === 'pass') return 'green'
  if (status === 'fail') return 'red'
  if (status === 'warning') return 'orange'
  if (status === 'inactive' || status === 'never_run') return 'gray'
  return 'purple'
}

export default function AgentProfilePage() {
  const { agentId = '' } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const { data: agent, isLoading } = useAgent(agentId)
  const { data: history = [], isLoading: historyLoading } = useAgentHistory(agentId)
  const { data: usage = [] } = useAgentUsage(agentId)
  const { data: capabilityLatest, isLoading: capabilityLoading } = useAgentCapabilityLatest(agentId)
  const { data: capabilitySnapshots = [] } = useAgentCapabilities(agentId)
  const { data: preflightRuns = [], isLoading: preflightLoading } = useAgentPreflightRuns(agentId)
  const { data: debugLinks = [], isLoading: debugLoading } = useAgentDebugLinks(agentId)

  const update = useUpdateAgent(agentId)
  const refresh = useRefreshCapabilities(agentId)
  const runPreflight = useRunPreflight(agentId)
  const activate = useActivateAgent(agentId)
  const deactivate = useDeactivateAgent(agentId)
  const promoteBaseline = usePromotePreflightBaseline(agentId)

  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [showAvatarPanel, setShowAvatarPanel] = useState(false)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const allAvatars = useMemo(() => AVATAR_OPTIONS, [])

  useEffect(() => {
    if (!agent) return
    setDisplayName(agent.display_name)
    setAvatarUrl(agent.avatar_url ?? '')
  }, [agent])

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }
  if (!agent) {
    return <div className="p-8 text-red-500">Agent not found.</div>
  }

  async function cropAndCompressAvatar(src: string): Promise<string> {
    const img = new Image()
    img.src = src
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
    })

    const iw = img.naturalWidth
    const ih = img.naturalHeight
    const base = Math.max(64, Math.min(iw, ih) / zoom)
    const maxX = Math.max(0, (iw - base) / 2)
    const maxY = Math.max(0, (ih - base) / 2)
    const srcX = Math.min(iw - base, Math.max(0, (iw - base) / 2 + (offsetX / 100) * maxX))
    const srcY = Math.min(ih - base, Math.max(0, (ih - base) / 2 + (offsetY / 100) * maxY))

    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')

    ctx.drawImage(img, srcX, srcY, base, base, 0, 0, 256, 256)
    return canvas.toDataURL('image/webp', 0.82)
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs text-gray-400">Agent profile</p>
          <h1 className="text-xl font-semibold text-gray-900">{agent.display_name}</h1>
        </div>
        <button
          onClick={() => navigate('/settings?tab=agents')}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:border-gray-400 text-gray-600"
        >
          Back to Settings
        </button>
      </div>

      <Card className="p-5 space-y-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Identity & lifecycle</p>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-14 h-14 rounded-full object-cover border border-gray-200" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-semibold">
                  {initials(displayName || agent.display_name)}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowAvatarPanel((v) => !v)}
                className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full border border-gray-200 bg-white text-gray-600 flex items-center justify-center hover:text-brand-700 hover:border-brand-300"
                title="Edit avatar"
              >
                <Pencil size={12} />
              </button>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={agent.provider === 'openclaw' ? 'purple' : 'gray'}>{agent.provider}</Badge>
                {agent.provider !== 'openclaw' ? <Badge variant="orange">legacy</Badge> : null}
                <Badge variant={variantByStatus(agent.status)}>{agent.status}</Badge>
                <Badge variant={variantByStatus(agent.preflight_status)}>{agent.preflight_status}</Badge>
              </div>
              <p className="text-xs text-gray-500 font-mono">{agent.agent_ref}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => refresh.mutate({ save_snapshot: true })}
              className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 inline-flex items-center gap-1"
            >
              <RefreshCw size={12} /> Refresh
            </button>
            <button
              onClick={() => runPreflight.mutate({ suite: 'default', include_optional: true })}
              className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 inline-flex items-center gap-1"
            >
              <PlayCircle size={12} /> Preflight
            </button>
            {agent.status === 'active' ? (
              <button
                onClick={() => deactivate.mutate({ reason: 'manual' })}
                className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 inline-flex items-center gap-1"
              >
                <Power size={12} /> Deactivate
              </button>
            ) : (
              <button
                onClick={() => activate.mutate({ allow_warning: false })}
                className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 inline-flex items-center gap-1"
              >
                <Power size={12} /> Activate
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <div className="text-xs text-gray-500 space-y-1 pt-1">
            <p>Capability version: <span className="font-mono">{agent.capability_version ?? '—'}</span></p>
            <p>Last refresh: {agent.capability_refreshed_at ? new Date(agent.capability_refreshed_at).toLocaleString() : 'never'}</p>
            <p>Last used: {agent.last_used_at ? new Date(agent.last_used_at).toLocaleString() : 'never'}</p>
          </div>
        </div>

        {showAvatarPanel && (
          <div className="border border-gray-200 rounded-xl p-3 space-y-3 bg-gray-50">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500">Choose avatar</p>
              <button type="button" onClick={() => setShowAvatarPanel(false)} className="text-gray-400 hover:text-gray-700">
                <X size={14} />
              </button>
            </div>

            {!cropSource && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 6 * 1024 * 1024) {
                        alert('Please upload an image smaller than 6MB.')
                        return
                      }
                      const reader = new FileReader()
                      reader.onload = () => {
                        const val = String(reader.result || '')
                        if (val) {
                          setCropSource(val)
                          setZoom(1)
                          setOffsetX(0)
                          setOffsetY(0)
                        }
                      }
                      reader.readAsDataURL(file)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:border-gray-400 bg-white"
                  >
                    Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => setAvatarUrl('')}
                    className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:border-gray-400 bg-white"
                  >
                    Text avatar
                  </button>
                </div>

                <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
                  {allAvatars.map((opt) => {
                    const selected = avatarUrl === opt.url
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAvatarUrl(opt.url)}
                        title={opt.label}
                        className={`rounded-full p-0.5 border transition-colors bg-white ${
                          selected ? 'border-brand-600 ring-2 ring-brand-300' : 'border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        <img src={opt.url} alt={opt.label} className="w-11 h-11 rounded-full object-cover" />
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {cropSource && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Crop</p>
                <div className="w-44 h-44 rounded-full overflow-hidden border border-gray-200 bg-white mx-auto relative">
                  <img
                    src={cropSource}
                    alt="Crop preview"
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`, transformOrigin: 'center center' }}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="text-xs text-gray-500">Zoom
                    <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-full" />
                  </label>
                  <label className="text-xs text-gray-500">X
                    <input type="range" min={-100} max={100} step={1} value={offsetX} onChange={(e) => setOffsetX(parseInt(e.target.value))} className="w-full" />
                  </label>
                  <label className="text-xs text-gray-500">Y
                    <input type="range" min={-100} max={100} step={1} value={offsetY} onChange={(e) => setOffsetY(parseInt(e.target.value))} className="w-full" />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const compressed = await cropAndCompressAvatar(cropSource)
                        setAvatarUrl(compressed)
                        setCropSource(null)
                      } catch {
                        alert('Could not crop this image. Try another file.')
                      }
                    }}
                    className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-lg"
                  >
                    Apply crop
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropSource(null)}
                    className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 bg-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => update.mutate({ display_name: displayName.trim(), avatar_url: avatarUrl.trim() || null })}
          disabled={!displayName.trim() || update.isPending}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Skills & Tools</p>
          {capabilityLoading ? (
            <Spinner />
          ) : !capabilityLatest ? (
            <p className="text-sm text-gray-400 italic">No capability snapshot yet. Click Refresh.</p>
          ) : (
            <>
              <div className="text-xs text-gray-500 space-y-1">
                <p>Version: <span className="font-mono">{capabilityLatest.version ?? '—'}</span></p>
                <p>Hash: <span className="font-mono break-all">{capabilityLatest.hash}</span></p>
                <p>Refreshed: {new Date(capabilityLatest.refreshed_at).toLocaleString()}</p>
              </div>
              <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">
                {capabilityLatest.tools.length > 0
                  ? `Available: ${capabilityLatest.tools.map((t) => t.name).join(', ')}`
                  : 'No skills/tools discovered yet.'}
              </div>
              <div className="space-y-2">
                {capabilityLatest.tools.map((tool) => (
                  <div key={tool.name} className="border border-gray-200 rounded-lg p-2">
                    <p className="text-sm font-medium text-gray-800">{tool.name}</p>
                    <p className="text-xs text-gray-500">{tool.description}</p>
                  </div>
                ))}
              </div>
              {(capabilityLatest.policy_notes ?? []).length > 0 && (
                <ul className="list-disc pl-5 text-xs text-gray-600 space-y-1">
                  {capabilityLatest.policy_notes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Preflight History</p>
          {runPreflight.data && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-gray-500">Latest preflight detail</p>
                <Badge variant={variantByStatus(runPreflight.data.status)}>{runPreflight.data.status}</Badge>
              </div>
              <ul className="space-y-1">
                {runPreflight.data.tests.map((t) => (
                  <li key={t.test_id} className="text-xs text-gray-700 border border-gray-100 bg-white rounded p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono">{t.test_id}</p>
                      <Badge variant={variantByStatus(t.status)}>{t.status}</Badge>
                    </div>
                        {(() => {
                          const preview = t.response_preview as { items?: string[]; skills?: string[]; tools?: string[] }
                          const items = preview.items ?? preview.skills ?? preview.tools
                          if (!Array.isArray(items)) return null
                          return (
                            <p className="mt-1 text-gray-500">
                              Skills & tools: {items.join(', ') || '—'}
                            </p>
                          )
                        })()}
                        {t.error_message && <p className="mt-1 text-red-500">{t.error_message}</p>}
                      </li>
                ))}
              </ul>
            </div>
          )}
          {preflightLoading ? (
            <Spinner />
          ) : preflightRuns.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No preflight runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {preflightRuns.map((run) => (
                <li key={run.id} className="border border-gray-200 rounded-lg p-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs text-gray-500">
                      <p>Pass rate: {(run.pass_rate * 100).toFixed(0)}%</p>
                      <p>{new Date(run.started_at).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={variantByStatus(run.status)}>{run.status}</Badge>
                      {run.is_baseline ? (
                        <Badge variant="purple">baseline</Badge>
                      ) : (
                        <button
                          onClick={() => promoteBaseline.mutate(run.id)}
                          className="text-xs px-2 py-1 border border-gray-200 rounded-lg bg-white inline-flex items-center gap-1"
                        >
                          <Star size={12} /> Set baseline
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {(capabilitySnapshots ?? []).length > 1 && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">Capability snapshots</p>
              <ul className="space-y-1 text-xs text-gray-500">
                {capabilitySnapshots.slice(0, 5).map((snap) => (
                  <li key={snap.id}>
                    {new Date(snap.refreshed_at).toLocaleString()} · {snap.version ?? '—'} · {snap.changed_from_previous ? 'changed' : 'same'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Usage History</p>
          {(usage.length === 0 && historyLoading) ? (
            <Spinner />
          ) : usage.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No usage yet.</p>
          ) : (
            <ul className="space-y-2">
              {usage.slice(0, 20).map((u, idx) => (
                <li key={`${u.type}-${u.run_id ?? u.workflow_id ?? idx}`} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm text-gray-800">
                      {u.type === 'run' && u.run_id ? (
                        <Link to={`/runs/${u.run_id}`} className="text-brand-700 hover:underline">
                          {u.workflow_name ?? u.run_id.slice(0, 8)}
                        </Link>
                      ) : (
                        u.workflow_name ?? 'Workflow'
                      )}
                    </p>
                    <Badge variant={variantByStatus(u.status ?? 'inactive')}>{u.status ?? u.type}</Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{new Date(u.timestamp).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Debug Links</p>
          {debugLoading ? (
            <Spinner />
          ) : debugLinks.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No provider debug links yet.</p>
          ) : (
            <ul className="space-y-2">
              {debugLinks.slice(0, 20).map((d, idx) => (
                <li key={`${d.run_id}-${d.node_id ?? ''}-${idx}`} className="border border-gray-100 rounded-lg p-2 bg-gray-50 text-xs text-gray-600">
                  <p>
                    <Link to={`/runs/${d.run_id}`} className="text-brand-700 hover:underline">Run {d.run_id.slice(0, 8)}</Link>
                    {d.node_id ? ` · ${d.node_id}` : ''}
                  </p>
                  <p className="font-mono break-all">request:{d.provider_request_id ?? '—'}</p>
                  <p className="font-mono break-all">response:{d.provider_response_id ?? '—'}</p>
                  <p className="font-mono break-all">trace:{d.provider_trace_id ?? '—'}</p>
                  <p>{new Date(d.created_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Legacy run history (node mapping)</p>
        {historyLoading ? (
          <Spinner />
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No run history yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.slice(0, 10).map((h) => (
              <li key={h.run_id} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      <Link to={`/graphs/${h.graph_id}`} className="text-brand-700 hover:underline">{h.graph_name}</Link>
                      {' · '}
                      <Link to={`/runs/${h.run_id}`} className="text-gray-700 hover:underline">{h.run_name ?? h.run_id.slice(0, 8)}</Link>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">Nodes: {h.involved_nodes.join(', ')}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={h.run_status === 'completed' ? 'green' : h.run_status === 'failed' ? 'red' : 'gray'}>{h.run_status}</Badge>
                    <p className="text-[11px] text-gray-400 mt-1">{new Date(h.run_created_at).toLocaleString()}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
