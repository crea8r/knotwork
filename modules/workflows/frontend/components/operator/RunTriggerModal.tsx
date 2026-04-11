import { useRef, useState } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTriggerRun, useUploadRunAttachment, type RunAttachmentRef } from "@modules/workflows/frontend/api/runs"
import { useAuthStore } from '@auth'
import Btn from '@ui/components/Btn'
import type { GraphDefinition, InputFieldDef } from '@data-models'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const MAX_ATTACHMENTS = 10
const MAX_FILE_BYTES = 10 * 1024 * 1024

interface Props {
  graphId: string
  definition: GraphDefinition
  onClose: () => void
  versionOptions?: Array<{ id: string; label: string; kind: 'draft' | 'version' }>
  defaultGraphVersionId?: string | null
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

export default function RunTriggerModal({
  graphId,
  definition,
  onClose,
  versionOptions = [],
  defaultGraphVersionId = null,
}: Props) {
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const triggerRun = useTriggerRun(workspaceId, graphId)
  const uploadAttachment = useUploadRunAttachment(workspaceId)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Snapshot the definition once at mount so autosaves / refetches can't
  // change the schema (and thus collapse the form) while the user is filling it in.
  const [snapshot] = useState(() => definition)
  const schema = snapshot.input_schema ?? []
  const hasSchema = schema.length > 0

  const [runName, setRunName] = useState('')
  const [formValues, setFormValues] = useState<Record<string, string>>(
    Object.fromEntries(schema.map((f) => [f.name, ''])),
  )
  const [inputJson, setInputJson] = useState('{}')
  const [err, setErr] = useState('')
  const [graphVersionId, setGraphVersionId] = useState<string>(defaultGraphVersionId ?? '')
  const [attachments, setAttachments] = useState<Array<{
    localId: string
    filename: string
    size: number
    status: 'uploading' | 'uploaded' | 'failed'
    ref?: RunAttachmentRef
    error?: string
  }>>([])

  function setField(name: string, value: string) {
    setFormValues((prev) => ({ ...prev, [name]: value }))
  }

  async function uploadFile(file: File, localId: string) {
    try {
      const uploaded = await uploadAttachment.mutateAsync(file)
      setAttachments((prev) =>
        prev.map((a) => (
          a.localId === localId
            ? { ...a, status: 'uploaded', ref: uploaded, error: undefined }
            : a
        )),
      )
    } catch (e: any) {
      const message = e?.response?.data?.detail ?? 'Upload failed'
      setAttachments((prev) =>
        prev.map((a) => (
          a.localId === localId
            ? { ...a, status: 'failed', error: String(message) }
            : a
        )),
      )
    }
  }

  function handleSelectFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const existing = attachments.length
    const remaining = Math.max(0, MAX_ATTACHMENTS - existing)
    if (remaining <= 0) {
      setErr(`Maximum ${MAX_ATTACHMENTS} files`)
      return
    }

    const incoming = Array.from(files).slice(0, remaining)
    if (incoming.length < files.length) {
      setErr(`Only first ${remaining} file(s) were added (max ${MAX_ATTACHMENTS})`)
    } else {
      setErr('')
    }

    const staged = incoming.map((f) => {
      const localId = `${Date.now()}-${Math.random()}-${f.name}`
      if (f.size > MAX_FILE_BYTES) {
        return {
          localId,
          filename: f.name,
          size: f.size,
          status: 'failed' as const,
          error: 'File too large (max 10 MB)',
        }
      }
      return {
        localId,
        filename: f.name,
        size: f.size,
        status: 'uploading' as const,
      }
    })

    setAttachments((prev) => [...prev, ...staged])
    for (let i = 0; i < incoming.length; i += 1) {
      const f = incoming[i]
      const row = staged[i]
      if (row.status === 'uploading') {
        void uploadFile(f, row.localId)
      }
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId))
  }

  function buildSchemaInput(): Record<string, unknown> {
    const next: Record<string, unknown> = {}
    for (const field of schema) {
      const raw = formValues[field.name] ?? ''
      if (!raw.trim()) {
        if (field.required) {
          next[field.name] = field.type === 'number' ? Number(raw) : raw
        }
        continue
      }
      next[field.name] = field.type === 'number' ? Number(raw) : raw
    }
    return next
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
      input = buildSchemaInput()
    } else {
      try {
        input = JSON.parse(inputJson)
      } catch {
        setErr('Invalid JSON')
        return
      }
    }

    if (attachments.some((a) => a.status === 'uploading')) {
      setErr('Please wait for file uploads to finish before running')
      return
    }
    if (attachments.some((a) => a.status === 'failed')) {
      setErr('Remove failed uploads before running')
      return
    }
    const contextFiles = attachments
      .filter((a) => a.status === 'uploaded' && a.ref)
      .map((a) => a.ref as RunAttachmentRef)
    const run = await triggerRun.mutateAsync({
      input,
      name: runName.trim() || undefined,
      context_files: contextFiles,
      graph_version_id: graphVersionId || undefined,
    })
    navigate(`/runs/${run.id}`)
  }

  const isUploading = attachments.some((a) => a.status === 'uploading')
  const hasFailedUploads = attachments.some((a) => a.status === 'failed')
  const canRun = !isUploading && !hasFailedUploads && !triggerRun.isPending

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

          {versionOptions.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Version</label>
              <select
                value={graphVersionId}
                onChange={(e) => setGraphVersionId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {versionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}{option.kind === 'draft' ? ' (draft run)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Attach files <span className="font-normal text-gray-400">(max 10 files, 10 MB each)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                handleSelectFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:border-brand-400 hover:text-brand-700 flex items-center justify-center gap-2"
              disabled={attachments.length >= MAX_ATTACHMENTS}
            >
              <Paperclip size={14} />
              Add files
            </button>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                {attachments.map((a) => (
                  <div key={a.localId} className="flex items-center justify-between rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <p className="truncate text-gray-700">{a.filename}</p>
                      <p className={`${
                        a.status === 'failed'
                          ? 'text-red-500'
                          : a.status === 'uploading'
                            ? 'text-amber-600'
                            : 'text-gray-400'
                      }`}>
                        {a.status === 'uploading' ? 'Uploading...' : a.status === 'failed' ? a.error : `${Math.round(a.size / 1024)} KB`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {a.status === 'uploading' && <Loader2 size={12} className="animate-spin text-amber-600" />}
                      <button
                        type="button"
                        className="text-gray-400 hover:text-gray-700"
                        onClick={() => removeAttachment(a.localId)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {isUploading && (
              <p className="mt-1 text-xs text-amber-600">Uploading in progress. Run is disabled until all uploads finish.</p>
            )}
            {hasFailedUploads && (
              <p className="mt-1 text-xs text-red-500">Remove failed uploads before running.</p>
            )}
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
          <Btn size="sm" loading={triggerRun.isPending} onClick={handleRun} disabled={!canRun}>Run ▶</Btn>
        </div>
      </div>
    </div>
  )
}
