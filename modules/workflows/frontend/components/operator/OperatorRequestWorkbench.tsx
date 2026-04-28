import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, Clock3, FileText, MessageSquareText, X } from 'lucide-react'
import MarkdownViewer from '@ui/components/MarkdownViewer'
import type { useRespondChannelMessage } from '@modules/communication/frontend/api/channels'
import type { ChatItem } from '@modules/workflows/frontend/pages/runDetail/runDetailTypes'
import { getRequestTargetRoleLabel, parseRequestContext } from '@modules/workflows/frontend/lib/requestContext'
import OperatorRequestRespondPanel from './OperatorRequestRespondPanel'

interface Props {
  item: ChatItem
  assigneeText?: string
  disabled: boolean
  isOpen: boolean
  respondToMessage: ReturnType<typeof useRespondChannelMessage>
  onAfterResolve: () => void
  onClose: () => void
}

type WorkbenchTab = 'respond' | 'brief' | 'context'

function formatRemaining(timeoutAt?: string): string | null {
  if (!timeoutAt) return null
  const remainingMs = Math.max(new Date(timeoutAt).getTime() - Date.now(), 0)
  if (remainingMs <= 0) return 'Timed out'
  const totalSeconds = Math.floor(remainingMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m left`
  if (minutes > 0) return `${minutes}m left`
  return `${totalSeconds}s left`
}

export default function OperatorRequestWorkbench({
  item,
  assigneeText,
  disabled,
  isOpen,
  respondToMessage,
  onAfterResolve,
  onClose,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [tab, setTab] = useState<WorkbenchTab>('respond')
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0)
  const request = item.request
  const requestMessageId = item.requestMessageId
  const targetRoleLabel = getRequestTargetRoleLabel(request?.target_role)
  const context = useMemo(
    () => parseRequestContext(request?.context_markdown ?? item.preText),
    [item.preText, request?.context_markdown],
  )
  const activeSource = context.handbookEntries[selectedSourceIndex] ?? null
  const timeoutLabel = formatRemaining(request?.timeout_at)

  useEffect(() => {
    setTab('respond')
    setSelectedSourceIndex(0)
  }, [requestMessageId])

  useEffect(() => {
    if (!isOpen) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus?.()
    }
  }, [isOpen, onClose])

  if (!isOpen || !request || !requestMessageId) return null

  const tabs: Array<{ id: WorkbenchTab; label: string; icon: typeof MessageSquareText }> = [
    { id: 'respond', label: 'Respond', icon: MessageSquareText },
    { id: 'brief', label: 'Brief', icon: FileText },
    { id: 'context', label: 'Context', icon: BookOpenText },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div className="flex h-full flex-col">
        <div className="border-b border-gray-200 bg-white px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-sm xl:px-8 xl:pb-5 xl:pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-amber-700">{targetRoleLabel} workbench</p>
              <h2 className="mt-1 truncate text-base font-semibold text-gray-950">
                {item.nodeName ?? 'Active request'}
              </h2>
              <p className="mt-1 text-sm text-gray-600">{assigneeText ? `Assigned to ${assigneeText}` : `Waiting for ${targetRoleLabel.toLowerCase()} response`}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="rounded-full border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Close request workbench"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {timeoutLabel ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900">
                <Clock3 size={12} />
                {timeoutLabel}
              </span>
            ) : null}
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-700">
              {request.status ?? 'open'}
            </span>
            {context.handbookEntries.length > 0 ? (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-700">
                {context.handbookEntries.length} knowledge file{context.handbookEntries.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  tab === id
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f8fb]">
          <div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] xl:px-8 xl:py-6">
            <div className={`${tab === 'respond' ? 'block' : 'hidden'} h-full`}>
              <div className="mx-auto w-full max-w-5xl">
                <OperatorRequestRespondPanel
                  request={request}
                  requestMessageId={requestMessageId}
                  disabled={disabled}
                  respondToMessage={respondToMessage}
                  onAfterResolve={onAfterResolve}
                />
              </div>
            </div>

            <div className={`${tab === 'brief' ? 'block' : 'hidden'} h-full`}>
              <div className="mx-auto w-full max-w-5xl space-y-4">
                {request.questions?.length ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm xl:p-5">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-gray-400">Decision points</p>
                    <div className="space-y-2">
                      {request.questions.map((question, index) => (
                        <div key={`${index}-${question.slice(0, 24)}`} className="rounded-xl bg-gray-50 px-3 py-3 xl:px-4 xl:py-4">
                          <p className="text-xs font-medium text-gray-500">Question {index + 1}</p>
                          <div className="mt-1 text-sm text-gray-900">
                            <MarkdownViewer content={question} compact />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {context.taskBrief ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm xl:p-5">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-gray-400">Task brief</p>
                    <div className="text-sm text-gray-900">
                      <MarkdownViewer content={context.taskBrief} compact />
                    </div>
                  </div>
                ) : null}

                {context.extraSections
                  .filter((section) => section.content !== context.taskBrief)
                  .map((section) => (
                    <div key={`${section.title}-${section.content.slice(0, 24)}`} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm xl:p-5">
                      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-gray-400">{section.title}</p>
                      <div className="text-sm text-gray-900">
                        <MarkdownViewer content={section.content} compact />
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className={`${tab === 'context' ? 'block' : 'hidden'} h-full`}>
              <div className="mx-auto grid w-full max-w-7xl gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-sm font-medium text-gray-900">Context sources</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Read one source at a time. The task brief stays separate so the answer surface remains short.
                    </p>
                  </div>

                  {context.handbookEntries.length > 0 ? (
                    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
                      <div className="space-y-2">
                        {context.handbookEntries.map((entry, index) => (
                          <button
                            key={entry.path}
                            type="button"
                            onClick={() => setSelectedSourceIndex(index)}
                            className={`flex min-h-11 w-full items-center rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                              selectedSourceIndex === index
                                ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <span className="block truncate font-mono">{entry.path}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500">
                      No knowledge files were attached to this request.
                    </div>
                  )}

                  {context.missingHandbookFiles.length > 0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                      <p className="text-sm font-medium text-amber-900">Missing knowledge files</p>
                      <ul className="mt-2 space-y-1 text-xs text-amber-900/90">
                        {context.missingHandbookFiles.map((path) => (
                          <li key={path} className="font-mono">{path}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="min-h-[360px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  {activeSource ? (
                    <>
                      <div className="border-b border-gray-200 px-4 py-3 xl:px-5 xl:py-4">
                        <p className="font-mono text-xs text-gray-800">{activeSource.path}</p>
                      </div>
                      <div className="h-[calc(100vh-17rem)] overflow-y-auto px-4 py-4 text-sm text-gray-900 xl:h-[calc(100vh-16rem)] xl:px-5 xl:py-5">
                        <MarkdownViewer content={activeSource.content} compact />
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center px-6 text-sm text-gray-500">
                      Select a knowledge source to read it.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
