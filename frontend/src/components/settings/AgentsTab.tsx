import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, MessageSquare, PlayCircle, Power, RefreshCw, ShieldAlert, Trash2, Wrench, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import {
  useActivateAgent,
  useAgentMainChatMessages,
  useEnsureAgentMainChat,
  useArchiveAgent,
  useAskAgentMainChat,
  useCreateAgent,
  useCreateOpenClawHandshakeToken,
  useDeactivateAgent,
  useOpenClawDebugState,
  useOpenClawIntegrations,
  useOpenClawRemoteAgents,
  useRefreshCapabilities,
  useRegisterOpenClawRemoteAgent,
  useRegisteredAgents,
  useRunPreflight,
  type RegisteredAgent,
} from '@/api/agents'

type LegacyProvider = 'openai' | 'anthropic'

const PROVIDER_OPTIONS: Array<{ value: LegacyProvider; label: string; legacy?: boolean }> = [
  { value: 'openai', label: 'OpenAI', legacy: true },
  { value: 'anthropic', label: 'Anthropic', legacy: true },
]

const LEGACY_MODEL_OPTIONS: Record<'openai' | 'anthropic', Array<{ value: string; label: string }>> = {
  openai: [
    { value: 'openai:gpt-4o', label: 'GPT-4o' },
    { value: 'openai:gpt-4o-mini', label: 'GPT-4o mini' },
  ],
  anthropic: [
    { value: 'anthropic:claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'anthropic:claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
}

function statusVariant(status: string): 'green' | 'gray' | 'orange' | 'red' | 'purple' {
  if (status === 'active') return 'green'
  if (status === 'inactive') return 'gray'
  if (status === 'fail') return 'red'
  if (status === 'warning') return 'orange'
  if (status === 'pass') return 'green'
  return 'purple'
}

export default function AgentsTab() {
  const [q, setQ] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [preflightFilter, setPreflightFilter] = useState('')

  const { data: agents = [], isLoading } = useRegisteredAgents({
    q: q || undefined,
    provider: providerFilter || undefined,
    status: statusFilter || undefined,
    preflight_status: preflightFilter || undefined,
  })

  const handshake = useCreateOpenClawHandshakeToken()
  const { data: integrations = [] } = useOpenClawIntegrations()
  const { data: debugState } = useOpenClawDebugState()
  const [selectedIntegration, setSelectedIntegration] = useState('')
  const resolvedIntegration = selectedIntegration || integrations[0]?.id || ''
  const { data: remoteAgents = [], isLoading: remoteLoading } = useOpenClawRemoteAgents(resolvedIntegration)
  const registerRemote = useRegisterOpenClawRemoteAgent()

  const createAgent = useCreateAgent()

  const [provider, setProvider] = useState<LegacyProvider>('openai')
  const [displayName, setDisplayName] = useState('')
  const [agentRef, setAgentRef] = useState(LEGACY_MODEL_OPTIONS.openai[0].value)
  const [apiKey, setApiKey] = useState('')
  const [mainChatAgent, setMainChatAgent] = useState<RegisteredAgent | null>(null)

  const runCreateLegacy = () => {
    if (!displayName.trim()) return
    createAgent.mutate(
      {
        display_name: displayName.trim(),
        provider,
        agent_ref: agentRef,
        credentials: apiKey.trim() ? { type: 'api_key', api_key: apiKey.trim() } : { type: 'none' },
      },
      {
        onSuccess: () => {
          setDisplayName('')
          setApiKey('')
        },
      },
    )
  }

  const token = handshake.data?.token ?? ''

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">OpenClaw plugin connection</p>
        <p className="text-sm text-gray-600">
          Plugin-first flow: install Knotwork plugin in OpenClaw, then use a one-time handshake token.
        </p>
        <ol className="text-xs text-gray-500 list-decimal pl-5 space-y-1">
          <li>Click <span className="font-medium">Generate handshake token</span>.</li>
          <li>Paste token into OpenClaw Knotwork plugin setup.</li>
          <li>Plugin calls handshake and syncs available OpenClaw agents.</li>
          <li>Select synced agent below and register it to Knotwork.</li>
        </ol>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handshake.mutate({})}
            className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm"
          >
            {handshake.isPending ? 'Generating…' : 'Generate handshake token'}
          </button>
          {token && (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(token)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs inline-flex items-center gap-1"
            >
              <Copy size={12} /> Copy token
            </button>
          )}
        </div>
        {token && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] text-gray-500">Handshake token (expires {new Date(handshake.data!.expires_at).toLocaleString()}):</p>
            <p className="text-xs font-mono break-all text-gray-700 mt-1">{token}</p>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">OpenClaw bridge debug</p>
        {!debugState || debugState.integrations.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No integration heartbeat yet.</p>
        ) : (
          <div className="space-y-3">
            {debugState.integrations.map((it) => {
              const lastSeen = new Date(it.last_seen_at).getTime()
              const ageSec = Math.max(0, Math.floor((Date.now() - lastSeen) / 1000))
              return (
                <div key={it.integration_id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={ageSec < 20 ? 'green' : ageSec < 120 ? 'orange' : 'red'}>
                      heartbeat {ageSec}s ago
                    </Badge>
                    <span className="text-xs text-gray-600 font-mono">{it.plugin_instance_id}</span>
                  </div>
                  <div className="mt-2 text-xs text-gray-600 grid grid-cols-2 md:grid-cols-6 gap-2">
                    <span>pending: <strong>{it.pending_count}</strong></span>
                    <span>claimed: <strong>{it.claimed_count}</strong></span>
                    <span>completed: <strong>{it.completed_count}</strong></span>
                    <span>failed: <strong>{it.failed_count}</strong></span>
                    <span>escalated: <strong>{it.escalated_count}</strong></span>
                    <span>status: <strong>{it.status}</strong></span>
                  </div>
                </div>
              )
            })}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-500">Recent tasks</div>
              <div className="max-h-52 overflow-auto">
                {debugState.recent_tasks.length === 0 ? (
                  <p className="p-3 text-xs text-gray-400 italic">No tasks yet.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-white sticky top-0">
                      <tr className="text-left text-gray-500">
                        <th className="px-3 py-2">Task</th>
                        <th className="px-3 py-2">Node</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Events</th>
                        <th className="px-3 py-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debugState.recent_tasks.map((t) => (
                        <tr key={t.task_id} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-mono text-gray-700">{t.task_id.slice(0, 8)}</td>
                          <td className="px-3 py-2 text-gray-600">{t.node_id}</td>
                          <td className="px-3 py-2 text-gray-700">{t.status}</td>
                          <td className="px-3 py-2 text-gray-600">{t.event_count}</td>
                          <td className="px-3 py-2 text-gray-500">{new Date(t.created_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">OpenClaw discovered agents</p>
          <div className="flex items-center gap-2">
            <select
              value={resolvedIntegration}
              onChange={(e) => setSelectedIntegration(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
            >
              {integrations.length === 0 ? <option value="">No integration</option> : null}
              {integrations.map((i) => (
                <option key={i.id} value={i.id}>{i.plugin_instance_id}</option>
              ))}
            </select>
          </div>
        </div>
        {integrations.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No plugin handshake yet.</p>
        ) : remoteLoading ? (
          <Spinner />
        ) : remoteAgents.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No synced agents from this integration yet.</p>
        ) : (
          <ul className="space-y-2">
            {remoteAgents.map((ra) => (
              <li key={ra.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-gray-800">{ra.display_name}</p>
                  <p className="text-xs text-gray-500 font-mono">openclaw:{ra.slug}</p>
                  <p className="text-xs text-gray-500">Tools: {ra.tools.length}</p>
                </div>
                <button
                  onClick={() => registerRemote.mutate({
                    integration_id: ra.integration_id,
                    remote_agent_id: ra.remote_agent_id,
                    display_name: ra.display_name,
                  })}
                  disabled={registerRemote.isPending}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs"
                >
                  Register to Knotwork
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Agent Directory</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agent" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All providers</option>
            <option value="openclaw">OpenClaw</option>
            <option value="openai">OpenAI (legacy)</option>
            <option value="anthropic">Anthropic (legacy)</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All status</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
          <select value={preflightFilter} onChange={(e) => setPreflightFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All preflight</option>
            <option value="never_run">never_run</option>
            <option value="pass">pass</option>
            <option value="warning">warning</option>
            <option value="fail">fail</option>
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Registered agents</p>
        </div>
        {isLoading ? (
          <div className="p-6"><Spinner /></div>
        ) : agents.length === 0 ? (
          <div className="p-6 text-sm text-gray-400 italic">No agents found.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                onOpenMainChat={() => setMainChatAgent(agent)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Legacy provider registration</p>
        <p className="text-xs text-gray-500">
          <span className="font-semibold">LEGACY / TRANSITIONAL:</span> use only if OpenClaw plugin integration is unavailable.
        </p>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Provider</label>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setProvider(opt.value)
                  setAgentRef(LEGACY_MODEL_OPTIONS[opt.value][0].value)
                }}
                className={`px-3 py-1.5 rounded border text-sm ${
                  provider === opt.value
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Display name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Model</span>
            <select value={agentRef} onChange={(e) => setAgentRef(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {LEGACY_MODEL_OPTIONS[provider].map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Credential (optional)</span>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="API key" />
        </label>

        <div className="flex items-center gap-2">
          <button type="button" onClick={runCreateLegacy} disabled={createAgent.isPending || !displayName.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">
            {createAgent.isPending ? 'Registering…' : 'Register legacy agent'}
          </button>
          {createAgent.isError ? <p className="text-xs text-red-500">Could not register agent.</p> : null}
        </div>
      </Card>

      {mainChatAgent ? (
        <MainChatPanel agent={mainChatAgent} onClose={() => setMainChatAgent(null)} />
      ) : null}
    </div>
  )
}

function AgentRow({
  agent,
  onOpenMainChat,
}: {
  agent: RegisteredAgent
  onOpenMainChat: () => void
}) {
  const refresh = useRefreshCapabilities(agent.id)
  const preflight = useRunPreflight(agent.id)
  const activate = useActivateAgent(agent.id)
  const deactivate = useDeactivateAgent(agent.id)
  const archive = useArchiveAgent(agent.id)

  const mutating = refresh.isPending || preflight.isPending || activate.isPending || deactivate.isPending || archive.isPending

  return (
    <li className="px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex items-center gap-2">
          {agent.avatar_url ? (
            <img src={agent.avatar_url} alt={agent.display_name} className="w-8 h-8 rounded-full object-cover border border-gray-200" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center">
              {agent.display_name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <Link to={`/agents/${agent.id}`} className="text-sm font-medium text-brand-700 hover:underline truncate">
            {agent.display_name}
          </Link>
          <Badge variant={agent.provider === 'openclaw' ? 'purple' : 'gray'}>{agent.provider}</Badge>
          {agent.provider !== 'openclaw' ? <Badge variant="orange">legacy</Badge> : null}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
          <Badge variant={statusVariant(agent.preflight_status)}>{agent.preflight_status}</Badge>
        </div>
      </div>

      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
        <span>Ref: <span className="font-mono">{agent.agent_ref}</span></span>
        <span>Capability: {agent.capability_version ?? '—'}</span>
        <span>Refreshed: {agent.capability_refreshed_at ? new Date(agent.capability_refreshed_at).toLocaleString() : 'never'}</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => refresh.mutate({ save_snapshot: true })} disabled={mutating} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white">
          <RefreshCw size={13} /> Refresh
        </button>
        <button onClick={() => preflight.mutate({ suite: 'default', include_optional: false })} disabled={mutating} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white">
          <PlayCircle size={13} /> Preflight
        </button>

        {agent.status === 'active' ? (
          <button onClick={() => deactivate.mutate({ reason: 'manual' })} disabled={mutating} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white">
            <Power size={13} /> Deactivate
          </button>
        ) : (
          <button onClick={() => activate.mutate({ allow_warning: false })} disabled={mutating} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white">
            <Wrench size={13} /> Activate
          </button>
        )}

        <button
          onClick={() => {
            if (agent.provider !== 'openclaw') return
            onOpenMainChat()
          }}
          disabled={mutating || agent.provider !== 'openclaw'}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white disabled:opacity-50"
          title={agent.provider !== 'openclaw' ? 'Main chat is OpenClaw-only for now' : 'Open main chat'}
        >
          <MessageSquare size={13} /> Main chat
        </button>

        <button onClick={() => archive.mutate({ reason: 'manual' })} disabled={mutating} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-red-200 rounded-lg text-xs text-red-600 bg-white">
          <Trash2 size={13} /> Archive
        </button>
      </div>

      {(activate.isError || preflight.isError || refresh.isError) && (
        <p className="text-xs text-red-500 inline-flex items-center gap-1">
          <ShieldAlert size={12} /> Action failed. Check preflight/capability state.
        </p>
      )}
    </li>
  )
}

function MainChatPanel({ agent, onClose }: { agent: RegisteredAgent; onClose: () => void }) {
  const ensureMainChat = useEnsureAgentMainChat(agent.id)
  const { data: messages = [], isLoading } = useAgentMainChatMessages(agent.id)
  const ask = useAskAgentMainChat(agent.id)
  const [text, setText] = useState('')
  const [initState, setInitState] = useState<'initializing' | 'ready' | 'timeout' | 'error'>('initializing')
  const [initMessage, setInitMessage] = useState('Initializing main chat…')

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      const deadline = Date.now() + 125_000
      while (!cancelled && Date.now() < deadline) {
        try {
          const ensured = await ensureMainChat.mutateAsync()
          if (ensured.ready) {
            if (!cancelled) {
              setInitState('ready')
              setInitMessage('')
            }
            return
          }
          if (ensured.status === 'timeout') {
            if (!cancelled) {
              setInitState('timeout')
              setInitMessage(ensured.message || 'Main chat initialization timed out.')
            }
            return
          }
          if (!cancelled) {
            setInitState('initializing')
            setInitMessage(ensured.message || 'Initializing main chat…')
          }
        } catch (err: any) {
          if (!cancelled) {
            setInitState('error')
            setInitMessage(err?.response?.data?.detail ?? err?.message ?? 'Main chat initialization failed.')
          }
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      if (!cancelled) {
        setInitState('timeout')
        setInitMessage('Main chat initialization timed out. Please retry.')
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [agent.id])

  async function send() {
    const message = text.trim()
    if (!message || ask.isPending || initState !== 'ready') return
    setText('')
    try {
      await ask.mutateAsync({ message })
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Main chat failed'
      alert(detail)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl h-[80vh] rounded-xl shadow-xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Main Chat</p>
            <p className="text-xs text-gray-500 font-mono">
              knotwork:{agent.id}:{agent.workspace_id}:main
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3 bg-gray-50">
          {isLoading ? (
            <Spinner />
          ) : initState !== 'ready' ? (
            <div className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600">
              {initMessage}
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No main chat messages yet.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.author_type === 'human' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.author_type === 'human' ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
                }`}>
                  <p className="text-[11px] opacity-70 mb-1">
                    {m.author_name || (m.author_type === 'agent' ? agent.display_name : m.author_type)}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ))
          )}
          {ask.isPending ? (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500">
                {agent.display_name} is thinking...
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t p-3 flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message the agent..."
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none min-h-[88px] outline-none focus:ring-2 focus:ring-brand-500"
            disabled={ask.isPending || initState !== 'ready'}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            onClick={() => void send()}
            disabled={ask.isPending || !text.trim() || initState !== 'ready'}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
