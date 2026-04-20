import { useEffect, useRef, useState } from 'react'
import { Paperclip, Send } from 'lucide-react'
import type { useRespondChannelMessage } from '@modules/communication/frontend/api/channels'
import type { RequestPayload } from '@modules/workflows/frontend/pages/runDetail/runDetailTypes'
import DecisionCardAnswers from './DecisionCardAnswers'

interface Props {
  request: RequestPayload
  requestMessageId: string
  disabled: boolean
  respondToMessage: ReturnType<typeof useRespondChannelMessage>
  onAfterResolve: () => void
}

export default function OperatorRequestRespondPanel({
  request,
  requestMessageId,
  disabled,
  respondToMessage,
  onAfterResolve,
}: Props) {
  const [guidance, setGuidance] = useState('')
  const [overrideOutput, setOverrideOutput] = useState('')
  const [mode, setMode] = useState<'revision' | 'override'>('revision')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [answers, setAnswers] = useState<string[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [comment, setComment] = useState('')
  const [supervisorNote, setSupervisorNote] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOpen = request.status === 'open'
  const currentValue = mode === 'revision' ? guidance : overrideOutput
  const questions = request.questions ?? []
  const options = request.options ?? []
  const supportsNextBranch = !!request.response_schema?.supports_next_branch
  const hasQuestions = questions.length > 0
  const hasRoutingOptions = options.length > 0 && supportsNextBranch
  const canAskSupervisor = isOpen && request.target_role !== 'supervisor'
  const normAnswers = questions.length > 0
    ? [...Array(questions.length)].map((_, index) => answers[index] ?? '')
    : answers

  useEffect(() => {
    setGuidance('')
    setOverrideOutput('')
    setMode('revision')
    setSelectedBranch('')
    setAnswers([])
    setCurrentStep(0)
    setComment('')
    setSupervisorNote('')
  }, [requestMessageId])

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
  }

  function buildSupervisorGuidance(): string {
    const promptLine = supervisorNote.trim() || questions.find((question) => question.trim()) || 'Please review this request and unblock the next step.'
    const originalQuestions = questions
      .map((question) => question.trim())
      .filter(Boolean)
    const draftAnswers = questions
      .map((question, index) => {
        const answer = normAnswers[index]?.trim()
        if (!answer) return null
        return `- ${question}\n  Draft answer: ${answer}`
      })
      .filter((value): value is string => !!value)
    const parts = [promptLine]
    if (originalQuestions.length > 0) {
      parts.push(['Original questions:', ...originalQuestions.map((question) => `- ${question}`)].join('\n'))
    }
    if (draftAnswers.length > 0) {
      parts.push(['Operator draft answers:', ...draftAnswers].join('\n'))
    }
    if (comment.trim()) {
      parts.push(`Operator context:\n${comment.trim()}`)
    }
    return parts.filter(Boolean).join('\n\n')
  }

  function handleAskSupervisor() {
    const guidanceText = buildSupervisorGuidance().trim()
    if (!guidanceText || disabled) return
    respondToMessage.mutate(
      {
        messageId: requestMessageId,
        data: {
          resolution: 'request_revision',
          guidance: guidanceText,
        },
      },
      {
        onSuccess: () => {
          setSupervisorNote('')
          setAnswers([])
          setComment('')
          onAfterResolve()
        },
      },
    )
  }

  function handleSend() {
    const trimmed = currentValue.trim()
    if (!trimmed || disabled) return
    if (mode === 'revision') {
      respondToMessage.mutate(
        { messageId: requestMessageId, data: { resolution: 'request_revision', guidance: trimmed } },
        { onSuccess: () => { setGuidance(''); onAfterResolve() } },
      )
      return
    }
    respondToMessage.mutate(
      { messageId: requestMessageId, data: { resolution: 'override_output', override_output: { text: trimmed } } },
      { onSuccess: () => { setOverrideOutput(''); onAfterResolve() } },
    )
  }

  return (
    <div className="space-y-4">
      {hasQuestions ? (
        <DecisionCardAnswers
          questions={questions}
          normAnswers={normAnswers}
          currentStep={currentStep}
          comment={comment}
          disabled={disabled}
          respondToMessage={respondToMessage}
          messageId={requestMessageId}
          onSetCurrentStep={setCurrentStep}
          onSetAnswers={setAnswers}
          onSetComment={setComment}
          onAfterResolve={onAfterResolve}
        />
      ) : hasRoutingOptions ? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">Choose the next branch</p>
            <p className="mt-1 text-xs text-gray-500">
              Review the current output, then decide which path this run should continue on.
            </p>
          </div>
          <div className="space-y-2 px-4 py-4">
            {options.map((option, index) => (
              <label
                key={`${option}-${index}`}
                className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-sm transition-colors ${
                  selectedBranch === option
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-gray-200 hover:bg-gray-50'
                } ${disabled ? 'opacity-70' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name={`branch-${requestMessageId}`}
                  value={option}
                  checked={selectedBranch === option}
                  disabled={disabled}
                  onChange={() => setSelectedBranch(option)}
                  className="mt-0.5"
                />
                <span className="font-mono text-xs text-gray-700 break-all">{option}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-end border-t border-gray-200 bg-gray-50 px-4 py-3">
            <button
              type="button"
              onClick={() => {
                if (!selectedBranch || disabled) return
                respondToMessage.mutate(
                  { messageId: requestMessageId, data: { resolution: 'accept_output', next_branch: selectedBranch } },
                  { onSuccess: () => { setSelectedBranch(''); onAfterResolve() } },
                )
              }}
              disabled={disabled || !selectedBranch || respondToMessage.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={12} />
              {respondToMessage.isPending ? 'Continuing…' : 'Continue'}
            </button>
          </div>
        </div>
      ) : isOpen ? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as 'revision' | 'override')
                setTimeout(() => textareaRef.current && autoGrow(textareaRef.current), 0)
              }}
              className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <option value="revision">Request revision</option>
              <option value="override">Override output</option>
            </select>
            <span className="text-[11px] text-gray-500">
              {mode === 'revision' ? 'Ask for a rework with precise guidance.' : "Replace the output with your own final text."}
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={currentValue}
            onChange={(event) => {
              if (mode === 'revision') setGuidance(event.target.value)
              else setOverrideOutput(event.target.value)
              autoGrow(event.target)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            rows={5}
            placeholder={mode === 'revision' ? 'Describe exactly what should change…' : 'Write the final corrected output…'}
            className="w-full resize-none bg-transparent px-4 py-4 text-sm leading-relaxed outline-none"
            style={{ minHeight: '180px', maxHeight: '320px' }}
          />
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
            <button
              type="button"
              title="Attach file"
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <Paperclip size={16} />
            </button>
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] text-gray-400 sm:inline">Shift+Enter for new line</span>
              <button
                type="button"
                onClick={handleSend}
                disabled={disabled || !currentValue.trim() || respondToMessage.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={12} />
                {respondToMessage.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canAskSupervisor ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-medium text-slate-900">Need supervisor review?</p>
            <p className="mt-1 text-xs text-slate-600">
              Forward the task with a focused question. Draft answers and operator notes will travel with it.
            </p>
          </div>
          <div className="space-y-3 px-4 py-4">
            <textarea
              value={supervisorNote}
              onChange={(event) => setSupervisorNote(event.target.value)}
              rows={3}
              placeholder="What should the supervisor answer or decide?"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-slate-500">
                Keep the question short. The original task and selected answers are attached automatically.
              </p>
              <button
                type="button"
                onClick={handleAskSupervisor}
                disabled={disabled || respondToMessage.isPending || !buildSupervisorGuidance().trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={12} />
                {respondToMessage.isPending ? 'Sending…' : 'Ask supervisor'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {respondToMessage.isError ? (
        <p className="text-xs text-red-500">Failed to send. Please try again.</p>
      ) : null}
    </div>
  )
}
