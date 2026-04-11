import { useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import type { Run, RunNodeState, Escalation } from '@data-models'

interface Props {
  run: Run
  nodeStates: RunNodeState[]
  escalations: Escalation[]
  lastRating: number | null
  lastRatedNodeId: string | null
}

type NudgeVariant = 'low_confidence' | 'low_rating' | 'success' | null

function computeVariant(
  run: Run,
  nodeStates: RunNodeState[],
  escalations: Escalation[],
  lastRating: number | null,
): NudgeVariant {
  if (run.status === 'completed') {
    if (lastRating !== null && lastRating <= 2) return 'low_rating'
    const hasLowConf = escalations.some((e) => e.status === 'resolved' && e.type === 'low_confidence')
    if (hasLowConf) return 'low_confidence'
    const allHighConf = nodeStates.every(
      (n) => n.confidence_score === null || n.confidence_score >= 0.8,
    )
    if (allHighConf && nodeStates.length > 0) return 'success'
  }
  return null
}

function duration(run: Run) {
  if (!run.completed_at || !run.started_at) return ''
  const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function PostRunNudge({ run, nodeStates, escalations, lastRating, lastRatedNodeId }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const variant = computeVariant(run, nodeStates, escalations, lastRating)

  if (!variant || dismissed) return null

  const lowConfEsc = escalations.find((e) => e.status === 'resolved' && e.type === 'low_confidence')
  const lowRatedNode = nodeStates.find((n) => n.node_id === lastRatedNodeId)
  const lowRatedKnowledge = lowRatedNode?.knowledge_snapshot
    ? Object.keys(lowRatedNode.knowledge_snapshot)[0]
    : null

  const STYLES = {
    low_confidence: 'bg-amber-50 border-amber-200 text-amber-800',
    low_rating: 'bg-orange-50 border-orange-200 text-orange-800',
    success: 'bg-green-50 border-green-200 text-green-800',
  }

  return (
    <div className={`border rounded-xl px-4 py-3 flex items-start gap-3 ${STYLES[variant]}`}>
      <div className="flex-1 text-sm">
        {variant === 'low_confidence' && lowConfEsc && (
          <>
            Knowledge used in node <strong>{String(lowConfEsc.context.node_id ?? '—')}</strong> may
            need improvement.{' '}
            <Link to="/handbook" className="underline font-medium">Review Handbook →</Link>
          </>
        )}
        {variant === 'low_rating' && (
          <>
            This node output was rated low.{' '}
            {lowRatedKnowledge && (
              <>
                Review{' '}
                <Link
                  to={`/handbook/file?path=${encodeURIComponent(lowRatedKnowledge)}`}
                  className="underline font-medium"
                >
                  {lowRatedKnowledge}
                </Link>{' '}
                for improvements?{' '}
              </>
            )}
            <Link to="/handbook" className="underline font-medium">Open Handbook →</Link>
          </>
        )}
        {variant === 'success' && (
          <>✅ Run completed in {duration(run)} with high confidence.</>
        )}
      </div>
      <button onClick={() => setDismissed(true)} className="opacity-60 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  )
}
