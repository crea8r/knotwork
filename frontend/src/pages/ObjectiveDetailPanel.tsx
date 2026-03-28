import { useEffect, useMemo, useState } from 'react'
import { Hash, Plus, X } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { useChannel, useChannelDecisions, useChannelMessages, usePostChannelMessage, useUpdateChannel } from '@/api/channels'
import { useGraphs } from '@/api/graphs'
import { useUpdateObjective } from '@/api/projects'
import { ChannelShell, ChannelTimeline, type ChannelTimelineItem } from '@/components/channel/ChannelFrame'
import WorkflowSlashComposer from '@/components/channel/WorkflowSlashComposer'
import Badge from '@/components/shared/Badge'
import { projectObjectivePath, projectPath } from '@/lib/paths'
import type { ProjectOutletContext } from './ProjectDetailPage'

function statusVariant(status: string): 'gray' | 'green' | 'orange' | 'red' {
  if (status === 'done' || status === 'completed') return 'green'
  if (status === 'blocked' || status === 'failed') return 'red'
  if (status === 'in_progress' || status === 'running') return 'orange'
  return 'gray'
}

export default function ObjectiveDetailPanel() {
  const { workspaceId, project, projectSlug, objectives } = useOutletContext<ProjectOutletContext>()
  const { objectiveSlug = '' } = useParams<{ objectiveSlug: string }>()
  const objective = objectives.find((item) => item.slug === objectiveSlug)
  const { data: workflows = [] } = useGraphs(workspaceId)
  const { data: objectiveChannel } = useChannel(workspaceId, objective?.channel_id ?? '')
  const { data: messages = [] } = useChannelMessages(workspaceId, objective?.channel_id ?? '')
  const { data: decisions = [] } = useChannelDecisions(workspaceId, objective?.channel_id ?? '')
  const postMessage = usePostChannelMessage(workspaceId, objective?.channel_id ?? '')
  const updateObjective = useUpdateObjective(workspaceId, objective?.id ?? '')
  const updateChannel = useUpdateChannel(workspaceId, objective?.channel_id ?? '')
  const currentProgress = objective?.progress_percent ?? 0

  const [draft, setDraft] = useState('')
  const [progressDraft, setProgressDraft] = useState(String(currentProgress))
  const [keyResultsDraft, setKeyResultsDraft] = useState(objective?.key_results ?? [])
  const [editingProgress, setEditingProgress] = useState(false)
  const [showKeyResultDialog, setShowKeyResultDialog] = useState(false)
  const [newKeyResult, setNewKeyResult] = useState('')
  useEffect(() => {
    setProgressDraft(String(currentProgress))
    setKeyResultsDraft(objective?.key_results ?? [])
    setEditingProgress(false)
    setShowKeyResultDialog(false)
    setNewKeyResult('')
  }, [currentProgress, objective?.id, objective?.key_results])
  const objectivePath = useMemo(() => {
    if (!objective) return []
    const byId = new Map(objectives.map((item) => [item.id, item]))
    const chain: typeof objectives = []
    const seen = new Set<string>()
    let current: typeof objective | null = objective
    while (current && !seen.has(current.id)) {
      chain.unshift(current)
      seen.add(current.id)
      current = current.parent_objective_id ? (byId.get(current.parent_objective_id) ?? null) : null
    }
    return chain
  }, [objective, objectives])
  const childObjectives = useMemo(() => objectives
    .filter((item) => item.parent_objective_id === objective?.id)
    .sort((a, b) => {
      const codeCompare = (a.code ?? '').localeCompare(b.code ?? '')
      if (codeCompare !== 0) return codeCompare
      return a.title.localeCompare(b.title)
    }), [objective?.id, objectives])

  async function saveProgress(nextValue: string) {
    const normalized = String(Math.max(0, Math.min(100, Number(nextValue) || 0)))
    setProgressDraft(normalized)
    setEditingProgress(false)
    if (normalized === String(currentProgress)) return
    await updateObjective.mutateAsync({ progress_percent: Number(normalized) })
  }

  async function addKeyResult() {
    const value = newKeyResult.trim()
    if (!value) return
    const next = [...keyResultsDraft, value]
    setKeyResultsDraft(next)
    setShowKeyResultDialog(false)
    setNewKeyResult('')
    await updateObjective.mutateAsync({ key_results: next })
  }

  const timeline = useMemo(() => {
    const msgItems = messages.map((message) => ({
      id: `m-${message.id}`,
      kind: 'message' as const,
      ts: new Date(message.created_at).getTime(),
      data: message,
    }))
    const decisionItems = decisions.map((decision) => ({
      id: `d-${decision.id}`,
      kind: 'decision' as const,
      ts: new Date(decision.created_at).getTime(),
      data: decision,
    }))
    return [...msgItems, ...decisionItems].sort((a, b) => a.ts - b.ts)
  }, [decisions, messages])
  const timelineItems = useMemo<ChannelTimelineItem[]>(() => timeline.map((item) => {
    if (item.kind === 'message') {
      return {
        id: item.id,
        kind: 'message' as const,
        authorLabel: item.data.author_name ?? (item.data.author_type === 'human' ? 'You' : 'Agent'),
        mine: item.data.role === 'user',
        tone: item.data.author_type === 'system' ? 'system' : item.data.author_type === 'human' ? 'human' : 'agent',
        content: item.data.content,
      }
    }
    return {
      id: item.id,
      kind: 'decision' as const,
      label: item.data.decision_type.replace(/_/g, ' '),
      actorName: item.data.actor_name,
    }
  }), [timeline])

  if (!objective) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-stone-500">
        Objective not found in this project.
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 p-4 md:p-6">
      <ChannelShell
        eyebrow={(
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
            <Link to={projectPath(projectSlug)} className="max-w-[40vw] truncate hover:text-stone-800 md:max-w-none">
              {project.title}
            </Link>
            {objectivePath.map((item) => {
              const label = item.code ? `${item.code} · ${item.title}` : item.title
              const isCurrent = item.id === objective.id
              return (
                <span key={item.id} className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <span className="text-stone-300">/</span>
                  {isCurrent ? (
                    <span className="truncate text-stone-700">{label}</span>
                  ) : (
                    <Link
                      to={projectObjectivePath(projectSlug, item.slug)}
                      className="max-w-[32vw] truncate hover:text-stone-800 md:max-w-none"
                    >
                      {label}
                    </Link>
                  )}
                </span>
              )
            })}
          </div>
        )}
        typeIcon={<Hash size={14} />}
        title={objectiveChannel?.name}
        description={(
        <>
          {objective.description ? <p className="line-clamp-2">{objective.description}</p> : null}
          {objective.status_summary ? <p className="mt-1 line-clamp-2 text-stone-500">{objective.status_summary}</p> : null}
        </>
      )}
        status={(
          <>
            <Badge variant={statusVariant(objective.status)}>{objective.status.replace('_', ' ')}</Badge>
            <select
              value={objective.status}
              onChange={(e) => updateObjective.mutate({ status: e.target.value })}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="open">open</option>
              <option value="in_progress">in progress</option>
              <option value="blocked">blocked</option>
              <option value="done">done</option>
            </select>
          </>
        )}
        onRenameTitle={async (value) => { await updateChannel.mutateAsync({ name: value }) }}
        renamePending={updateChannel.isPending}
        context={(
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Progress</span>
              {editingProgress ? (
                <>
                  <input
                    autoFocus
                    type="number"
                    min={0}
                    max={100}
                    value={progressDraft}
                    onChange={(e) => setProgressDraft(e.target.value)}
                    onBlur={() => { void saveProgress(progressDraft) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void saveProgress(progressDraft)
                      }
                      if (e.key === 'Escape') {
                        setProgressDraft(String(currentProgress))
                        setEditingProgress(false)
                      }
                    }}
                    className="w-16 rounded-md border border-stone-300 px-2 py-1 text-sm text-stone-900 outline-none focus:ring-2 focus:ring-stone-900"
                  />
                  <span className="text-xs text-stone-400">%</span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingProgress(true)}
                  className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-sm font-medium text-stone-700 hover:border-stone-300 hover:text-stone-900"
                >
                  {currentProgress}%
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowKeyResultDialog(true)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-500 hover:border-stone-400 hover:text-stone-800"
                aria-label="Add key result"
                title="Add key result"
              >
                <Plus size={12} />
              </button>
              {keyResultsDraft.map((result, index) => (
                <span
                  key={`${result}-${index}`}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800"
                >
                  <span>{result}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Delete key result "${result}"?`)) return
                      const next = keyResultsDraft.filter((_, itemIndex) => itemIndex !== index)
                      setKeyResultsDraft(next)
                      updateObjective.mutate({ key_results: next })
                    }}
                    className="text-emerald-500 hover:text-emerald-700"
                    aria-label="Remove key result"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {childObjectives.map((item) => (
                <Link
                  key={item.id}
                  to={projectObjectivePath(projectSlug, item.slug)}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-700 hover:border-stone-300 hover:text-stone-900"
                >
                  <Hash size={11} className="text-stone-400" />
                  <span className="truncate">{[item.code, item.title].filter(Boolean).join(' · ')}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      >
        <ChannelTimeline items={timelineItems} />
        <WorkflowSlashComposer
          workspaceId={workspaceId}
          workflows={workflows}
          channelId={objective.channel_id}
          objectiveId={objective.id}
          draft={draft}
          setDraft={setDraft}
          onSend={() => postMessage.mutate(
            { content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
            { onSuccess: () => setDraft('') },
          )}
          pending={postMessage.isPending}
          placeholder="Move this objective forward, ask for help, or trigger a workflow with /…"
        />
      </ChannelShell>

      {showKeyResultDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-stone-950">Add key result</h2>
              <button
                type="button"
                onClick={() => {
                  setShowKeyResultDialog(false)
                  setNewKeyResult('')
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4">
              <label className="block text-sm text-stone-600">
                Key result
                <input
                  autoFocus
                  value={newKeyResult}
                  onChange={(e) => setNewKeyResult(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void addKeyResult()
                    }
                    if (e.key === 'Escape') {
                      setShowKeyResultDialog(false)
                      setNewKeyResult('')
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="Describe the concrete result to reach"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowKeyResultDialog(false)
                  setNewKeyResult('')
                }}
                className="rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void addKeyResult() }}
                disabled={!newKeyResult.trim() || updateObjective.isPending}
                className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
