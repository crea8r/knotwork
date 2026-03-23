import { Send } from 'lucide-react'
import type { useResolveEscalationAny } from '@/api/escalations'

interface Props {
  questions: string[]
  normAnswers: string[]
  currentStep: number
  comment: string
  disabled: boolean
  resolveEscalation: ReturnType<typeof useResolveEscalationAny>
  escalationId: string
  onSetCurrentStep: (s: number) => void
  onSetAnswers: (a: string[]) => void
  onSetComment: (c: string) => void
  onAfterResolve: () => void
}

export default function DecisionCardAnswers({
  questions, normAnswers, currentStep, comment, disabled,
  resolveEscalation, escalationId, onSetCurrentStep, onSetAnswers, onSetComment, onAfterResolve,
}: Props) {
  const isLast = currentStep === questions.length - 1
  const currentAnswer = normAnswers[currentStep] ?? ''
  const allAnswered = normAnswers.every(a => a.trim().length > 0)
  const answeredCount = normAnswers.filter(a => a.trim()).length

  function handleSendAnswers() {
    if (disabled) return
    resolveEscalation.mutate(
      {
        escalationId,
        data: {
          resolution: 'request_revision',
          answers: normAnswers,
          guidance: comment.trim() || undefined,
        },
      },
      { onSuccess: () => { onSetAnswers([]); onSetComment(''); onAfterResolve() } },
    )
  }

  return (
    <div className="space-y-3 border-t border-amber-200 pt-3">
      {/* Progress — clickable dots to jump freely */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-amber-600">
          Question {currentStep + 1} of {questions.length}
        </p>
        <div className="flex gap-1.5">
          {questions.map((_, i) => (
            <button
              key={i}
              onClick={() => onSetCurrentStep(i)}
              title={`Question ${i + 1}`}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                normAnswers[i]?.trim()
                  ? 'bg-green-400'
                  : i === currentStep
                    ? 'bg-amber-500'
                    : 'bg-amber-200 hover:bg-amber-300'
              }`}
            />
          ))}
        </div>
      </div>

      <p className="text-sm font-medium text-amber-900 leading-relaxed">
        {questions[currentStep]}
        <span className="text-red-500 ml-0.5">*</span>
      </p>

      <textarea
        key={currentStep}
        autoFocus
        value={currentAnswer}
        onChange={(e) => {
          const next = [...normAnswers]
          next[currentStep] = e.target.value
          onSetAnswers(next)
        }}
        rows={3}
        placeholder="Your answer…"
        className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm resize-none bg-white outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
      />

      <div className="flex gap-2">
        <button
          onClick={() => onSetCurrentStep(currentStep - 1)}
          disabled={currentStep === 0}
          className="px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <button
          onClick={() => onSetCurrentStep(currentStep + 1)}
          disabled={isLast}
          className="px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>

      <div className="space-y-1 pt-1 border-t border-amber-100">
        <p className="text-[10px] text-amber-500 uppercase tracking-wide">
          Additional context <span className="normal-case">(optional)</span>
        </p>
        <textarea
          value={comment}
          onChange={(e) => onSetComment(e.target.value)}
          rows={2}
          placeholder="Any extra context for the agent…"
          className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm resize-none bg-white outline-none focus:ring-1 focus:ring-amber-300"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSendAnswers}
          disabled={disabled || resolveEscalation.isPending || !allAnswered}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={12} />
          {resolveEscalation.isPending
            ? 'Sending…'
            : allAnswered
              ? 'Submit answers'
              : `Submit (${answeredCount}/${questions.length} answered)`}
        </button>
        <button
          onClick={() => resolveEscalation.mutate(
            { escalationId, data: { resolution: 'abort_run' } },
            { onSuccess: () => onAfterResolve() },
          )}
          disabled={disabled || resolveEscalation.isPending}
          className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Abort
        </button>
      </div>
      {resolveEscalation.isError && (
        <p className="text-xs text-red-500">Failed to send. Please try again.</p>
      )}
    </div>
  )
}
