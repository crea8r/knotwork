import type { RunStatus, NodeStatus } from '@data-models'

type Status = RunStatus | NodeStatus | 'open' | 'resolved' | 'timed_out'

const CONFIG: Record<string, { label: string; className: string }> = {
  queued:    { label: 'Queued',    className: 'bg-gray-100 text-gray-700' },
  running:   { label: 'Running',   className: 'bg-blue-100 text-blue-700' },
  paused:    { label: 'Paused',    className: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700' },
  failed:    { label: 'Failed',    className: 'bg-red-100 text-red-700' },
  stopped:   { label: 'Stopped',   className: 'bg-gray-100 text-gray-500' },
  pending:   { label: 'Pending',   className: 'bg-gray-100 text-gray-600' },
  skipped:   { label: 'Skipped',   className: 'bg-gray-100 text-gray-400' },
  open:      { label: 'Open',      className: 'bg-amber-100 text-amber-700' },
  resolved:  { label: 'Resolved',  className: 'bg-green-100 text-green-700' },
  timed_out: { label: 'Timed out', className: 'bg-red-100 text-red-700' },
}

export default function StatusBadge({ status }: { status: Status }) {
  const cfg = CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}
