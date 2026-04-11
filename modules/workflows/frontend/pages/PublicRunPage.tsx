import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { usePublicRun, usePublicRunNotify } from "@modules/workflows/frontend/api/publicWorkflows"
import MarkdownViewer from '@ui/components/MarkdownViewer'

export default function PublicRunPage() {
  const { token = '' } = useParams<{ token: string }>()
  const { data, isLoading, isError, error } = usePublicRun(token, {
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 4000 : false),
  })
  const notify = usePublicRunNotify(token)
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  async function handleNotify() {
    setErr('')
    setSaved(false)
    try {
      await notify.mutateAsync(email.trim())
      setSaved(true)
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Could not save email'
      setErr(String(msg))
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-50 via-white to-gray-50 px-4 py-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Public Test Run</p>
          <p className="text-xs text-amber-800 mt-1">
            This is a test experience. Future versions will include paid usage.
          </p>
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">Loading…</div>
        ) : isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700">
            {(error as any)?.response?.data?.detail ?? 'Run page not found'}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-semibold text-gray-900 mb-3">Workflow description</p>
              <MarkdownViewer content={data?.description_md ?? ''} />
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-semibold text-gray-900 mb-2">Input</p>
              <pre className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700 overflow-auto">
                {JSON.stringify(data?.input ?? {}, null, 2)}
              </pre>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm font-semibold text-gray-900 mb-3">End result</p>
              {data?.final_output ? (
                <MarkdownViewer content={data.final_output} />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">The system is working on it.</p>
                  {!data?.email_subscribed && (
                    <div className="max-w-lg">
                      <p className="text-xs text-gray-500 mb-1">Leave your email and we will notify you when output is ready.</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="email"
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                        />
                        <button
                          type="button"
                          onClick={() => void handleNotify()}
                          disabled={notify.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {notify.isPending && <Loader2 size={14} className="animate-spin" />}
                          Notify me
                        </button>
                      </div>
                      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
                      {saved && <p className="mt-1 text-xs text-green-700">Email saved. We will notify you.</p>}
                    </div>
                  )}
                  {data?.email_subscribed && (
                    <p className="text-xs text-green-700">Notification email is already subscribed.</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
