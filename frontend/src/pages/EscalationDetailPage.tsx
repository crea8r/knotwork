import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useEscalation, useResolveEscalation, type EscalationResolve } from '@/api/escalations'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/shared/Card'
import Btn from '@/components/shared/Btn'
import StatusBadge from '@/components/shared/StatusBadge'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const ACTION_STYLES: Record<string, string> = {
  approved: 'bg-green-600 hover:bg-green-700 text-white',
  edited:   'bg-brand-600 hover:bg-brand-700 text-white',
  guided:   'bg-blue-600 hover:bg-blue-700 text-white',
  aborted:  'bg-red-600 hover:bg-red-700 text-white',
}

export default function EscalationDetailPage() {
  const { escalationId } = useParams<{ escalationId: string }>()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const navigate = useNavigate()

  const { data: esc, isLoading } = useEscalation(workspaceId, escalationId!)
  const resolve = useResolveEscalation(workspaceId, escalationId!)

  const [editedOutput, setEditedOutput] = useState('')
  const [guidance, setGuidance] = useState('')
  const [activeAction, setActiveAction] = useState<EscalationResolve['resolution'] | null>(null)

  function handleResolve(resolution: EscalationResolve['resolution']) {
    const payload: EscalationResolve = { resolution }
    if (resolution === 'edited' && editedOutput) {
      try { payload.edited_output = JSON.parse(editedOutput) }
      catch { payload.edited_output = { text: editedOutput } }
    }
    if (resolution === 'guided' && guidance) payload.guidance = guidance
    resolve.mutate(payload, { onSuccess: () => navigate('/escalations') })
  }

  if (isLoading) return <div className="flex justify-center py-16 text-gray-400">Loading…</div>
  if (!esc) return <div className="p-8 text-red-500">Escalation not found.</div>

  const ctx = esc.context as Record<string, unknown>
  const isOpen = esc.status === 'open'

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link to="/escalations" className="hover:text-gray-600">Escalations</Link>
        <span>›</span>
        <span className="text-gray-600 font-mono">{esc.run_id.slice(0, 8)}…</span>
      </div>

      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Escalation Review</h1>
        <StatusBadge status={esc.status} />
      </div>

      {/* Context */}
      <Card className="p-5 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Context</p>
        {ctx.prompt && <p className="text-sm text-gray-700">{ctx.prompt as string}</p>}
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
          <span>Type: <strong className="text-gray-700">{esc.type}</strong></span>
          <span>Node: <strong className="text-gray-700">{(ctx.node_id as string) ?? '—'}</strong></span>
          {ctx.confidence != null && (
            <span>
              Confidence: <strong className="text-gray-700">
                {((ctx.confidence as number) * 100).toFixed(0)}%
              </strong>
            </span>
          )}
        </div>
      </Card>

      {/* Current output */}
      {ctx.current_output != null && (
        <Card className="p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Current Output
          </p>
          <pre className="bg-gray-50 rounded p-3 text-sm whitespace-pre-wrap overflow-auto max-h-48 font-mono">
            {typeof ctx.current_output === 'string'
              ? ctx.current_output
              : JSON.stringify(ctx.current_output, null, 2)}
          </pre>
        </Card>
      )}

      {/* Resolution actions */}
      {isOpen ? (
        <Card className="p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Action</p>
          <div className="grid grid-cols-2 gap-3">
            {(['approved', 'edited', 'guided', 'aborted'] as const).map((action) => (
              <button
                key={action}
                onClick={() => setActiveAction(action === activeAction ? null : action)}
                className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors capitalize ${
                  activeAction === action
                    ? ACTION_STYLES[action]
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                }`}
              >
                {action}
              </button>
            ))}
          </div>

          {activeAction === 'edited' && (
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-sm font-mono resize-y"
              rows={5}
              placeholder="Paste edited output (JSON or plain text)…"
              value={editedOutput}
              onChange={(e) => setEditedOutput(e.target.value)}
            />
          )}
          {activeAction === 'guided' && (
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-y"
              rows={3}
              placeholder="Provide guidance for the node to retry…"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
            />
          )}

          {activeAction && (
            <Btn
              variant={activeAction === 'aborted' ? 'danger' : 'primary'}
              className="w-full justify-center"
              loading={resolve.isPending}
              onClick={() => handleResolve(activeAction)}
            >
              Confirm: {activeAction}
            </Btn>
          )}
          {resolve.isError && (
            <p className="text-xs text-red-500">Failed to resolve. Please try again.</p>
          )}
        </Card>
      ) : (
        <Card className="p-5 bg-green-50 border-green-200">
          <p className="text-sm font-medium text-green-700">Resolved: {esc.resolution ?? '—'}</p>
        </Card>
      )}
    </div>
  )
}
