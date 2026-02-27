import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEscalation, useResolveEscalation, type EscalationResolve } from '@/api/escalations'
import { useAuthStore } from '@/store/auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

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
      try {
        payload.edited_output = JSON.parse(editedOutput)
      } catch {
        payload.edited_output = { text: editedOutput }
      }
    }
    if (resolution === 'guided' && guidance) {
      payload.guidance = guidance
    }
    resolve.mutate(payload, {
      onSuccess: () => navigate('/escalations'),
    })
  }

  if (isLoading) return <p className="text-center text-gray-400 mt-16 text-sm">Loading…</p>
  if (!esc) return <p className="text-center text-red-500 mt-16 text-sm">Escalation not found.</p>

  const ctx = esc.context as Record<string, unknown>
  const isOpen = esc.status === 'open'

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-xs text-gray-400 hover:text-gray-600">
          ← Back
        </button>
        <h1 className="text-lg font-semibold">Escalation Review</h1>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          esc.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
        }`}>
          {esc.status}
        </span>
      </div>

      {/* Context */}
      <section className="bg-gray-50 rounded-lg p-4 space-y-2">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Context</p>
        {ctx.prompt && <p className="text-sm text-gray-700">{ctx.prompt as string}</p>}
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-2">
          <span>Type: <strong>{esc.type}</strong></span>
          <span>Node: <strong>{(ctx.node_id as string) ?? '—'}</strong></span>
          {ctx.confidence != null && (
            <span>Confidence: <strong>{((ctx.confidence as number) * 100).toFixed(0)}%</strong></span>
          )}
        </div>
      </section>

      {/* Current output */}
      {ctx.current_output != null && (
        <section>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2">
            Current Output
          </p>
          <pre className="bg-white border border-gray-200 rounded p-3 text-sm whitespace-pre-wrap overflow-auto max-h-48">
            {typeof ctx.current_output === 'string'
              ? ctx.current_output
              : JSON.stringify(ctx.current_output, null, 2)}
          </pre>
        </section>
      )}

      {/* Resolution actions */}
      {isOpen ? (
        <section className="space-y-4">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Action</p>

          <div className="grid grid-cols-2 gap-3">
            {(['approved', 'edited', 'guided', 'aborted'] as const).map((action) => (
              <button
                key={action}
                onClick={() => setActiveAction(action === activeAction ? null : action)}
                className={`py-2 px-3 rounded text-sm font-medium border transition-colors ${
                  activeAction === action
                    ? action === 'aborted'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                }`}
              >
                {action.charAt(0).toUpperCase() + action.slice(1)}
              </button>
            ))}
          </div>

          {activeAction === 'edited' && (
            <textarea
              className="w-full border border-gray-200 rounded p-2 text-sm font-mono"
              rows={5}
              placeholder="Paste edited output (JSON or plain text)…"
              value={editedOutput}
              onChange={(e) => setEditedOutput(e.target.value)}
            />
          )}

          {activeAction === 'guided' && (
            <textarea
              className="w-full border border-gray-200 rounded p-2 text-sm"
              rows={3}
              placeholder="Provide guidance for the node to retry…"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
            />
          )}

          {activeAction && (
            <button
              disabled={resolve.isPending}
              onClick={() => handleResolve(activeAction)}
              className={`w-full py-2 rounded text-sm font-medium text-white transition-colors ${
                activeAction === 'aborted'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {resolve.isPending ? 'Submitting…' : `Confirm: ${activeAction}`}
            </button>
          )}

          {resolve.isError && (
            <p className="text-xs text-red-500">Failed to resolve. Please try again.</p>
          )}
        </section>
      ) : (
        <section className="bg-green-50 rounded-lg p-4">
          <p className="text-sm font-medium text-green-700">
            Resolved: {esc.resolution ?? '—'}
          </p>
          {esc.resolved_at && (
            <p className="text-xs text-green-500 mt-1">
              {new Date(esc.resolved_at).toLocaleString()}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
