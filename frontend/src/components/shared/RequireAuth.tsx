/**
 * RequireAuth — wraps protected routes.
 * Redirects to /login if there is no JWT in the auth store.
 * On localhost installs, attempts one-time bootstrap from backend auth bypass.
 */
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { API_BASE_URL } from '@/api/client'

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

interface Props {
  children: React.ReactNode
}

export default function RequireAuth({ children }: Props) {
  const token = useAuthStore((s) => s.token)
  const login = useAuthStore((s) => s.login)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const location = useLocation()
  const [bootstrapFailed, setBootstrapFailed] = useState(false)
  const isLocalhostApp = useMemo(
    () => typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
    [],
  )

  useEffect(() => {
    if (!isLocalhostApp || token === 'localhost-bypass') return

    let cancelled = false

    async function bootstrapLocalAuth() {
      try {
        const [meRes, wsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/auth/me`),
          fetch(`${API_BASE_URL}/workspaces`),
        ])

        if (meRes.status === 401 || wsRes.status === 401) {
          if (!cancelled && !token) setBootstrapFailed(true)
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

  if (!token) {
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
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
