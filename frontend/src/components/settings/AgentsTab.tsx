import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Copy, Trash2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import { BACKEND_BASE_URL } from '@/api/client'
import {
  useDeleteOpenClawIntegration,
  useCreateOpenClawHandshakeToken,
  useOpenClawDebugState,
  type OpenClawIntegration,
  type OpenClawIntegrationDebugState,
  type OpenClawTaskDebugItem,
  useOpenClawIntegrations,
  useOpenClawRemoteAgents,
  useRegisterOpenClawRemoteAgent,
  useRegisteredAgents,
  type OpenClawRemoteAgent,
  type RegisteredAgent,
} from '@/api/agents'

// ── Connection status helpers ─────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

function taskDuration(claimedAt: string): string {
  const secs = Math.floor((Date.now() - new Date(claimedAt).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

type ConnStatus = 'active' | 'recent' | 'stale'

function connStatus(lastSeenAt: string): ConnStatus {
  const diffMs = Date.now() - new Date(lastSeenAt).getTime()
  if (diffMs < 30_000) return 'active'
  if (diffMs < 120_000) return 'recent'
  return 'stale'
}

const CONN_DOT: Record<ConnStatus, string> = {
  active: 'bg-green-400',
  recent: 'bg-amber-400',
  stale: 'bg-gray-300',
}

const CONN_LABEL: Record<ConnStatus, string> = {
  active: 'connected',
  recent: 'idle',
  stale: 'offline',
}

// ── Last task activity summary ────────────────────────────────────────────────

type TaskSummary = {
  running: OpenClawTaskDebugItem[]   // status === 'claimed'
  failed: OpenClawTaskDebugItem[]    // status === 'failed', most recent first
  lastCompleted: OpenClawTaskDebugItem | null
}

function summariseTasks(tasks: OpenClawTaskDebugItem[]): TaskSummary {
  const byRecency = (a: OpenClawTaskDebugItem, b: OpenClawTaskDebugItem) => {
    const ta = a.latest_event_at ?? a.claimed_at ?? ''
    const tb = b.latest_event_at ?? b.claimed_at ?? ''
    return tb.localeCompare(ta)
  }
  return {
    running: tasks.filter((t) => t.status === 'claimed'),
    failed:  tasks.filter((t) => t.status === 'failed').sort(byRecency),
    lastCompleted: tasks.filter((t) => t.status === 'completed').sort(byRecency)[0] ?? null,
  }
}

function isStalled(task: OpenClawTaskDebugItem): boolean {
  return !!task.latest_event_at &&
    Date.now() - new Date(task.latest_event_at).getTime() > 5 * 60 * 1000
}

export default function AgentsTab() {
  const [q, setQ] = useState('')
  const [pluginOpen, setPluginOpen] = useState(false)

  const { data: agents = [], isLoading } = useRegisteredAgents({ q: q || undefined })
  // Unfiltered list used only to compute which remote agents are already registered.
  // Must not use the search-filtered list — otherwise agents outside the current
  // search would re-appear as "unregistered" in the remote agent section.
  const { data: allAgents = [] } = useRegisteredAgents({})

  const handshake = useCreateOpenClawHandshakeToken()
  const token = handshake.data?.token ?? ''

  const { data: integrations = [] } = useOpenClawIntegrations()
  // Debug state auto-refetches every 5s — source of truth for connection status + tasks.
  const { data: debugState } = useOpenClawDebugState()

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

      {/* Search */}
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents…"
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
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
              integrationDebug={debugState?.integrations.find((i) => i.integration_id === integration.id)}
              allRecentTasks={(debugState?.recent_tasks ?? []).filter((t) => t.integration_id === integration.id)}
            />
          ))}

          {nonOpenClawAgents.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Other agents</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {nonOpenClawAgents.map((agent) => <AgentRow key={agent.id} agent={agent} recentTasks={[]} />)}
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
  integrationDebug,
  allRecentTasks,
}: {
  integration: OpenClawIntegration
  registeredAgents: RegisteredAgent[]
  registeredRefs: Set<string>
  integrationDebug?: OpenClawIntegrationDebugState
  allRecentTasks: OpenClawTaskDebugItem[]
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

  // Connection status derived from debug state (refreshed every 5s).
  const lastSeenAt = integrationDebug?.last_seen_at ?? integration.last_seen_at
  const cs = connStatus(lastSeenAt)

  // Tasks currently running — shown at integration level when no agents are registered yet.
  const runningTasks = allRecentTasks.filter((t) => t.status === 'claimed')

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50/70 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Plugin</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-gray-700">{integration.plugin_instance_id}</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${CONN_DOT[cs]}`} />
              <span className="text-xs text-gray-500">{CONN_LABEL[cs]} · {relativeTime(lastSeenAt)}</span>
            </span>
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

      {/* Running tasks panel — shown when tasks are active but no agents registered yet,
          so the user knows something is happening before they've completed setup. */}
      {runningTasks.length > 0 && registeredAgents.length === 0 && (
        <div className="px-4 py-3 border-b bg-blue-50/50">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 mb-2">
            {runningTasks.length} task{runningTasks.length > 1 ? 's' : ''} running
          </p>
          <ul className="space-y-1.5">
            {runningTasks.map((task) => {
              const stalled = task.latest_event_at
                ? (Date.now() - new Date(task.latest_event_at).getTime()) > 5 * 60 * 1000
                : false
              return (
                <li key={task.task_id} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${stalled ? 'bg-amber-400' : 'bg-blue-400'}`} />
                  <span className="font-mono text-gray-700">{task.node_id}</span>
                  {task.run_id && <span className="text-gray-400">run:{task.run_id.slice(0, 8)}</span>}
                  {task.claimed_at && <span className="text-gray-400">{taskDuration(task.claimed_at)}</span>}
                  {task.latest_event_at && (
                    <span className={stalled ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                      · {relativeTime(task.latest_event_at)}{stalled ? ' ⚠' : ''}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

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
                {registeredAgents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} recentTasks={allRecentTasks} />
                ))}
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

// recentTasks: all tasks for this integration (all statuses), used to derive last activity.
// Empty for non-OpenClaw agents.
function AgentRow({ agent, recentTasks }: { agent: RegisteredAgent; recentTasks: OpenClawTaskDebugItem[] }) {
  const summary = summariseTasks(recentTasks)
  // Failures are only relevant when more recent than the last success.
  const mostRecentFailure = summary.failed[0]?.latest_event_at ?? summary.failed[0]?.claimed_at ?? ''
  const lastSuccess = summary.lastCompleted?.latest_event_at ?? summary.lastCompleted?.claimed_at ?? ''
  const hasRelevantFailures = summary.failed.length > 0 && mostRecentFailure > lastSuccess

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
          <Link to={`/agents/${agent.id}`} className="text-sm font-medium text-brand-700 hover:underline truncate block">
            {agent.display_name}
          </Link>
          <p className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">{agent.agent_ref}</p>
        </div>
      </div>

      {/* Last task activity — counts when multiple; detail when single */}
      <div className="text-right flex-shrink-0 space-y-0.5">
        {/* Running */}
        {summary.running.length > 0 && (
          <div className="flex items-center justify-end gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
            {summary.running.length === 1 ? (
              <span className="text-xs font-medium text-blue-700">
                Running
                {summary.running[0].claimed_at && ` · ${taskDuration(summary.running[0].claimed_at)}`}
                {isStalled(summary.running[0]) && (
                  <span className="text-amber-600"> · {relativeTime(summary.running[0].latest_event_at!)} ⚠</span>
                )}
              </span>
            ) : (
              <span className="text-xs font-medium text-blue-700">
                {summary.running.length} running
                {summary.running.some(isStalled) && <span className="text-amber-600"> ({summary.running.filter(isStalled).length} stalled)</span>}
              </span>
            )}
          </div>
        )}

        {/* Failed — only shown when more recent than the last success */}
        {hasRelevantFailures && (
          <div className="flex items-center justify-end gap-1.5">
            {summary.failed.length === 1 ? (
              <span className="text-xs text-red-600 font-medium">
                ✗ Failed · {relativeTime(summary.failed[0].latest_event_at ?? summary.failed[0].claimed_at ?? '')}
              </span>
            ) : (
              <span className="text-xs text-red-600 font-medium">✗ {summary.failed.length} failed</span>
            )}
          </div>
        )}

        {/* Completed — only shown when nothing running or relevant failures */}
        {summary.running.length === 0 && !hasRelevantFailures && summary.lastCompleted && (
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-xs text-green-700">
              ✓ Completed · {relativeTime(summary.lastCompleted.latest_event_at ?? summary.lastCompleted.claimed_at ?? '')}
            </span>
          </div>
        )}

        {/* Empty */}
        {summary.running.length === 0 && !hasRelevantFailures && !summary.lastCompleted && (
          <span className="text-[11px] text-gray-300">No runs yet</span>
        )}
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
