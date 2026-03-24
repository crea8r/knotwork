/**
 * SystemTab — shows version alignment across backend, schema, worker, and plugins.
 * Operators use this to confirm all components are in sync after an update.
 */
import { CheckCircle, XCircle, HelpCircle, RefreshCw } from 'lucide-react'
import { useHealthStatus } from '@/api/health'
import { useOpenClawIntegrations } from '@/api/agents'

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CheckCircle size={14} className="text-green-500 shrink-0" />
  if (ok === false) return <XCircle size={14} className="text-red-500 shrink-0" />
  return <HelpCircle size={14} className="text-gray-400 shrink-0" />
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {ok !== undefined && <StatusIcon ok={ok} />}
        <span className="text-sm font-mono text-gray-800">{value}</span>
      </div>
    </div>
  )
}

function meetsMinVersion(version: string, min: string): boolean {
  const parse = (v: string) => v.split('.').map(Number)
  const [ma, mi, pa] = parse(version)
  const [mb, mib, pb] = parse(min)
  if (ma !== mb) return ma > mb
  if (mi !== mib) return mi > mib
  return pa >= pb
}

export default function SystemTab() {
  const { data: health, isLoading, refetch } = useHealthStatus()
  const { data: integrations } = useOpenClawIntegrations()

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading system status…</p>
  }

  if (!health) {
    return <p className="text-sm text-red-600">Backend unreachable — could not load system status.</p>
  }

  const workerAlive = health.worker?.alive
  const workerAgo = health.worker?.last_seen_seconds_ago
  const workerLabel = workerAlive
    ? `Running (heartbeat ${workerAgo ?? '?'}s ago)`
    : workerAlive === null
    ? 'Unknown (Redis unreachable)'
    : workerAgo != null
    ? `Not running (last seen ${workerAgo}s ago)`
    : 'Not running'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">System Status</h3>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white px-4 divide-y divide-gray-100">
        <Row label="API version" value={health.version} />
        <Row label="Schema version" value={health.schema_version} />
        <Row label="Installation ID" value={health.installation_id?.slice(0, 8) + '…'} />
        <Row
          label="Background worker"
          value={workerLabel}
          ok={workerAlive === null ? null : workerAlive}
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Plugin Compatibility</h3>
        <div className="rounded-lg border border-gray-200 bg-white px-4 divide-y divide-gray-100">
          <Row label="Required OpenClaw version" value={`≥ ${health.min_openclaw_version}`} />
          {integrations?.length ? (
            integrations.map((i) => {
              const ver = i.plugin_version ?? 'unknown'
              const ok = i.plugin_version
                ? meetsMinVersion(i.plugin_version, health.min_openclaw_version)
                : null
              return (
                <Row
                  key={i.id}
                  label={`Plugin ${i.plugin_instance_id.slice(0, 12)}…`}
                  value={ver}
                  ok={ok}
                />
              )
            })
          ) : (
            <div className="py-2">
              <p className="text-sm text-gray-400">No OpenClaw integrations connected.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
