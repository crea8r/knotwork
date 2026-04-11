/**
 * Config panel for the unified 'agent' node type.
 * trust_level is now a float 0.0–1.0 (shown as a slider).
 * Confidence threshold, confidence rules, and checkpoints have been removed.
 */
import { useState } from 'react'
import { Search, X, Maximize2 } from 'lucide-react'
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
  [0.0, 'Always ask'],
  [0.5, 'Supervised'],
  [1.0, 'Fully autonomous'],
]

function trustLabel(val: number): string {
  if (val <= 0.1) return 'Always ask'
  if (val >= 0.9) return 'Fully autonomous'
  if (val <= 0.4) return 'Low autonomy'
  if (val <= 0.6) return 'Supervised'
  return 'High autonomy'
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

  const paths: string[] = (config.knowledge_paths as string[]) ?? []
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const { data: searchedFiles = [] } = useSearchKnowledgeFiles(pickerQuery)
  const { data: previewFile } = useKnowledgeFile(previewPath)

  const setField = (patch: Record<string, unknown>) => onChange(patch)
  const setConfig = (patch: Record<string, unknown>) => onChange({}, patch)

  const selectValue = operatorParticipantId ?? ''
  const selectedOperator = operatorParticipantId
    ? participants.find((participant) => participant.participant_id === operatorParticipantId)
    : undefined
  const operatorNotFound = !!operatorParticipantId && !selectedOperator

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

  return (
    <div className="space-y-4 text-sm">
      {/* Operator selector */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Operator</label>
        <select
          className="border rounded px-2 py-1 text-sm w-full bg-white"
          value={selectValue}
          disabled={readOnly}
          onChange={handleAgentSelect}
        >
          <option value="">— Select operator —</option>
          {participants.map((participant) => (
            <option key={participant.participant_id} value={participant.participant_id}>
              {participant.display_name} ({participant.kind})
            </option>
          ))}
        </select>
        {operatorNotFound && (
          <p className="text-xs text-amber-600 mt-1">
            The previously selected operator is no longer available. Please select a new one.
          </p>
        )}
        {participants.length === 0 && (
          <p className="text-xs text-gray-400 mt-1">
            No participants available yet.
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Supervisor</label>
        <select
          className="border rounded px-2 py-1 text-sm w-full bg-white"
          value={supervisorId ?? ''}
          disabled={readOnly}
          onChange={(e) => setField({ supervisor_id: e.target.value || null })}
        >
          <option value="">— Select supervisor —</option>
          {participants.map((participant) => {
            const disabled = !!operatorParticipantId
              && participant.kind === 'agent'
              && participant.participant_id === operatorParticipantId
            return (
              <option key={participant.participant_id} value={participant.participant_id} disabled={disabled}>
                {participant.display_name} ({participant.kind})
                {disabled ? ' — already the operator' : ''}
              </option>
            )
          })}
        </select>
        {supervisorMatchesOperatorAgent ? (
          <p className="text-xs text-red-600 mt-1">
            Supervisor cannot be the same agent as the node operator.
          </p>
        ) : (
          <p className="text-xs text-gray-400 mt-1">
            Humans may supervise themselves. Agents must escalate to a different participant.
          </p>
        )}
      </div>

      {/* Trust level slider (not shown for human nodes) */}
      {!isHuman && (
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs text-gray-500">Autonomy level</label>
            <span className="text-xs font-medium text-gray-700">
              {trustLevel.toFixed(1)} — {trustLabel(trustLevel)}
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.1}
            className="w-full accent-brand-500"
            value={trustLevel}
            disabled={readOnly}
            onChange={e => setField({ trust_level: parseFloat(e.target.value) })}
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5">
            {TRUST_LABELS.map(([v, label]) => (
              <span key={v}>{label}</span>
            ))}
          </div>
        </div>
      )}

      {/* System prompt / question */}
      {(() => {
        const fieldKey = isHuman ? 'question' : 'system_prompt'
        const label = isHuman ? 'Question for operator' : 'System prompt'
        const placeholder = isHuman ? 'Awaiting human review.' : 'Instructions for the agent…'
        const value = (config[fieldKey] as string) ?? ''
        const PREVIEW_LEN = 240
        const preview = value.length > PREVIEW_LEN ? value.slice(0, PREVIEW_LEN) + '…' : value

        function openDialog() {
          setPromptDraft(value)
          setPromptDialogOpen(true)
        }
        function saveDialog() {
          setConfig({ [fieldKey]: promptDraft })
          setPromptDialogOpen(false)
        }

        return (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">{label}</label>
              <button
                type="button"
                onClick={openDialog}
                className="inline-flex items-center gap-1 text-xs text-brand-500 hover:text-brand-700"
              >
                <Maximize2 size={11} />
                {readOnly ? 'Detail' : 'Edit'}
              </button>
            </div>
            {value ? (
              <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600 whitespace-pre-wrap break-words leading-relaxed cursor-default min-h-[2.5rem]">
                {preview}
              </p>
            ) : (
              <p className="rounded border border-dashed border-gray-200 px-2 py-1.5 text-xs text-gray-400 italic min-h-[2.5rem]">
                {placeholder}
              </p>
            )}

            {promptDialogOpen && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4">
                <div className="flex flex-col w-full max-w-xl max-h-[85vh] rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-900">{label}</p>
                    <button onClick={() => setPromptDialogOpen(false)} className="text-gray-400 hover:text-gray-600">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5">
                    {readOnly ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
                        {value || <span className="italic text-gray-400">(empty)</span>}
                      </p>
                    ) : (
                      <textarea
                        autoFocus
                        className="w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 resize-none"
                        style={{ minHeight: '240px', height: '100%' }}
                        placeholder={placeholder}
                        value={promptDraft}
                        onChange={e => setPromptDraft(e.target.value)}
                      />
                    )}
                  </div>
                  {!readOnly && (
                    <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
                      <button onClick={() => setPromptDialogOpen(false)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                        Cancel
                      </button>
                      <button onClick={saveDialog}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                        Save
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Knowledge paths */}
      {!isHuman && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Knowledge paths (Handbook)</label>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {paths.length === 0 && <p className="text-xs text-gray-400">No handbook files selected.</p>}
              {paths.map((path) => (
                <span key={path} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  <span className="font-mono">{path}</span>
                  {!readOnly && (
                    <button onClick={() => toggleKnowledgePath(path)} className="text-gray-300 hover:text-red-500">
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <Btn size="sm" variant="secondary" disabled={readOnly} onClick={() => { setPickerOpen(true); setPreviewPath(paths[0] ?? null) }}>
              Browse Handbook Files
            </Btn>
          </div>
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Select Handbook Files</h2>
                <p className="mt-0.5 text-xs text-gray-400">Search, preview, then add files to this node.</p>
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
                    placeholder="Search handbook files…"
                    className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div className="mt-3 h-[calc(80vh-11rem)] overflow-y-auto space-y-1 pr-1">
                  {pickerResults.length === 0 && (
                    <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-400">
                      No handbook files found.
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
                        {alreadyAdded && <p className="mt-1 text-[11px] text-brand-600">Already selected</p>}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex min-h-0 flex-col">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{previewFile?.title ?? 'Preview'}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-gray-400">{previewPath ?? 'Select a file'}</p>
                  </div>
                  <Btn
                    size="sm"
                    disabled={!previewPath || readOnly}
                    onClick={() => { if (previewPath) toggleKnowledgePath(previewPath) }}
                  >
                    {previewPath && paths.includes(previewPath) ? 'Remove' : 'Add'}
                  </Btn>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {!previewPath && (
                    <div className="flex h-full items-center justify-center text-sm text-gray-400">
                      Select a handbook file to preview it.
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
