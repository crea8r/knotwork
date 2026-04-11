/**
 * LoginPage — passwordless magic link login.
 * User enters email → receives magic link email → clicks link → logged in.
 */
import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useRequestMagicLink } from "@modules/admin/frontend/api/auth"
import { API_BASE_URL } from '@sdk'
import knotworkLogo from '@ui/assets/knotwork-logo.svg'
import { useAuthStore } from '@auth'

interface WorkspaceOut {
  id: string
  name: string
  slug: string
  member_role: 'owner' | 'operator'
}

interface MeOut {
  id: string
  email: string
  name: string
}

export default function LoginPage() {
  const token = useAuthStore((s) => s.token)
  const login = useAuthStore((s) => s.login)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [bootstrapFailed, setBootstrapFailed] = useState(false)
  const request = useRequestMagicLink()
  const isLocalhostApp = useMemo(
    () => typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
    [],
  )

  useEffect(() => {
    if (!isLocalhostApp || token) return

    let cancelled = false

    async function bootstrapLocalAuth() {
      try {
        const [meRes, wsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/auth/me`),
          fetch(`${API_BASE_URL}/workspaces`),
        ])

        if (meRes.status === 401 || wsRes.status === 401) {
          if (!cancelled) setBootstrapFailed(true)
          return
        }
        if (!meRes.ok || !wsRes.ok) {
          throw new Error('Local auth bootstrap failed')
        }

        const me = (await meRes.json()) as MeOut
        const workspaces = (await wsRes.json()) as WorkspaceOut[]
        const primary = workspaces[0]
        if (!primary) {
          throw new Error('No workspace available for localhost auth bootstrap')
        }

        if (!cancelled) {
          login('localhost-bypass', me, primary.id, primary.member_role)
        }
      } catch {
        if (!cancelled) {
          clearAuth()
          setBootstrapFailed(true)
        }
      }
    }

    bootstrapLocalAuth()
    return () => {
      cancelled = true
    }
  }, [token, isLocalhostApp, login, clearAuth])

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

  if (token) {
    return <Navigate to="/inbox" replace />
  }

  if (isLocalhostApp && !bootstrapFailed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-800">Preparing localhost session</p>
          <p className="mt-2 text-sm text-gray-500">
            Attempting automatic sign-in for this localhost install.
          </p>
        </div>
      </div>
    )
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
