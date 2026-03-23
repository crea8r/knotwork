import { Link, useNavigate } from 'react-router-dom'
import { useRuns } from '@/api/runs'
import { useEscalations } from '@/api/escalations'
import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import StatusBadge from '@/components/shared/StatusBadge'
import EmptyState from '@/components/shared/EmptyState'
import MockWrap from '@/components/shared/MockWrap'
import Spinner from '@/components/shared/Spinner'
import { MOCK_ETA } from '@/mocks'
import type { Run, Escalation } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function EscalationCard({ esc }: { esc: Escalation }) {
  const TYPE: Record<string, string> = {
    human_checkpoint: 'Human Checkpoint',
    low_confidence: 'Low Confidence',
    checkpoint_failure: 'Checkpoint Failed',
    node_error: 'Node Error',
  }
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">{TYPE[esc.type] ?? esc.type}</p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">run {esc.run_id.slice(0, 8)}…</p>
        </div>
        <Link
          to={`/runs/${esc.run_id}`}
          className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 font-medium"
        >
          Review →
        </Link>
      </div>
    </Card>
  )
}

function RunCard({ run }: { run: Run }) {
  const navigate = useNavigate()
  const nodeCount = 3 // approximation — we don't have node count here
  return (
    <Card className="p-4" onClick={() => navigate(`/runs/${run.id}`)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-gray-500">run {run.id.slice(0, 8)}…</p>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={run.status} />
            <span className="text-xs text-gray-400">{timeAgo(run.created_at)}</span>
          </div>
        </div>
        {['queued', 'running'].includes(run.status) && (
          <MockWrap label="ETA S6">
            <span className="text-xs text-gray-500 px-2 py-1">{MOCK_ETA(nodeCount)}</span>
          </MockWrap>
        )}
      </div>
    </Card>
  )
}

export default function DashboardPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: allRuns = [], isLoading: runsLoading } = useRuns(workspaceId)
  const { data: openEscalations = [], isLoading: escLoading } = useEscalations(workspaceId, 'open')

  const activeRuns = allRuns.filter((r) => ['queued', 'running', 'paused'].includes(r.status))
  const recentRuns = allRuns
    .filter((r) => ['completed', 'failed', 'stopped'].includes(r.status))
    .slice(0, 10)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader title="Dashboard" />

      {/* Escalations */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Escalations {openEscalations.length > 0 && (
            <span className="ml-1 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
              {openEscalations.length}
            </span>
          )}
        </h2>
        {escLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : openEscalations.length === 0 ? (
          <EmptyState heading="No open escalations" subtext="All runs are proceeding automatically." />
        ) : (
          <div className="space-y-2">
            {openEscalations.map((e) => <EscalationCard key={e.id} esc={e} />)}
          </div>
        )}
      </section>

      {/* Active runs */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Active Runs
        </h2>
        {runsLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : activeRuns.length === 0 ? (
          <EmptyState heading="No active runs" subtext="Trigger a graph to see runs here." />
        ) : (
          <div className="space-y-2">
            {activeRuns.map((r) => <RunCard key={r.id} run={r} />)}
          </div>
        )}
      </section>

      {/* Recent */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Recent</h2>
        {recentRuns.length === 0 ? (
          <EmptyState heading="No completed runs yet" />
        ) : (
          <div className="space-y-2">
            {recentRuns.map((r) => (
              <Card key={r.id} className="px-4 py-3" onClick={() => {}}>
                <Link to={`/runs/${r.id}`} className="flex items-center gap-3">
                  <span className="font-mono text-xs text-gray-400">{r.id.slice(0, 8)}…</span>
                  <StatusBadge status={r.status} />
                  <span className="text-xs text-gray-400 ml-auto">{timeAgo(r.created_at)}</span>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
