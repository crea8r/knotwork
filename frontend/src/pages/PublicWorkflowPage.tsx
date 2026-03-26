import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Paperclip, X } from 'lucide-react'
import type { RunAttachmentRef } from '@/api/runs'
import { usePublicWorkflow, useTriggerPublicRun, useUploadPublicWorkflowAttachment } from '@/api/publicWorkflows'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import type { InputFieldDef } from '@/types'

const MAX_ATTACHMENTS = 10
const MAX_FILE_BYTES = 10 * 1024 * 1024

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: InputFieldDef
  value: string
  onChange: (v: string) => void
}) {
  const base = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'
  if (field.type === 'textarea') {
    return <textarea className={`${base} min-h-[100px] resize-y`} value={value} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      className={base}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export default function PublicWorkflowPage() {
  const { token, graphSlug, versionSlug } = useParams<{ token?: string; graphSlug?: string; versionSlug?: string }>()
  const resolvedToken = token ?? (graphSlug ? (versionSlug ? `${graphSlug}/${versionSlug}` : graphSlug) : '')
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = usePublicWorkflow(resolvedToken)
  const trigger = useTriggerPublicRun(resolvedToken)
  // For attachments we need graph_slug + version_slug; use data.resolved_version_slug for graph-level URLs
  const attachGraphSlug = graphSlug ?? ''
  const attachVersionSlug = versionSlug ?? data?.resolved_version_slug ?? ''
  const uploadAttachment = useUploadPublicWorkflowAttachment(attachGraphSlug, attachVersionSlug)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const schema = data?.input_schema ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [attachments, setAttachments] = useState<Array<{
    localId: string
    filename: string
    size: number
    status: 'uploading' | 'uploaded' | 'failed'
    ref?: RunAttachmentRef
    error?: string
  }>>([])

  const rateLimitText = useMemo(() => {
    if (!data) return ''
    return `${data.rate_limit_max_requests} requests per ${data.rate_limit_window_seconds} seconds per token/IP`
  }, [data])

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }))
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
      const row = staged[i]
      if (row.status === 'uploading') {
        void uploadFile(incoming[i], row.localId)
      }
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId))
  }

  function buildSchemaInput(): Record<string, unknown> {
    const next: Record<string, unknown> = {}
    for (const field of schema) {
      const raw = values[field.name] ?? ''
      if (!raw.trim()) {
        continue
      }
      next[field.name] = field.type === 'number' ? Number(raw) : raw
    }
    return next
  }

  async function handleTrigger() {
    setErr('')
    for (const field of schema) {
      const raw = values[field.name] ?? ''
      if (field.required && !raw.trim()) {
        setErr(`"${field.label}" is required`)
        return
      }
    }
    const input = buildSchemaInput()
    if (attachments.some((a) => a.status === 'uploading')) {
      setErr('Please wait for file uploads to finish before running')
      return
    }
    if (attachments.some((a) => a.status === 'failed')) {
      setErr('Remove failed uploads before running')
      return
    }
    try {
      const out = await trigger.mutateAsync({
        input,
        email: email.trim() || undefined,
        context_files: attachments
          .filter((a) => a.status === 'uploaded' && a.ref)
          .map((a) => a.ref as RunAttachmentRef),
      })
      navigate(`/public/runs/${out.run_token}`)
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Could not trigger run'
      setErr(String(msg))
    }
  }

  const isUploading = attachments.some((a) => a.status === 'uploading')
  const hasFailedUploads = attachments.some((a) => a.status === 'failed')

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-gray-50 px-4 py-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Public Test Workflow</p>
          <p className="text-xs text-amber-800 mt-1">
            This is a preview test experience. We plan to charge per run in future releases.
          </p>
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">Loading…</div>
        ) : isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700">
            {(error as any)?.response?.data?.detail ?? 'Link not found or disabled'}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-semibold text-gray-900 mb-3">Workflow description</p>
              <MarkdownViewer content={data?.description_md ?? ''} />
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-semibold text-gray-900 mb-1">Trigger run</p>
              <p className="text-xs text-gray-500 mb-4">Rate limit: {rateLimitText}</p>

              <div className="space-y-4">
                {schema.map((field) => (
                  <div key={field.name}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {field.description && <p className="text-xs text-gray-500 mb-1">{field.description}</p>}
                    <FieldInput
                      field={field}
                      value={values[field.name] ?? ''}
                      onChange={(v) => setField(field.name, v)}
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email (optional)</label>
                  <p className="text-xs text-gray-500 mb-1">Get a notification when the final output is ready.</p>
                  <input
                    type="email"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Paperclip size={14} />
                    Add files
                  </button>
                  {attachments.length > 0 && (
                    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      {attachments.map((a) => (
                        <div key={a.localId} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                          <Paperclip size={14} className="text-gray-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-gray-800">{a.filename}</p>
                            <p className={`text-xs ${a.status === 'failed' ? 'text-red-500' : a.status === 'uploading' ? 'text-amber-600' : 'text-gray-500'}`}>
                              {a.status === 'uploading' ? 'Uploading...' : a.status === 'failed' ? a.error : `${Math.round(a.size / 1024)} KB`}
                            </p>
                          </div>
                          {a.status === 'uploading' && <Loader2 size={12} className="animate-spin text-amber-600" />}
                          <button
                            type="button"
                            onClick={() => removeAttachment(a.localId)}
                            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            aria-label={`Remove ${a.filename}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {isUploading && (
                    <p className="mt-2 text-xs text-amber-600">Uploading in progress. Run is disabled until all uploads finish.</p>
                  )}
                  {hasFailedUploads && (
                    <p className="mt-2 text-xs text-red-500">Remove failed uploads before running.</p>
                  )}
                </div>
              </div>

              {err && <p className="mt-3 text-xs text-red-600">{err}</p>}

              <button
                type="button"
                onClick={() => void handleTrigger()}
                disabled={trigger.isPending || isUploading || hasFailedUploads}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {trigger.isPending && <Loader2 size={14} className="animate-spin" />}
                Trigger run
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
