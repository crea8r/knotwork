import { useMemo, useRef, useState } from 'react'
import { GitBranch, PlayCircle, X } from 'lucide-react'
import { useTriggerRunAny } from '@/api/runs'
import { ChannelComposer } from './ChannelFrame'
import Btn from '@/components/shared/Btn'
import type { Graph } from '@/types'

function buildRunInput(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) return { text: '' }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return { text: trimmed }
  }
}

export default function WorkflowSlashComposer({
  workspaceId,
  workflows,
  channelId,
  objectiveId,
  draft,
  setDraft,
  onSend,
  placeholder,
  pending = false,
  rows = 3,
  sendLabel = 'Send',
  beforeInput,
  inputRef: externalInputRef,
}: {
  workspaceId: string
  workflows: Graph[]
  channelId?: string | null
  objectiveId?: string | null
  draft: string
  setDraft: (value: string) => void
  onSend: () => void
  placeholder: string
  pending?: boolean
  rows?: number
  sendLabel?: string
  beforeInput?: React.ReactNode
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const localInputRef = useRef<HTMLTextAreaElement | null>(null)
  const inputRef = externalInputRef ?? localInputRef
  const triggerRun = useTriggerRunAny(workspaceId)
  const [selectedWorkflow, setSelectedWorkflow] = useState<Graph | null>(null)
  const [runName, setRunName] = useState('')
  const [runInput, setRunInput] = useState('')

  const activeSlash = useMemo(() => {
    const cursor = inputRef.current?.selectionStart ?? draft.length
    const beforeCursor = draft.slice(0, cursor)
    const match = beforeCursor.match(/(^|\s)\/([A-Za-z0-9._-]*)$/)
    if (!match || match.index == null) return null
    const query = (match[2] ?? '').toLowerCase()
    const start = match.index + match[1].length
    return { query, start, end: cursor }
  }, [draft])

  const workflowSuggestions = useMemo(() => {
    if (!activeSlash) return []
    return workflows
      .filter((workflow) => workflow.status !== 'archived')
      .filter((workflow) => {
        if (!activeSlash.query) return true
        const haystack = `${workflow.name} ${workflow.path} ${workflow.description ?? ''}`.toLowerCase()
        return haystack.includes(activeSlash.query)
      })
      .slice(0, 6)
  }, [activeSlash, workflows])

  function openWorkflowRun(workflow: Graph) {
    if (activeSlash) {
      const nextDraft = `${draft.slice(0, activeSlash.start)}${draft.slice(activeSlash.end)}`.replace(/\s{2,}/g, ' ')
      setDraft(nextDraft.trimStart())
    }
    setSelectedWorkflow(workflow)
    setRunName('')
    setRunInput('')
  }

  async function submitWorkflowRun() {
    if (!selectedWorkflow) return
    await triggerRun.mutateAsync({
      graphId: selectedWorkflow.id,
      input: buildRunInput(runInput),
      name: runName.trim() || undefined,
      objective_id: objectiveId ?? undefined,
      source_channel_id: channelId ?? undefined,
    })
    setSelectedWorkflow(null)
    setRunName('')
    setRunInput('')
  }

  const slashMenu = workflowSuggestions.length > 0 ? (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      {workflowSuggestions.map((workflow) => (
        <button
          key={workflow.id}
          type="button"
          onClick={() => openWorkflowRun(workflow)}
          className="flex w-full items-start gap-3 border-b border-stone-100 px-3 py-2 text-left last:border-b-0 hover:bg-stone-50"
        >
          <GitBranch size={14} className="mt-0.5 flex-shrink-0 text-brand-600" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-stone-900">{workflow.name}</div>
            <div className="truncate text-xs text-stone-500">{workflow.path || 'Workflow'}</div>
          </div>
        </button>
      ))}
    </div>
  ) : null

  return (
    <>
      <ChannelComposer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        placeholder={placeholder}
        pending={pending}
        rows={rows}
        sendLabel={sendLabel}
        inputRef={inputRef as React.Ref<HTMLTextAreaElement>}
        beforeInput={(
          <>
            {beforeInput}
            {slashMenu}
          </>
        )}
      />

      {selectedWorkflow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-[28px] border border-stone-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Start Workflow</p>
                <h2 className="mt-1 text-base font-semibold text-stone-900">{selectedWorkflow.name}</h2>
                <p className="mt-1 text-sm text-stone-500">
                  This run will be logged back into the current channel.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWorkflow(null)}
                className="rounded-lg border border-stone-200 p-2 text-stone-500 hover:text-stone-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block text-sm text-stone-600">
                Run Name
                <input
                  value={runName}
                  onChange={(event) => setRunName(event.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                />
              </label>

              <label className="block text-sm text-stone-600">
                Input
                <textarea
                  rows={8}
                  value={runInput}
                  onChange={(event) => setRunInput(event.target.value)}
                  placeholder='Plain text becomes {"text": "..."}; JSON is also accepted.'
                  className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-4">
              <Btn type="button" variant="ghost" size="sm" onClick={() => setSelectedWorkflow(null)}>
                Cancel
              </Btn>
              <Btn type="button" size="sm" loading={triggerRun.isPending} onClick={() => { void submitWorkflowRun() }}>
                <PlayCircle size={14} /> Start Run
              </Btn>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
