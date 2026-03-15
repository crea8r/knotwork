import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Copy, RefreshCw } from 'lucide-react'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import { BACKEND_BASE_URL } from '@/api/client'
import {
  useCreateOpenClawHandshakeToken,
  useOpenClawIntegrations,
  useOpenClawRemoteAgents,
  useRefreshCapabilities,
  useRegisterOpenClawRemoteAgent,
  useRegisteredAgents,
  type OpenClawRemoteAgent,
  type RegisteredAgent,
} from '@/api/agents'

function statusVariant(s: string): 'green' | 'gray' | 'orange' | 'red' | 'purple' {
  if (s === 'active') return 'green'
  if (s === 'inactive') return 'gray'
  if (s === 'fail') return 'red'
  if (s === 'warning') return 'orange'
  return 'purple'
}

function freshnessVariant(f: string): 'green' | 'orange' | 'gray' {
  if (f === 'fresh') return 'green'
  if (f === 'stale') return 'orange'
  return 'gray'
}

export default function AgentsTab() {
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [pluginOpen, setPluginOpen] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState('')

  const { data: agents = [], isLoading } = useRegisteredAgents({
    q: q || undefined,
    status: statusFilter || undefined,
  })
  // Unfiltered list used only to compute which remote agents are already registered.
  // Must not use the search-filtered list — otherwise agents outside the current
  // search would re-appear as "unregistered" in the remote agent section.
  const { data: allAgents = [] } = useRegisteredAgents({})

  const handshake = useCreateOpenClawHandshakeToken()
  const token = handshake.data?.token ?? ''

  const { data: integrations = [] } = useOpenClawIntegrations()
  const resolvedIntegration = selectedIntegration || integrations[0]?.id || ''
  const { data: remoteAgents = [], isLoading: remoteLoading } = useOpenClawRemoteAgents(resolvedIntegration)
  const registerRemote = useRegisterOpenClawRemoteAgent()

  // Unregistered = remote agents with no matching registered agent_ref (checked against ALL agents)
  const registeredRefs = new Set(allAgents.map((a) => a.agent_ref))
  const unregistered = remoteAgents.filter((ra) => !registeredRefs.has(`openclaw:${ra.slug}`))

  const loading = isLoading || remoteLoading
  const empty = !loading && agents.length === 0 && unregistered.length === 0

  return (
    <div className="space-y-6">
      {/* OpenClaw plugin connection — collapsible */}
      <Card className="overflow-hidden">
        <button type="button" onClick={() => setPluginOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">OpenClaw plugin connection</span>
          {pluginOpen ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        </button>
        {pluginOpen && (
          <div className="px-5 pb-5 space-y-3 border-t">
            <p className="text-sm text-gray-600 pt-3">
              Install the Knotwork plugin in OpenClaw using a one-time handshake token.
            </p>
            <ol className="text-xs text-gray-500 list-decimal pl-5 space-y-1">
              <li>Click <strong>Generate handshake token</strong>.</li>
              <li>Copy the <strong>install URL</strong> and share it with your OpenClaw agent.</li>
              <li>Ask the agent: <em>"Install knotwork from [install URL]"</em> — the plugin handshakes automatically.</li>
              <li>Synced agents appear below — click <strong>Register</strong> to add them.</li>
            </ol>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => handshake.mutate({})}
                className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm">
                {handshake.isPending ? 'Generating…' : 'Generate handshake token'}
              </button>
              {token && (
                <>
                  <button type="button" onClick={() => navigator.clipboard.writeText(token)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs inline-flex items-center gap-1">
                    <Copy size={12} /> Copy token
                  </button>
                  <button type="button" onClick={() => navigator.clipboard.writeText(`${BACKEND_BASE_URL}/openclaw-plugin/install?token=${token}`)}
                    className="px-2.5 py-1.5 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 text-xs inline-flex items-center gap-1">
                    <Copy size={12} /> Copy install URL
                  </button>
                </>
              )}
            </div>
            {token && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 text-xs">
                <div>
                  <p className="text-gray-500">Token (expires {new Date(handshake.data!.expires_at).toLocaleString()}):</p>
                  <p className="font-mono break-all text-gray-700 mt-1">{token}</p>
                </div>
                <div>
                  <p className="text-gray-500">Install URL:</p>
                  <p className="font-mono break-all text-brand-700 mt-1">{BACKEND_BASE_URL}/openclaw-plugin/install?token={token}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents…"
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All agents</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {integrations.length > 1 && (
          <select value={resolvedIntegration} onChange={(e) => setSelectedIntegration(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            {integrations.map((i) => <option key={i.id} value={i.id}>{i.plugin_instance_id}</option>)}
          </select>
        )}
      </div>

      {/* Unified agent list */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Agents</p>
        </div>
        {loading ? (
          <div className="p-6"><Spinner /></div>
        ) : empty ? (
          <div className="p-6 text-sm text-gray-400 italic">
            {integrations.length === 0
              ? 'No plugin connected yet. Use the handshake flow above to connect OpenClaw.'
              : 'No agents found.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}
            {unregistered.map((ra) => (
              <UnregisteredRow key={ra.id} ra={ra}
                onRegister={() => registerRemote.mutate({ integration_id: ra.integration_id, remote_agent_id: ra.remote_agent_id, display_name: ra.display_name })}
                isPending={registerRemote.isPending} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function AgentRow({ agent }: { agent: RegisteredAgent }) {
  const refresh = useRefreshCapabilities(agent.id)
  const synced = agent.capability_refreshed_at
    ? new Date(agent.capability_refreshed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <li className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0">
        {agent.avatar_url ? (
          <img src={agent.avatar_url} alt={agent.display_name} className="w-8 h-8 rounded-full object-cover border border-gray-200 flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {agent.display_name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/agents/${agent.id}`} className="text-sm font-medium text-brand-700 hover:underline truncate">
              {agent.display_name}
            </Link>
            <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">{agent.agent_ref}</p>
        </div>
      </div>

      {/* Skills & Tools sync */}
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="text-xs font-medium text-gray-600">Skills &amp; Tools</p>
          <div className="flex items-center gap-1.5 justify-end mt-0.5">
            <Badge variant={freshnessVariant(agent.capability_freshness)}>{agent.capability_freshness}</Badge>
            <span className="text-[11px] text-gray-400">{synced ? `synced ${synced}` : 'not synced'}</span>
          </div>
        </div>
        <button onClick={() => refresh.mutate({ save_snapshot: true })} disabled={refresh.isPending}
          title="Sync skills & tools now"
          className="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:text-brand-600 disabled:opacity-40">
          <RefreshCw size={12} className={refresh.isPending ? 'animate-spin' : ''} />
        </button>
      </div>
    </li>
  )
}

function UnregisteredRow({ ra, onRegister, isPending }: { ra: OpenClawRemoteAgent; onRegister: () => void; isPending: boolean }) {
  return (
    <li className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap bg-gray-50 border-l-2 border-l-dashed border-l-gray-300">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 text-xs font-semibold flex items-center justify-center flex-shrink-0">
          {ra.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700 truncate">{ra.display_name}</p>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">openclaw:{ra.slug} · {ra.tools.length} tools</p>
          {ra.description && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{ra.description}</p>}
        </div>
      </div>
      <button onClick={onRegister} disabled={isPending}
        className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs disabled:opacity-50">
        Register to Knotwork
      </button>
    </li>
  )
}
