/**
 * LoginPage — passwordless magic link login.
 * User enters email → receives magic link email → clicks link → logged in.
 */
import { useState } from 'react'
import { useRequestMagicLink } from '@/api/auth'
import knotworkLogo from '@/assets/knotwork-logo.svg'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const request = useRequestMagicLink()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    request.mutate(email, {
      onSuccess: () => setSent(true),
      onError: (err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })
          ?.response?.data?.detail
        setErrorMsg(detail ?? 'Something went wrong. Please try again.')
      },
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / name */}
        <div className="text-center mb-8">
          <img src={knotworkLogo} alt="Knotwork" className="mx-auto mb-3 h-12 w-12" />
          <h1 className="text-xl font-semibold text-gray-900">Knotwork</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in with a magic link</p>
        </div>

        {sent ? (
          <div className="bg-white border border-gray-100 rounded-xl p-6 text-center shadow-sm">
            <div className="text-2xl mb-3">📬</div>
            <p className="text-gray-700 font-medium mb-1">Check your email</p>
            <p className="text-sm text-gray-500">
              We sent a login link to <strong>{email}</strong>. It expires in 15 minutes.
            </p>
            <button
              className="mt-4 text-sm text-brand-500 hover:underline"
              onClick={() => { setSent(false); setEmail('') }}
            >
              Try a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrorMsg(null) }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            {errorMsg && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {errorMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={request.isPending}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              {request.isPending ? 'Sending…' : 'Send magic link'}
            </button>
            <p className="text-xs text-gray-400 text-center">
              No password needed. We'll email you a one-time link.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
