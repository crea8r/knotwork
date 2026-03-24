/**
 * Badge + metadata shown in run history rows for draft runs.
 * Shows: "Draft" label, parent version info, snapshot time.
 */
import type { Run } from '@/types'

interface Props {
  run: Run
  /** Optional: parent version name to display (fetched separately if needed). */
  parentVersionName?: string | null
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function DraftRunBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Draft
    </span>
  )
}

export function DraftRunMeta({ run, parentVersionName }: Props) {
  if (!run.draft_snapshot_at) return null
  return (
    <span className="text-xs text-gray-400">
      {parentVersionName ? `based on ${parentVersionName} · ` : ''}
      snapshot {fmtDate(run.draft_snapshot_at)}
    </span>
  )
}
