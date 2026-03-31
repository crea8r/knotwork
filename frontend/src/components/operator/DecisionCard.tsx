import { useEffect, useRef, useState } from 'react'
import { Send, Paperclip } from 'lucide-react'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import type { useResolveEscalationAny } from '@/api/escalations'
import type { ChatItem } from '@/pages/runDetail/runDetailTypes'
import DecisionCardAnswers from './DecisionCardAnswers'

interface Props {
  item: ChatItem
  resolveEscalation: ReturnType<typeof useResolveEscalationAny>
  disabled: boolean
  onAfterResolve: () => void
}

export default function DecisionCard({ item, resolveEscalation, disabled, onAfterResolve }: Props) {
  const esc = item.escalation
  const [guidance, setGuidance] = useState('')
  const [overrideOutput, setOverrideOutput] = useState('')
  const [mode, setMode] = useState<'revision' | 'override'>('revision')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [answers, setAnswers] = useState<string[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [comment, setComment] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isOpen = esc?.status === 'open'
  const currentValue = mode === 'revision' ? guidance : overrideOutput

  useEffect(() => {
    if (!isOpen || !esc?.timeout_at) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [isOpen, esc?.timeout_at])

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
  }

  function handleSend() {
    const trimmed = currentValue.trim()
    if (!trimmed || disabled) return
    if (mode === 'revision') {
      resolveEscalation.mutate(
        { escalationId: esc!.id, data: { resolution: 'request_revision', guidance: trimmed } },
        { onSuccess: () => { setGuidance(''); onAfterResolve() } },
      )
    } else {
      resolveEscalation.mutate(
        { escalationId: esc!.id, data: { resolution: 'override_output', override_output: { text: trimmed } } },
        { onSuccess: () => { setOverrideOutput(''); onAfterResolve() } },
      )
    }
  }

  if (item.kind === 'decision_confident') {
    return (
      <div className="max-w-[92%] mr-auto rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-emerald-700">Decision</p>
        <p className="text-sm text-emerald-900">{item.text}</p>
      </div>
    )
  }

  if (!esc) return null
  const ctx = esc.context as Record<string, unknown>
  const questions: string[] = Array.isArray(ctx.questions) ? ctx.questions.map(String) : []
  const legacyQuestion = questions.length === 0 && typeof ctx.question === 'string' ? ctx.question : null
  const options = Array.isArray(ctx.options) ? ctx.options.map(String) : []
  const hasQuestions = questions.length > 0
  const hasRoutingOptions = options.length > 0
  const normAnswers = questions.length > 0
    ? [...Array(questions.length)].map((_, i) => answers[i] ?? '')
    : answers
  const timeoutMs = esc.timeout_at ? new Date(esc.timeout_at).getTime() : null
  const remainingMs = timeoutMs == null ? null : Math.max(timeoutMs - nowMs, 0)
  const isTimedOut = esc.status === 'timed_out' || (remainingMs !== null && remainingMs <= 0)
  const isWarning = remainingMs !== null && remainingMs > 0 && remainingMs < 60 * 60 * 1000

  function formatRemaining(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  return (
    <div className="max-w-[92%] mr-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-amber-700">Escalation · needs your input</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${isOpen ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {esc.status}
        </span>
      </div>
      {timeoutMs !== null && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            isTimedOut
              ? 'border-red-200 bg-red-50 text-red-700'
              : isWarning
                ? 'border-amber-300 bg-amber-100 text-amber-800'
                : 'border-amber-200 bg-white text-amber-900'
          }`}
        >
          <p className="uppercase tracking-wide text-[10px] mb-0.5">Timeout</p>
          <p className="font-medium">
            {isTimedOut ? 'Timed out' : `Expires in ${formatRemaining(remainingMs ?? 0)}`}
          </p>
          {!isTimedOut && (
            <p className="mt-0.5 text-[11px] opacity-80">
              {esc.timeout_at ? new Date(esc.timeout_at).toLocaleString() : ''}
            </p>
          )}
        </div>
      )}
      {item.preText && (
        <div className="bg-white rounded-lg border border-amber-100 px-3 py-2 max-h-60 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Agent's analysis</p>
          <MarkdownViewer content={item.preText} compact />
        </div>
      )}
      {legacyQuestion && (
        <div className="border-t border-amber-200 pt-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Question</p>
          <p className="text-sm font-medium text-amber-900">{legacyQuestion}</p>
        </div>
      )}
      {isOpen && hasQuestions ? (
        <DecisionCardAnswers
          questions={questions}
          normAnswers={normAnswers}
          currentStep={currentStep}
          comment={comment}
          disabled={disabled}
          resolveEscalation={resolveEscalation}
          escalationId={esc.id}
          onSetCurrentStep={setCurrentStep}
          onSetAnswers={setAnswers}
          onSetComment={setComment}
          onAfterResolve={onAfterResolve}
        />
      ) : isOpen && hasRoutingOptions ? (
        <div className="rounded-xl border border-amber-200 bg-white shadow-sm overflow-hidden">
          <div className="px-3 pt-2.5 pb-2 border-b border-amber-100">
            <p className="text-xs font-medium text-amber-900">Choose the next branch</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Review the output above, then pick the path this run should continue on.
            </p>
          </div>
          <div className="px-3 py-3 space-y-2">
            {options.map((opt, i) => (
              <label
                key={`${opt}-${i}`}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  selectedBranch === opt
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-gray-200 hover:bg-gray-50'
                } ${disabled ? 'opacity-70' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name={`branch-${esc.id}`}
                  value={opt}
                  checked={selectedBranch === opt}
                  disabled={disabled}
                  onChange={() => setSelectedBranch(opt)}
                  className="mt-0.5"
                />
                <span className="font-mono text-xs text-gray-700 break-all">{opt}</span>
              </label>
            ))}
          </div>
          <div className="px-3 py-2 flex items-center justify-end border-t border-amber-100 bg-amber-50/60">
            <button
              onClick={() => {
                if (!selectedBranch || disabled) return
                resolveEscalation.mutate(
                  { escalationId: esc.id, data: { resolution: 'accept_output', next_branch: selectedBranch } },
                  { onSuccess: () => { setSelectedBranch(''); onAfterResolve() } },
                )
              }}
              disabled={disabled || !selectedBranch || resolveEscalation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={12} />
              {resolveEscalation.isPending ? 'Continuing…' : 'Continue'}
            </button>
          </div>
        </div>
      ) : isOpen ? (
        <div className="rounded-xl border border-amber-200 bg-white shadow-sm overflow-hidden">
          <div className="px-3 pt-2.5 pb-2 flex items-center gap-2.5 border-b border-amber-100">
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as 'revision' | 'override')
                setTimeout(() => textareaRef.current && autoGrow(textareaRef.current), 0)
              }}
              className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-2 py-0.5 outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer font-medium"
            >
              <option value="revision">Request revision</option>
              <option value="override">Override output</option>
            </select>
            <span className="text-[11px] text-gray-400">
              {mode === 'revision' ? 'Ask the agent to try again with your guidance' : "Replace the agent's output with your own text"}
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={currentValue}
            onChange={(e) => {
              if (mode === 'revision') setGuidance(e.target.value)
              else setOverrideOutput(e.target.value)
              autoGrow(e.target)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={mode === 'revision' ? 'Describe what to revise… (Enter to send, Shift+Enter for new line)' : 'Enter the corrected output… (Enter to send, Shift+Enter for new line)'}
            rows={3}
            className="w-full px-3 py-2.5 text-sm resize-none outline-none bg-transparent leading-relaxed overflow-y-auto"
            style={{ minHeight: '80px', maxHeight: '300px' }}
          />
          <div className="px-2 py-1.5 flex items-center justify-between border-t border-amber-100 bg-amber-50/60">
            <button type="button" title="Attach file" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <Paperclip size={14} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 select-none hidden sm:inline">Shift+Enter for new line</span>
              <button
                onClick={handleSend}
                disabled={disabled || !currentValue.trim() || resolveEscalation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={12} />
                {resolveEscalation.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
