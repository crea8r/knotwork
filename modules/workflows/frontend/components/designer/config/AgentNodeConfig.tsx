/**
 * Config panel for the unified 'agent' node type.
 * trust_level is now a float 0.0–1.0 (shown as a slider).
 * Confidence threshold, confidence rules, and checkpoints have been removed.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, BookOpenText, FileText, Gauge, Link2, Maximize2, Search, Users, X } from 'lucide-react'
import { useKnowledgeFile, useKnowledgeFiles, useSearchKnowledgeFiles } from "@modules/assets/frontend/api/knowledge"
import { useChannelParticipants } from '@modules/communication/frontend/api/channels'
import Btn from '@ui/components/Btn'
import { useAuthStore } from '@auth'

interface Props {
  node: {
    agent_ref?: string
    trust_level?: number
    registered_agent_id?: string | null
    operator_id?: string | null
    supervisor_id?: string | null
    config: Record<string, unknown>
  }
  onChange: (nodeFieldsPatch: Record<string, unknown>, configPatch?: Record<string, unknown>) => void
  predecessorNodes: { id: string; name: string }[]
  readOnly?: boolean
}

const TRUST_LABELS: [number, string][] = [
  [0.0, 'Ask supervisor'],
  [0.5, 'Review as needed'],
  [1.0, 'Operator decides'],
]

function trustLabel(val: number): string {
  if (val <= 0.1) return 'Ask supervisor early'
  if (val >= 0.9) return 'Operator moves ahead'
  if (val <= 0.4) return 'Check with supervisor'
  if (val <= 0.6) return 'Review as needed'
  return 'Operator decides more'
}

function assetDisplayName(path: string, titleByPath: Map<string, string>): string {
  const title = titleByPath.get(path)?.trim()
  if (title) return title
  const basename = path.split('/').filter(Boolean).pop()?.trim()
  return basename || path
}

function FlowConnector() {
  return (
    <div className="flex items-center gap-2 pl-3 py-0.5 text-gray-300" aria-hidden="true">
      <div className="h-3 w-px bg-gray-200" />
      <ArrowDown size={10} />
    </div>
  )
}

function FlowSection({
  step,
  title,
  icon,
  action,
  children,
  dataUi,
}: {
  step: number
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
  dataUi?: string
}) {
  return (
    <section data-ui={dataUi} className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
            {step}
          </span>
          <span className="flex-shrink-0 text-gray-400">
            {icon}
          </span>
          <p className="truncate text-sm font-medium text-gray-900">{title}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function AgentNodeConfig({ node, onChange, readOnly = false }: Props) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? ''
  const { data: files = [] } = useKnowledgeFiles()
  const { data: participants = [] } = useChannelParticipants(workspaceId)
  const config = node.config

  const registeredAgentId = node.registered_agent_id ?? null
  const operatorId = node.operator_id ?? null
  const supervisorId = node.supervisor_id ?? null
  const agentRef = node.agent_ref ?? ''
  const isHuman = agentRef === 'human'
  const trustLevel: number = typeof node.trust_level === 'number' ? node.trust_level : 0.5
  const operatorParticipantId = operatorId ?? (registeredAgentId ? `agent:${registeredAgentId}` : null)
  const supervisorMatchesOperatorAgent = !!operatorParticipantId && supervisorId === operatorParticipantId

  const paths: string[] = Array.isArray(config.knowledge_paths)
    ? config.knowledge_paths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const { data: searchedFiles = [] } = useSearchKnowledgeFiles(pickerQuery)
  const { data: previewFile } = useKnowledgeFile(previewPath)

  const titleByPath = useMemo(() => new Map(files.map((file) => [file.path, file.title])), [files])

  const setField = (patch: Record<string, unknown>) => onChange(patch)
  const setConfig = (patch: Record<string, unknown>) => onChange({}, patch)

  const selectValue = operatorParticipantId ?? ''
  const operatorNotFound = !!operatorParticipantId && !participants.some((participant) => participant.participant_id === operatorParticipantId)

  const instructionFieldKey = isHuman ? 'question' : 'system_prompt'
  const instructionValue = (config[instructionFieldKey] as string) ?? ''
  const instructionPlaceholder = isHuman
    ? 'Describe what the operator should do.'
    : 'Describe what this node should do.'
  const instructionPreview = instructionValue.length > 220
    ? `${instructionValue.slice(0, 220)}…`
    : instructionValue

  function handleAgentSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    const participant = participants.find((item) => item.participant_id === val)
    if (!participant) {
      setField({ agent_ref: '', registered_agent_id: null, operator_id: null })
      return
    }
    if (participant.kind === 'human') {
      setField({ agent_ref: 'human', registered_agent_id: null, operator_id: participant.participant_id })
      return
    }
    const rawAgentId = participant.participant_id.split(':', 2)[1] ?? ''
    setField({
      registered_agent_id: rawAgentId,
      operator_id: participant.participant_id,
      ...(supervisorId === participant.participant_id ? { supervisor_id: null } : {}),
    })
  }

  const pickerResults = pickerQuery.trim() ? searchedFiles : files

  function toggleKnowledgePath(path: string) {
    setConfig({
      knowledge_paths: paths.includes(path)
        ? paths.filter((p) => p !== path)
        : [...paths, path],
    })
  }

  function openAssetPicker(targetPath: string | null = null) {
    setPickerQuery('')
    setPreviewPath(targetPath ?? paths[0] ?? null)
    setPickerOpen(true)
  }

  function openPromptDialog() {
    setPromptDraft(instructionValue)
    setPromptDialogOpen(true)
  }

  function savePromptDialog() {
    setConfig({ [instructionFieldKey]: promptDraft })
    setPromptDialogOpen(false)
  }

  return (
    <div className="space-y-3 text-sm">
      <section data-ui="workflow.editor.inspector.agent.operator" className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
          <Users size={13} />
          <span>Operator</span>
        </div>
        <select
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          value={selectValue}
          disabled={readOnly}
          onChange={handleAgentSelect}
        >
          <option value="">Select operator</option>
          {participants.map((participant) => (
            <option key={participant.participant_id} value={participant.participant_id}>
              {participant.display_name} ({participant.kind})
            </option>
          ))}
        </select>
        {operatorNotFound && (
          <p className="text-xs text-amber-600">
            The previously selected operator is no longer available.
          </p>
        )}
        {participants.length === 0 && (
          <p className="text-xs text-gray-400">
            No participants available yet.
          </p>
        )}
      </section>

      <FlowSection
        step={1}
        title="Guideline assets"
        icon={<BookOpenText size={14} />}
        action={!readOnly ? (
          <Btn
            size="sm"
            variant="secondary"
            onClick={() => openAssetPicker()}
            aria-label="Connect assets"
            title="Connect assets"
            className="px-2 py-1.5"
          >
            <Link2 size={13} />
          </Btn>
        ) : undefined}
        dataUi="workflow.editor.inspector.agent.assets"
      >
        {paths.length === 0 ? (
          <div className="flex min-h-[56px] items-center rounded-lg bg-gray-50 px-3 text-xs text-gray-400">
            No assets connected
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {paths.map((path) => (
              <div
                key={path}
                title={path}
                className="inline-flex max-w-full items-stretch rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900"
              >
                <button
                  type="button"
                  onClick={() => openAssetPicker(path)}
                  className="inline-flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-left hover:bg-amber-100/70"
                  aria-label={`Open ${assetDisplayName(path, titleByPath)}`}
                  title={`Open ${assetDisplayName(path, titleByPath)}`}
                >
                  <BookOpenText size={11} className="flex-shrink-0 text-amber-600" />
                  <span className="truncate">{assetDisplayName(path, titleByPath)}</span>
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleKnowledgePath(path)
                    }}
                    className="border-l border-amber-200 px-2 text-amber-300 hover:text-red-500"
                    aria-label={`Disconnect ${assetDisplayName(path, titleByPath)}`}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </FlowSection>

      <FlowConnector />

      <FlowSection
        step={2}
        title="Task instruction"
        icon={<FileText size={14} />}
        action={(
          <button
            type="button"
            onClick={openPromptDialog}
            className="inline-flex items-center rounded-lg p-1.5 text-brand-600 hover:bg-brand-50 hover:text-brand-700"
            aria-label={readOnly ? 'View task instruction' : 'Edit task instruction'}
            title={readOnly ? 'View task instruction' : 'Edit task instruction'}
          >
            <Maximize2 size={11} />
          </button>
        )}
        dataUi="workflow.editor.inspector.agent.instruction"
      >
        {instructionValue ? (
          <div className="min-h-[76px] rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-700 whitespace-pre-wrap break-words">
            {instructionPreview}
          </div>
        ) : (
          <div className="flex min-h-[76px] items-center rounded-lg bg-gray-50 px-3 text-xs italic text-gray-400">
            No task instruction yet
          </div>
        )}
      </FlowSection>

      {!isHuman && (
        <>
          <FlowConnector />

          <FlowSection
            step={3}
            title="Confidence level"
            icon={<Gauge size={14} />}
            dataUi="workflow.editor.inspector.agent.confidence"
          >
            <div className="space-y-2.5 rounded-lg bg-gray-50 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  {trustLabel(trustLevel)}
                </span>
                <span className="text-xs font-medium text-gray-500">
                  {trustLevel.toFixed(1)}
                </span>
              </div>
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-600">
                  Ask supervisor
                </span>
                <div className="h-1.5 rounded-full bg-gradient-to-r from-rose-200 via-amber-200 to-emerald-200" />
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-600">
                  Operator decides
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                className="w-full accent-brand-500"
                value={trustLevel}
                disabled={readOnly}
                onChange={e => setField({ trust_level: parseFloat(e.target.value) })}
              />
              <div className="flex justify-between text-[11px] text-gray-400">
                {TRUST_LABELS.map(([v, label]) => (
                  <span key={v}>{label}</span>
                ))}
              </div>
              <div data-ui="workflow.editor.inspector.agent.confidence.supervisor" className="space-y-2 border-t border-gray-200 pt-2">
                <label className="block text-xs font-medium text-gray-700">Supervisor</label>
                <select
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                  value={supervisorId ?? ''}
                  disabled={readOnly}
                  onChange={(e) => setField({ supervisor_id: e.target.value || null })}
                >
                  <option value="">Select supervisor</option>
                  {participants.map((participant) => {
                    const disabled = !!operatorParticipantId && participant.participant_id === operatorParticipantId
                    return (
                      <option key={participant.participant_id} value={participant.participant_id} disabled={disabled}>
                        {participant.display_name} ({participant.kind})
                        {disabled ? ' — already the operator' : ''}
                      </option>
                    )
                  })}
                </select>
                {supervisorMatchesOperatorAgent ? (
                  <p className="text-xs text-red-600">
                    Supervisor cannot be the same participant as the operator.
                  </p>
                ) : null}
              </div>
            </div>
          </FlowSection>
        </>
      )}

      {promptDialogOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <p className="text-sm font-semibold text-gray-900">Task instruction</p>
              <button onClick={() => setPromptDialogOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {readOnly ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">
                  {instructionValue || <span className="italic text-gray-400">(empty)</span>}
                </p>
              ) : (
                <textarea
                  autoFocus
                  className="h-full min-h-[240px] w-full resize-none rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400"
                  placeholder={instructionPlaceholder}
                  value={promptDraft}
                  onChange={e => setPromptDraft(e.target.value)}
                />
              )}
            </div>
            {!readOnly && (
              <div className="flex flex-shrink-0 justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <button
                  onClick={() => setPromptDialogOpen(false)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={savePromptDialog}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Connect assets</h2>
                <p className="mt-0.5 text-xs text-gray-400">Search, preview, then connect files to this node.</p>
              </div>
              <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[320px,minmax(0,1fr)]">
              <div className="border-r p-4">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Search assets…"
                    className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div className="mt-3 h-[calc(80vh-11rem)] space-y-1 overflow-y-auto pr-1">
                  {pickerResults.length === 0 && (
                    <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-400">
                      No assets found.
                    </p>
                  )}
                  {pickerResults.map((file) => {
                    const isSelected = previewPath === file.path
                    const alreadyAdded = paths.includes(file.path)
                    return (
                      <button
                        key={file.path}
                        onClick={() => setPreviewPath(file.path)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          isSelected ? 'border-brand-300 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <p className="truncate text-sm font-medium text-gray-800">{file.title}</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-gray-400">{file.path}</p>
                        {alreadyAdded && <p className="mt-1 text-[11px] text-brand-600">Connected</p>}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex min-h-0 flex-col">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{previewFile?.title ?? 'Asset preview'}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-gray-400">{previewPath ?? 'Select an asset'}</p>
                  </div>
                  <Btn
                    size="sm"
                    disabled={!previewPath || readOnly}
                    onClick={() => { if (previewPath) toggleKnowledgePath(previewPath) }}
                  >
                    {previewPath && paths.includes(previewPath) ? 'Disconnect' : 'Connect'}
                  </Btn>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {!previewPath && (
                    <div className="flex h-full items-center justify-center text-sm text-gray-400">
                      Select an asset to preview it.
                    </div>
                  )}
                  {previewPath && !previewFile && (
                    <div className="flex h-full items-center justify-center text-sm text-gray-400">
                      Loading preview…
                    </div>
                  )}
                  {previewFile && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <pre className="whitespace-pre-wrap break-words text-sm text-gray-700">
                        {previewFile.content || '(empty file)'}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
