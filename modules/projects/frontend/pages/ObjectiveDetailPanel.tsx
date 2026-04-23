import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Hash, Megaphone, Pencil, Plus, X } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { usePostChannelMessage } from '@modules/communication/frontend/api/channels'
import { useGraphs } from "@modules/workflows/frontend/api/graphs"
import { useUpdateObjective } from "@modules/projects/frontend/api/projects"
import { ChannelTimeline } from '@modules/communication/frontend/components/ChannelFrame'
import ChannelParticipantsPanel from '@modules/communication/frontend/components/ChannelParticipantsPanel'
import WorkflowSlashComposer from '@modules/communication/frontend/components/WorkflowSlashComposer'
import { useChannelTimeline } from '@modules/communication/frontend/components/useChannelTimeline'
import { projectObjectivePath, projectPath } from '@app-shell/paths'
import { useRegisterShellTopBarSlots } from '@app-shell/ShellTopBarSlots'
import {
  SHELL_ICON_BUTTON_CLASS,
  SHELL_RAIL_SUBTITLE_CLASS,
  SHELL_RAIL_TITLE_CLASS,
} from '@app-shell/layoutChrome'
import type { ProjectOutletContext } from './ProjectDetailPage'

type ObjectiveStatus = 'open' | 'in_progress' | 'blocked' | 'done'

export default function ObjectiveDetailPanel() {
  const { workspaceId, project, projectSlug, objectives } = useOutletContext<ProjectOutletContext>()
  const { objectiveSlug = '' } = useParams<{ objectiveSlug: string }>()
  const objective = objectives.find((item) => item.slug === objectiveSlug)
  const { data: workflows = [] } = useGraphs(workspaceId)
  const postMessage = usePostChannelMessage(workspaceId, objective?.channel_id ?? '')
  const updateObjective = useUpdateObjective(workspaceId, objective?.id ?? '')
  const currentProgress = objective?.progress_percent ?? 0

  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const { items: timelineItems } = useChannelTimeline(workspaceId, objective?.channel_id ?? '')
  const [progressDraft, setProgressDraft] = useState(String(currentProgress))
  const [keyResultsDraft, setKeyResultsDraft] = useState(objective?.key_results ?? [])
  const [showKeyResultDialog, setShowKeyResultDialog] = useState(false)
  const [newKeyResult, setNewKeyResult] = useState('')
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showBroadcastDialog, setShowBroadcastDialog] = useState(false)
  const [objectiveTitleDraft, setObjectiveTitleDraft] = useState(objective?.title ?? '')
  const [objectiveDescriptionDraft, setObjectiveDescriptionDraft] = useState(objective?.description ?? '')
  const [objectiveStatusDraft, setObjectiveStatusDraft] = useState<ObjectiveStatus>(objective?.status ?? 'open')
  const [broadcastDraft, setBroadcastDraft] = useState(objective?.status_summary ?? '')

  useEffect(() => {
    setProgressDraft(String(currentProgress))
    setKeyResultsDraft(objective?.key_results ?? [])
    setShowKeyResultDialog(false)
    setNewKeyResult('')
    setShowSettingsDialog(false)
    setShowBroadcastDialog(false)
    setObjectiveTitleDraft(objective?.title ?? '')
    setObjectiveDescriptionDraft(objective?.description ?? '')
    setObjectiveStatusDraft((objective?.status ?? 'open') as ObjectiveStatus)
    setBroadcastDraft(objective?.status_summary ?? '')
  }, [currentProgress, objective?.description, objective?.id, objective?.key_results, objective?.status, objective?.status_summary, objective?.title])

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

  const objectiveTitle = objective?.title ?? 'Objective'
  const breadcrumbLabel = useMemo(() => {
    if (!objective) return project.title
    return [
      project.title,
      ...objectivePath.map((item) => item.code ? `${item.code} · ${item.title}` : item.title),
    ].join(' / ')
  }, [objective, objectivePath, project.title])
  const breadcrumbItems = useMemo(() => {
    if (!objective) {
      return [{ label: project.title, to: projectPath(projectSlug), current: true }]
    }
    return [
      { label: project.title, to: projectPath(projectSlug), current: false },
      ...objectivePath.map((item, index) => ({
        label: item.code ? `${item.code} · ${item.title}` : item.title,
        to: index === objectivePath.length - 1 ? null : projectObjectivePath(projectSlug, item.slug),
        current: index === objectivePath.length - 1,
      })),
    ]
  }, [objective, objectivePath, project.title, projectSlug])
  const headerSummaryLabel = useMemo(() => {
    const update = objective?.status_summary?.trim()
    if (update) return update
    const description = objective?.description?.trim()
    if (description) return description
    return breadcrumbLabel
  }, [breadcrumbLabel, objective?.description, objective?.status_summary])
  const shellLeading = useMemo(() => {
    if (!objective) return null
    return (
      <div data-ui="objectives.detail.header.leading" className="flex min-w-0 items-center gap-3">
        <div
          data-ui="objectives.detail.header.progress-icon"
          className="relative h-9 w-9 shrink-0"
          title={`${currentProgress}% complete`}
          aria-label={`${currentProgress}% complete`}
          style={{
            background: `conic-gradient(rgb(14 165 233) ${Math.max(0, Math.min(100, currentProgress)) * 3.6}deg, rgb(231 229 228) 0deg)`,
            borderRadius: '9999px',
          }}
        >
          <span className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white text-[9px] font-semibold leading-none text-stone-700">
            {currentProgress}%
          </span>
        </div>
        <div className="min-w-0">
          <div data-ui="objectives.detail.header.title-row" className="flex min-w-0 items-center gap-1.5">
            <p data-ui="objectives.detail.header.title" className={SHELL_RAIL_TITLE_CLASS}>
              {objectiveTitle}
            </p>
            <button
              type="button"
              onClick={() => setShowSettingsDialog(true)}
              data-ui="objectives.detail.header.edit"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              aria-label="Edit objective settings"
              title="Edit objective settings"
            >
              <Pencil size={12} />
            </button>
          </div>
          <p
            data-ui="objectives.detail.header.summary"
            title={headerSummaryLabel}
            className={`${SHELL_RAIL_SUBTITLE_CLASS} mt-0.5 block max-w-full`}
          >
            {headerSummaryLabel}
          </p>
        </div>
      </div>
    )
  }, [currentProgress, headerSummaryLabel, objective, objectiveTitle])

  const shellActions = useMemo(() => {
    if (!objective) return null
    return (
      <button
        type="button"
        onClick={() => {
          setBroadcastDraft(objective.status_summary ?? '')
          setShowBroadcastDialog(true)
        }}
        data-ui="objectives.detail.header.broadcast"
        className={SHELL_ICON_BUTTON_CLASS}
        aria-label="Broadcast objective update"
        title="Broadcast objective update"
      >
        <Megaphone size={14} />
      </button>
    )
  }, [objective])

  useRegisterShellTopBarSlots({
    leading: shellLeading,
    actions: shellActions,
    snapshot: objective
      ? {
          title: objectiveTitle,
          subtitle: project.title,
          iconKind: 'objective',
        }
      : null,
  })

  async function addKeyResult() {
    const value = newKeyResult.trim()
    if (!value) return
    const next = [...keyResultsDraft, value]
    setKeyResultsDraft(next)
    setShowKeyResultDialog(false)
    setNewKeyResult('')
    await updateObjective.mutateAsync({ key_results: next })
  }

  function resetSettingsDrafts() {
    if (!objective) return
    setObjectiveTitleDraft(objective.title)
    setObjectiveDescriptionDraft(objective.description ?? '')
    setObjectiveStatusDraft(objective.status as ObjectiveStatus)
    setProgressDraft(String(currentProgress))
  }

  function resetBroadcastDraft() {
    if (!objective) return
    setBroadcastDraft(objective.status_summary ?? '')
  }

  async function saveObjectiveSettings() {
    if (!objective) return
    const nextTitle = objectiveTitleDraft.trim()
    if (!nextTitle) return
    const nextDescription = objectiveDescriptionDraft.trim()
    const payload: {
      title?: string
      description?: string
      status?: string
      progress_percent?: number
    } = {}
    const nextProgress = Math.max(0, Math.min(100, Number(progressDraft) || 0))
    if (nextTitle !== objective.title) {
      payload.title = nextTitle
    }
    if (nextDescription !== (objective.description ?? '').trim()) {
      payload.description = nextDescription
    }
    if (objectiveStatusDraft !== objective.status) {
      payload.status = objectiveStatusDraft
    }
    if (nextProgress !== currentProgress) {
      payload.progress_percent = nextProgress
    }
    setProgressDraft(String(nextProgress))
    if (!payload.title && payload.description === undefined && !payload.status && payload.progress_percent === undefined) {
      setShowSettingsDialog(false)
      return
    }
    await updateObjective.mutateAsync(payload)
    setShowSettingsDialog(false)
  }

  async function broadcastObjectiveUpdate() {
    if (!objective) return
    const summary = broadcastDraft.trim()
    if (!summary) return
    const tasks: Promise<unknown>[] = [
      updateObjective.mutateAsync({ status_summary: summary }),
    ]
    if (objective.channel_id) {
      tasks.push(
        postMessage.mutateAsync({
          content: summary,
          role: 'user',
          author_type: 'human',
          author_name: 'You',
          metadata: {
            kind: 'objective_status_update',
            objective_id: objective.id,
            project_id: project.id,
          },
        }),
      )
    }
    await Promise.all(tasks)
    setShowBroadcastDialog(false)
  }

  if (!objective) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-stone-500">
        Objective not found in this project.
      </div>
    )
  }

  return (
    <div data-ui="objectives.detail.page" className="flex h-full min-h-0 flex-col bg-white">
      <div data-ui="objectives.detail.summary" className="shrink-0 border-b border-stone-200 bg-white px-4 py-3">
        <div
          data-ui="objectives.detail.summary.breadcrumbs"
          className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm text-stone-500"
        >
          {breadcrumbItems.map((item, index) => (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 ? <span aria-hidden="true" className="shrink-0 text-stone-300">/</span> : null}
              {item.to ? (
                <Link
                  to={item.to}
                  data-ui="objectives.detail.summary.breadcrumb"
                  title={item.label}
                  className="min-w-0 max-w-[9rem] shrink truncate rounded-sm text-stone-500 underline-offset-4 transition-colors hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  data-ui="objectives.detail.summary.breadcrumb.current"
                  title={item.label}
                  aria-current="page"
                  className="min-w-0 flex-1 truncate font-medium text-stone-700"
                >
                  {item.label}
                </span>
              )}
            </Fragment>
          ))}
        </div>

        <div data-ui="objectives.detail.key-results" className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowKeyResultDialog(true)}
              data-ui="objectives.detail.key-results.add"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-500 hover:border-stone-400 hover:text-stone-800"
              aria-label="Add key result"
              title="Add key result"
            >
              <Plus size={12} />
            </button>
            {keyResultsDraft.map((result, index) => (
              <span
                key={`${result}-${index}`}
                data-ui="objectives.detail.key-results.item"
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
                  data-ui="objectives.detail.key-results.remove"
                  className="text-emerald-500 hover:text-emerald-700"
                  aria-label="Remove key result"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {keyResultsDraft.length === 0 ? (
              <p data-ui="objectives.detail.key-results.empty" className="text-sm text-stone-500">
                No key results yet.
              </p>
            ) : null}
          </div>
        </div>

        {childObjectives.length > 0 ? (
          <div data-ui="objectives.detail.controls" className="mt-3 space-y-3">
            <div data-ui="objectives.detail.child-objectives" className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Children</span>
              {childObjectives.map((item) => (
                <Link
                  key={item.id}
                  to={projectObjectivePath(projectSlug, item.slug)}
                  data-ui="objectives.detail.child-objective"
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-700 hover:border-stone-300 hover:text-stone-900"
                >
                  <Hash size={11} className="text-stone-400" />
                  <span className="truncate">{[item.code, item.title].filter(Boolean).join(' · ')}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>

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
        inputRef={inputRef}
      />

      {showSettingsDialog && (
        <div
          data-ui="objectives.detail.settings.dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <div
            data-ui="objectives.detail.settings.surface"
            className="w-full max-w-xl rounded-[28px] bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="objective-settings-title"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="objective-settings-title" className="text-base font-semibold text-stone-950">
                  Edit objective
                </h2>
                <p className="mt-1 text-sm text-stone-500">Update the title, description, progress, status, and participants for this objective.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSettingsDialog(false)
                  resetSettingsDrafts()
                }}
                data-ui="objectives.detail.settings.close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Close objective settings"
              >
                <X size={16} />
              </button>
            </div>
            <div data-ui="objectives.detail.settings.form" className="mt-4 space-y-4">
              <label data-ui="objectives.detail.settings.title-field" className="block text-sm text-stone-600">
                Objective name
                <input
                  autoFocus
                  value={objectiveTitleDraft}
                  onChange={(event) => setObjectiveTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
                      event.preventDefault()
                      void saveObjectiveSettings()
                    }
                    if (event.key === 'Escape') {
                      setShowSettingsDialog(false)
                      resetSettingsDrafts()
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="Objective name"
                />
              </label>
              <label data-ui="objectives.detail.settings.description-field" className="block text-sm text-stone-600">
                Description
                <textarea
                  rows={4}
                  value={objectiveDescriptionDraft}
                  onChange={(event) => setObjectiveDescriptionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setShowSettingsDialog(false)
                      resetSettingsDrafts()
                    }
                  }}
                  className="mt-1 w-full resize-none rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="Describe the intent of this objective"
                />
              </label>
              <label data-ui="objectives.detail.settings.progress-field" className="block text-sm text-stone-600">
                Progress
                <div className="mt-1 flex items-center gap-2">
                  <input
                    value={progressDraft}
                    onChange={(event) => setProgressDraft(event.target.value.replace(/[^\d]/g, ''))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
                        event.preventDefault()
                        void saveObjectiveSettings()
                      }
                      if (event.key === 'Escape') {
                        setShowSettingsDialog(false)
                        resetSettingsDrafts()
                      }
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    spellCheck={false}
                    className="w-24 rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                    placeholder="0"
                    aria-label="Objective progress percent"
                  />
                  <span className="text-sm text-stone-500">%</span>
                  <span className="text-xs text-stone-400">0 to 100</span>
                </div>
              </label>
              <label data-ui="objectives.detail.settings.status-field" className="block text-sm text-stone-600">
                Status
                <select
                  value={objectiveStatusDraft}
                  onChange={(event) => setObjectiveStatusDraft(event.target.value as ObjectiveStatus)}
                  className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:ring-2 focus:ring-stone-900"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="done">Done</option>
                </select>
              </label>
              {objective.channel_id ? (
                <div
                  data-ui="objectives.detail.settings.participants"
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-3"
                >
                  <p className="text-sm font-medium text-stone-700">Participants</p>
                  <div className="mt-2">
                    <ChannelParticipantsPanel workspaceId={workspaceId} channelId={objective.channel_id} />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSettingsDialog(false)
                  resetSettingsDrafts()
                }}
                data-ui="objectives.detail.settings.cancel"
                className="rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void saveObjectiveSettings() }}
                data-ui="objectives.detail.settings.save"
                disabled={!objectiveTitleDraft.trim() || updateObjective.isPending}
                className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showBroadcastDialog && (
        <div
          data-ui="objectives.detail.broadcast.dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <div
            data-ui="objectives.detail.broadcast.surface"
            className="w-full max-w-xl rounded-[28px] bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="objective-broadcast-title"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="objective-broadcast-title" className="text-base font-semibold text-stone-950">
                  Broadcast update
                </h2>
                <p className="mt-1 text-sm text-stone-500">Share the latest objective update and pin it as the current summary.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBroadcastDialog(false)
                  resetBroadcastDraft()
                }}
                data-ui="objectives.detail.broadcast.close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Close update dialog"
              >
                <X size={16} />
              </button>
            </div>
            <div data-ui="objectives.detail.broadcast.form" className="mt-4 space-y-4">
              <label data-ui="objectives.detail.broadcast.summary-field" className="block text-sm text-stone-600">
                Update
                <textarea
                  rows={5}
                  value={broadcastDraft}
                  onChange={(event) => setBroadcastDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setShowBroadcastDialog(false)
                      resetBroadcastDraft()
                    }
                  }}
                  className="mt-1 w-full resize-none rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="Announce the latest objective update"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowBroadcastDialog(false)
                  resetBroadcastDraft()
                }}
                data-ui="objectives.detail.broadcast.cancel"
                className="rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void broadcastObjectiveUpdate() }}
                data-ui="objectives.detail.broadcast.send"
                disabled={!broadcastDraft.trim() || updateObjective.isPending || postMessage.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                <Megaphone size={14} />
                Broadcast
              </button>
            </div>
          </div>
        </div>
      )}

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
                  onChange={(event) => setNewKeyResult(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void addKeyResult()
                    }
                    if (event.key === 'Escape') {
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
