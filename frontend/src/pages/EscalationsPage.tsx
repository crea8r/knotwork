import { Link } from 'react-router-dom'
import { useEscalations } from '@/api/escalations'
import { useAuthStore } from '@/store/auth'
import type { Escalation } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const TYPE_LABEL: Record<string, string> = {
  human_checkpoint: 'Human Checkpoint',
  confidence: 'Low Confidence',
  checkpoint_failed: 'Checkpoint Failed',
}

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  timed_out: 'bg-red-100 text-red-700',
}

function EscalationRow({ esc, workspaceId }: { esc: Escalation; workspaceId: string }) {
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="py-2 px-4">
        <Link
          to={`/escalations/${esc.id}`}
          className="font-mono text-xs text-blue-600 hover:underline"
        >
          {esc.id.slice(0, 8)}…
        </Link>
      </td>
      <td className="py-2 px-4 text-sm">{TYPE_LABEL[esc.type] ?? esc.type}</td>
      <td className="py-2 px-4">
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[esc.status] ?? ''}`}>
          {esc.status}
        </span>
      </td>
      <td className="py-2 px-4 font-mono text-xs text-gray-400">
        {esc.run_id.slice(0, 8)}…
      </td>
      <td className="py-2 px-4 text-xs text-gray-400">
        {new Date(esc.created_at).toLocaleString()}
      </td>
      <td className="py-2 px-4">
        {esc.status === 'open' && (
          <Link
            to={`/escalations/${esc.id}`}
            className="text-xs bg-amber-500 text-white px-2 py-1 rounded hover:bg-amber-600"
          >
            Review
          </Link>
        )}
      </td>
    </tr>
  )
}

export default function EscalationsPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const [filter, setFilter] = useState<string>('open')
  const { data: escalations = [], isLoading } = useEscalations(workspaceId, filter || undefined)

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
        <h1 className="text-lg font-semibold">Escalations</h1>
        <div className="flex gap-2 ml-auto">
          {['open', 'resolved', ''].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1 rounded-full border ${
                filter === s
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {s || 'all'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <p className="text-center text-gray-400 mt-16 text-sm">Loading…</p>
        ) : escalations.length === 0 ? (
          <p className="text-center text-gray-400 mt-16 text-sm">No escalations found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 text-left bg-gray-50">
                <th className="py-2 px-4">ID</th>
                <th className="py-2 px-4">Type</th>
                <th className="py-2 px-4">Status</th>
                <th className="py-2 px-4">Run</th>
                <th className="py-2 px-4">Created</th>
                <th className="py-2 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {escalations.map((esc) => (
                <EscalationRow key={esc.id} esc={esc} workspaceId={workspaceId} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// useState import at top
import { useState } from 'react'
