import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Copy, RefreshCw, Trash2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import { BACKEND_BASE_URL } from '@/api/client'
import {
  useDeleteOpenClawIntegration,
  useCreateOpenClawHandshakeToken,
  type OpenClawIntegration,
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
  const registeredRefs = new Set(allAgents.map((a) => a.agent_ref))
  const nonOpenClawAgents = agents.filter((agent) => agent.provider !== 'openclaw')
  const openClawRegisteredAgents = agents.filter((agent) => agent.provider === 'openclaw')

  const loading = isLoading
  const empty = !loading && nonOpenClawAgents.length === 0 && integrations.length === 0

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
              <li>Copy the <strong>setup URL</strong> and share it with your OpenClaw agent.</li>
              <li>Ask the agent: <em>"Install the Knotwork OpenClaw plugin from [setup URL], then apply its config."</em>.</li>
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
                    <Copy size={12} /> Copy setup URL
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
                  <p className="text-gray-500">Setup URL:</p>
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
      </div>

      {loading ? (
        <Card className="p-6"><Spinner /></Card>
      ) : empty ? (
        <Card className="p-6 text-sm text-gray-400 italic">
          No agents found.
        </Card>
      ) : (
        <>
          {integrations.map((integration) => (
            <OpenClawIntegrationSection
              key={integration.id}
              integration={integration}
              registeredAgents={openClawRegisteredAgents.filter((agent) => agent.openclaw_integration_id === integration.id)}
              registeredRefs={registeredRefs}
            />
          ))}

          {nonOpenClawAgents.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Other agents</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {nonOpenClawAgents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function OpenClawIntegrationSection({
  integration,
  registeredAgents,
  registeredRefs,
}: {
  integration: OpenClawIntegration
  registeredAgents: RegisteredAgent[]
  registeredRefs: Set<string>
}) {
  const { data: remoteAgents = [], isLoading } = useOpenClawRemoteAgents(integration.id)
  const registerRemote = useRegisterOpenClawRemoteAgent()
  const deleteIntegration = useDeleteOpenClawIntegration()
  const unregistered = remoteAgents.filter((ra) => !registeredRefs.has(`openclaw:${ra.slug}`))

  const handleDelete = () => {
    const confirmed = window.confirm(
      `Delete all Knotwork agents and OpenClaw integration data for plugin "${integration.plugin_instance_id}"? This archives registered agents for this plugin and removes the current handshake/integration state.`,
    )
    if (!confirmed) return
    deleteIntegration.mutate(integration.id)
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50/70 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Plugin</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-gray-700">{integration.plugin_instance_id}</span>
            <Badge variant="gray">{integration.status}</Badge>
            {integration.plugin_version && <Badge variant="purple">{integration.plugin_version}</Badge>}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteIntegration.isPending}
          className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs inline-flex items-center gap-1 disabled:opacity-50"
        >
          <Trash2 size={12} />
          {deleteIntegration.isPending ? 'Deleting…' : 'Delete all agents'}
        </button>
      </div>

      {isLoading ? (
        <div className="p-4"><Spinner /></div>
      ) : (
        <div>
          {registeredAgents.length > 0 && (
            <>
              <div className="px-4 py-2 border-b bg-white">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Registered in Knotwork</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {registeredAgents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}
              </ul>
            </>
          )}

          {unregistered.length > 0 && (
            <>
              <div className="px-4 py-2 border-y bg-gray-50/60">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Discovered from plugin</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {unregistered.map((ra) => (
                  <UnregisteredRow
                    key={ra.id}
                    ra={ra}
                    onRegister={() => registerRemote.mutate({ integration_id: ra.integration_id, remote_agent_id: ra.remote_agent_id, display_name: ra.display_name })}
                    isPending={registerRemote.isPending}
                  />
                ))}
              </ul>
            </>
          )}

          {registeredAgents.length === 0 && unregistered.length === 0 && (
            <div className="p-4 text-sm text-gray-400 italic">
              No agents are currently attached to this plugin instance.
            </div>
          )}
        </div>
      )}
    </Card>
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
