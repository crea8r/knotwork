/**
 * Slide-in panel showing the input of a run.
 * In draft mode: editable form with Save button.
 * In other modes: read-only with "Clone as draft" button.
 */
import { useState } from 'react'
import { X, Copy, Save } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCloneRun, useUpdateRunInput } from "@modules/workflows/frontend/api/runs"
import Btn from '@ui/components/Btn'
import type { GraphDefinition } from '@data-models'

interface Props {
  runId: string
  workspaceId: string
  runStatus: string
  input: Record<string, unknown>
  definition: GraphDefinition
  onClose: () => void
  onInputSaved?: () => void
}

export default function RunInputPanel({
  runId, workspaceId, runStatus, input, definition, onClose, onInputSaved,
}: Props) {
  const navigate = useNavigate()
  const clone = useCloneRun(workspaceId)
  const updateInput = useUpdateRunInput(workspaceId)
  const isDraft = runStatus === 'draft'

  const schema = definition.input_schema ?? []
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of schema) {
      init[f.name] = input[f.name] != null ? String(input[f.name]) : ''
    }
    return init
  })
  const [rawJson, setRawJson] = useState(() =>
    schema.length === 0 ? JSON.stringify(input, null, 2) : ''
  )
  const [saved, setSaved] = useState(false)

  async function handleClone() {
    const draft = await clone.mutateAsync(runId)
    onClose()
    navigate(`/runs/${draft.id}`)
  }

  function handleSave() {
    let newInput: Record<string, unknown>
    if (schema.length > 0) {
      newInput = {}
      for (const f of schema) {
        const raw = values[f.name] ?? ''
        newInput[f.name] = f.type === 'number' ? Number(raw) : raw
      }
    } else {
      try {
        newInput = JSON.parse(rawJson)
      } catch {
        alert('Invalid JSON')
        return
      }
    }
    updateInput.mutate({ runId, input: newInput }, {
      onSuccess: () => { setSaved(true); onInputSaved?.() },
    })
  }

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <div>
          <p className="font-semibold text-sm text-gray-900">Run Input</p>
          {isDraft && <p className="text-xs text-amber-600 mt-0.5">Draft — editable</p>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {schema.length > 0 ? (
          schema.map((field) => (
            <div key={field.name}>
              <p className="text-xs font-semibold text-gray-500 mb-1">
                {field.label}
                {field.required && <span className="text-red-400 ml-0.5">*</span>}
              </p>
              {field.description && (
                <p className="text-xs text-gray-400 mb-1">{field.description}</p>
              )}
              {isDraft ? (
                field.type === 'textarea' ? (
                  <textarea
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 leading-relaxed min-h-[80px] resize-y focus:outline-none focus:border-brand-400"
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  />
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-brand-400"
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  />
                )
              ) : (
                <div className={`bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm text-gray-800 ${field.type === 'textarea' ? 'whitespace-pre-wrap leading-relaxed min-h-[80px]' : ''}`}>
                  {input[field.name] != null
                    ? String(input[field.name])
                    : <span className="text-gray-300 italic">empty</span>}
                </div>
              )}
            </div>
          ))
        ) : isDraft ? (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">Input (JSON)</p>
            <textarea
              className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono min-h-[200px] resize-y focus:outline-none focus:border-brand-400"
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">Input (JSON)</p>
            <pre className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t px-4 py-3 bg-gray-50">
        {isDraft ? (
          <div className="flex items-center justify-between">
            {saved
              ? <span className="text-xs text-green-600">Input saved</span>
              : <span className="text-xs text-gray-400">Edit fields then save</span>}
            <Btn size="sm" loading={updateInput.isPending} onClick={handleSave}>
              <Save size={13} className="mr-1.5" /> Save input
            </Btn>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Read-only — clone to edit</p>
            <Btn size="sm" loading={clone.isPending} onClick={handleClone}>
              <Copy size={13} className="mr-1.5" /> Clone as draft
            </Btn>
          </div>
        )}
      </div>
    </div>
  )
}
