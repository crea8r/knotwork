import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTriggerRun } from '@/api/runs'
import { useAuthStore } from '@/store/auth'
import Btn from '@/components/shared/Btn'
import type { GraphDefinition, InputFieldDef } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

interface Props {
  graphId: string
  definition: GraphDefinition
  onClose: () => void
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: InputFieldDef
  value: string
  onChange: (v: string) => void
}) {
  const base =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'
  if (field.type === 'textarea') {
    return (
      <textarea
        className={`${base} h-28 resize-y font-sans`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
      />
    )
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      className={base}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
    />
  )
}

export default function RunTriggerModal({ graphId, definition, onClose }: Props) {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const triggerRun = useTriggerRun(workspaceId, graphId)

  const schema = definition.input_schema ?? []
  const hasSchema = schema.length > 0

  const [runName, setRunName] = useState('')
  const [formValues, setFormValues] = useState<Record<string, string>>(
    Object.fromEntries(schema.map((f) => [f.name, ''])),
  )
  const [inputJson, setInputJson] = useState('{}')
  const [err, setErr] = useState('')

  function setField(name: string, value: string) {
    setFormValues((prev) => ({ ...prev, [name]: value }))
  }

  async function handleRun() {
    setErr('')
    let input: Record<string, unknown>

    if (hasSchema) {
      for (const f of schema) {
        if (f.required && !formValues[f.name]?.trim()) {
          setErr(`"${f.label}" is required`)
          return
        }
      }
      input = Object.fromEntries(
        schema.map((f) => [
          f.name,
          f.type === 'number' ? Number(formValues[f.name]) : formValues[f.name],
        ]),
      )
    } else {
      try {
        input = JSON.parse(inputJson)
      } catch {
        setErr('Invalid JSON')
        return
      }
    }

    const run = await triggerRun.mutateAsync({ input, name: runName.trim() || undefined })
    navigate(`/runs/${run.id}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Fixed header */}
        <div className="px-6 pt-5 pb-4 border-b flex-shrink-0">
          <h2 className="font-semibold text-gray-900">Trigger Run</h2>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Optional run name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Run name <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. Customer A — contract review"
              value={runName}
              onChange={e => setRunName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {hasSchema ? (
            <div className="space-y-4">
              {schema.map((field) => (
                <div key={field.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                    {!field.required && (
                      <span className="ml-1 text-xs text-gray-400 font-normal">(optional)</span>
                    )}
                  </label>
                  {field.description && (
                    <p className="text-xs text-gray-400 mb-1">{field.description}</p>
                  )}
                  <FieldInput
                    field={field}
                    value={formValues[field.name] ?? ''}
                    onChange={(v) => setField(field.name, v)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Run Input (JSON) — Advanced</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono h-32 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={inputJson}
                onChange={(e) => setInputJson(e.target.value)}
              />
            </div>
          )}

          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>

        {/* Fixed footer */}
        <div className="px-6 pt-4 pb-5 border-t flex-shrink-0 flex justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" loading={triggerRun.isPending} onClick={handleRun}>Run ▶</Btn>
        </div>
      </div>
    </div>
  )
}
