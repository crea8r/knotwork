import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useEscalations } from '@modules/communication/frontend/api/escalations'
import { useAuthStore } from '@auth'
import PageHeader from '@ui/components/PageHeader'
import Card from '@ui/components/Card'
import StatusBadge from '@ui/components/StatusBadge'
import Badge from '@ui/components/Badge'
import EmptyState from '@ui/components/EmptyState'
import Spinner from '@ui/components/Spinner'
import type { Escalation } from '@data-models'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const TYPE_LABEL: Record<string, string> = {
  human_checkpoint: 'Human Checkpoint',
  low_confidence: 'Low Confidence',
  checkpoint_failure: 'Checkpoint Failed',
  node_error: 'Node Error',
}

function EscalationCard({ esc }: { esc: Escalation }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-800 truncate">
              {TYPE_LABEL[esc.type] ?? esc.type}
            </p>
            <StatusBadge status={esc.status} />
          </div>
          <p className="text-xs text-gray-400 font-mono mt-1">
            run {esc.run_id.slice(0, 8)}… · {new Date(esc.created_at).toLocaleString()}
          </p>
        </div>
        <Link
          to={`/runs/${esc.run_id}`}
          className="text-xs text-blue-600 hover:underline shrink-0"
        >
          {esc.status === 'open' ? 'Review →' : 'View →'}
        </Link>
      </div>
    </Card>
  )
}

export default function EscalationsPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const [filter, setFilter] = useState<string>('open')
  const { data: escalations = [], isLoading } = useEscalations(workspaceId, filter || undefined)

  const openCount = escalations.filter((e) => e.status === 'open').length
  const resolvedCount = escalations.filter((e) => e.status === 'resolved').length

  const FILTERS = [
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: '', label: 'All' },
  ]

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Escalations"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="orange">{openCount} open</Badge>
            <Badge variant="gray">{resolvedCount} resolved</Badge>
          </div>
        }
      />

      <div className="flex gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : escalations.length === 0 ? (
        <EmptyState
          heading="No escalations found"
          subtext="Escalations appear when a run needs human review."
        />
      ) : (
        <div className="space-y-2">
          {escalations.map((esc) => <EscalationCard key={esc.id} esc={esc} />)}
        </div>
      )}
    </div>
  )
}
