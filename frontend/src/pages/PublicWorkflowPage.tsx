import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { usePublicWorkflow, useTriggerPublicRun } from '@/api/publicWorkflows'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import type { InputFieldDef } from '@/types'

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
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = usePublicWorkflow(token)
  const trigger = useTriggerPublicRun(token)

  const schema = data?.input_schema ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')

  const rateLimitText = useMemo(() => {
    if (!data) return ''
    return `${data.rate_limit_max_requests} requests per ${data.rate_limit_window_seconds} seconds per token/IP`
  }, [data])

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  async function handleTrigger() {
    setErr('')
    const input: Record<string, unknown> = {}
    for (const field of schema) {
      const raw = values[field.name] ?? ''
      if (field.required && !raw.trim()) {
        setErr(`"${field.label}" is required`)
        return
      }
      if (!raw && !field.required) continue
      input[field.name] = field.type === 'number' ? Number(raw) : raw
    }
    try {
      const out = await trigger.mutateAsync({
        input,
        email: email.trim() || undefined,
      })
      navigate(`/public/runs/${out.run_token}`)
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Could not trigger run'
      setErr(String(msg))
    }
  }

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
              </div>

              {err && <p className="mt-3 text-xs text-red-600">{err}</p>}

              <button
                type="button"
                onClick={() => void handleTrigger()}
                disabled={trigger.isPending}
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
