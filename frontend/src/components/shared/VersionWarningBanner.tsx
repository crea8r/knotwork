/**
 * VersionWarningBanner — shown at the top of AppLayout when:
 *   1. The arq background worker is not running (worker.alive === false)
 *   2. An OpenClaw plugin's reported version is below min_openclaw_version
 *
 * Renders nothing if there are no warnings or the health endpoint is unreachable.
 */
import { AlertTriangle } from 'lucide-react'
import { useHealthStatus } from '@/api/health'
import { useOpenClawIntegrations } from '@/api/agents'

function meetsMinVersion(version: string, min: string): boolean {
  const parse = (v: string) => v.split('.').map(Number)
  const [ma, mi, pa] = parse(version)
  const [mb, mib, pb] = parse(min)
  if (ma !== mb) return ma > mb
  if (mi !== mib) return mi > mib
  return pa >= pb
}

export default function VersionWarningBanner() {
  const { data: health } = useHealthStatus()
  const { data: integrations } = useOpenClawIntegrations()

  if (!health) return null

  const warnings: string[] = []

  if (health.worker?.alive === false) {
    const ago = health.worker.last_seen_seconds_ago
    const detail = ago != null ? ` (last seen ${ago}s ago)` : ''
    warnings.push(`Background worker is not running${detail} — run execution and scheduled tasks are paused.`)
  }

  if (health.min_openclaw_version && integrations?.length) {
    const outdated = integrations.filter(
      (i) => i.plugin_version && !meetsMinVersion(i.plugin_version, health.min_openclaw_version),
    )
    if (outdated.length > 0) {
      const installed = outdated[0].plugin_version ?? 'unknown'
      warnings.push(
        `OpenClaw plugin needs update — installed: ${installed}, required: ≥${health.min_openclaw_version}. Go to Settings → Agents to update.`,
      )
    }
  }

  if (warnings.length === 0) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-2 text-sm text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          {w}
        </p>
      ))}
    </div>
  )
}
