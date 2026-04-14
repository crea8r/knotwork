import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import {
  useConfirmPasswordReset,
  usePasswordLogin,
  useRequestMagicLink,
  useRequestPasswordReset,
} from '@modules/admin/frontend/api/auth'
import { API_BASE_URL, api } from '@sdk'
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

type LoginMode = 'password' | 'magic'

export default function LoginPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const resetToken = searchParams.get('reset')
  const token = useAuthStore((s) => s.token)
  const login = useAuthStore((s) => s.login)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [mode, setMode] = useState<LoginMode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [showForgot, setShowForgot] = useState(false)
  const [sentMagic, setSentMagic] = useState(false)
  const [sentReset, setSentReset] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [bootstrapFailed, setBootstrapFailed] = useState(false)
  const passwordLogin = usePasswordLogin()
  const requestMagic = useRequestMagicLink()
  const requestReset = useRequestPasswordReset()
  const confirmReset = useConfirmPasswordReset()
  const isLocalhostApp = useMemo(
    () => typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
    [],
  )

  const finishLogin = async (accessToken: string) => {
    login(accessToken, { id: '', email: '', name: '' })
    try {
      const me = await api.get('/auth/me').then((r) => r.data as MeOut)
      const workspaces = await api.get('/workspaces').then((r) => r.data as WorkspaceOut[])
      const primary = workspaces[0]
      login(accessToken, me, primary?.id, primary?.member_role ?? 'operator')
    } catch {
      clearAuth()
      throw new Error('Unable to complete login')
    }
  }

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

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    passwordLogin.mutate(
      { email, password },
      {
        onSuccess: async (data) => {
          try {
            await finishLogin(data.access_token)
          } catch (err) {
            setErrorMsg((err as Error).message)
          }
        },
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          setErrorMsg(detail ?? 'Unable to sign in.')
        },
      },
    )
  }

  const submitMagic = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    requestMagic.mutate(email, {
      onSuccess: () => setSentMagic(true),
      onError: (err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        setErrorMsg(detail ?? 'Something went wrong. Please try again.')
      },
    })
  }

  const submitForgotPassword = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    requestReset.mutate(email, {
      onSuccess: () => setSentReset(true),
      onError: () => setSentReset(true),
    })
  }

  const submitReset = (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetToken) return
    setErrorMsg(null)
    confirmReset.mutate(
      { token: resetToken, new_password: resetPassword },
      {
        onSuccess: async (data) => {
          try {
            await finishLogin(data.access_token)
          } catch (err) {
            setErrorMsg((err as Error).message)
          }
        },
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          setErrorMsg(detail ?? 'Unable to reset password.')
        },
      },
    )
  }

  const clearResetMode = () => {
    searchParams.delete('reset')
    setSearchParams(searchParams, { replace: true })
    setResetPassword('')
    setErrorMsg(null)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={knotworkLogo} alt="Knotwork" className="mx-auto mb-3 h-12 w-12" />
          <h1 className="text-xl font-semibold text-gray-900">Knotwork</h1>
          <p className="text-sm text-gray-500 mt-1">
            {resetToken ? 'Choose a new password' : 'Sign in with email'}
          </p>
        </div>

        {resetToken ? (
          <form onSubmit={submitReset} className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
            <div>
              <label htmlFor="reset-password" className="block text-sm font-medium text-gray-700 mb-1">
                New password
              </label>
              <input
                id="reset-password"
                type="password"
                required
                minLength={4}
                autoFocus
                value={resetPassword}
                onChange={(e) => { setResetPassword(e.target.value); setErrorMsg(null) }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            {errorMsg ? (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {errorMsg}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={confirmReset.isPending || !resetPassword.trim()}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              {confirmReset.isPending ? 'Saving…' : 'Reset password'}
            </button>
            <button
              type="button"
              onClick={clearResetMode}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              Back to sign in
            </button>
          </form>
        ) : sentMagic ? (
          <div className="bg-white border border-gray-100 rounded-xl p-6 text-center shadow-sm">
            <div className="text-2xl mb-3">📬</div>
            <p className="text-gray-700 font-medium mb-1">Check your email</p>
            <p className="text-sm text-gray-500">
              We sent a login link to <strong>{email}</strong>. It expires in 15 minutes.
            </p>
            <button
              className="mt-4 text-sm text-brand-500 hover:underline"
              onClick={() => { setSentMagic(false); setEmail('') }}
            >
              Try a different email
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex gap-2 rounded-lg bg-gray-100 p-1 text-sm">
              {(['password', 'magic'] as LoginMode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value)
                    setErrorMsg(null)
                    setShowForgot(false)
                    setSentReset(false)
                  }}
                  className={`flex-1 rounded-md px-3 py-2 capitalize transition-colors ${
                    mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {value === 'password' ? 'Password' : 'Magic link'}
                </button>
              ))}
            </div>

            {mode === 'password' ? (
              showForgot ? (
                <form onSubmit={submitForgotPassword} className="space-y-4">
                  <div>
                    <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1">
                      Email address
                    </label>
                    <input
                      id="forgot-email"
                      type="email"
                      required
                      autoFocus
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setErrorMsg(null); setSentReset(false) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  {sentReset ? (
                    <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      If that email is registered, a password reset link has been sent.
                    </p>
                  ) : null}
                  {errorMsg ? (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {errorMsg}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={requestReset.isPending}
                    className="w-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
                  >
                    {requestReset.isPending ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgot(false)
                      setSentReset(false)
                      setErrorMsg(null)
                    }}
                    className="w-full text-sm text-gray-500 hover:text-gray-700"
                  >
                    Back to password sign in
                  </button>
                </form>
              ) : (
                <form onSubmit={submitPassword} className="space-y-4">
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
                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      required
                      minLength={4}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setErrorMsg(null) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  {errorMsg ? (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {errorMsg}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={passwordLogin.isPending}
                    className="w-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
                  >
                    {passwordLogin.isPending ? 'Signing in…' : 'Sign in'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgot(true)
                      setSentReset(false)
                      setErrorMsg(null)
                    }}
                    className="w-full text-sm text-brand-500 hover:underline"
                  >
                    Forgot password?
                  </button>
                </form>
              )
            ) : (
              <form onSubmit={submitMagic} className="space-y-4">
                <div>
                  <label htmlFor="magic-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email address
                  </label>
                  <input
                    id="magic-email"
                    type="email"
                    required
                    autoFocus
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setErrorMsg(null) }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
                {errorMsg ? (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {errorMsg}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={requestMagic.isPending}
                  className="w-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  {requestMagic.isPending ? 'Sending…' : 'Send magic link'}
                </button>
                <p className="text-xs text-gray-400 text-center">
                  We&apos;ll email you a one-time sign-in link.
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
