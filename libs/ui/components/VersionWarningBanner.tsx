/**
 * VersionWarningBanner — shown at the top of AppLayout when the arq background
 * worker is not running. Renders nothing if there are no warnings or the health
 * endpoint is unreachable.
 */
import { AlertTriangle } from 'lucide-react'
import { useHealthStatus } from "@core-api/health"

export default function VersionWarningBanner() {
  const { data: health } = useHealthStatus()

  if (!health) return null

  const warnings: string[] = []

  if (health.worker?.alive === false) {
    const ago = health.worker.last_seen_seconds_ago
    const detail = ago != null ? ` (last seen ${ago}s ago)` : ''
    warnings.push(`Background worker is not running${detail} — run execution and scheduled tasks are paused.`)
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
