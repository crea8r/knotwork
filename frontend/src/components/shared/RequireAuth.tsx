/**
 * RequireAuth — wraps protected routes.
 * Redirects to /login if there is no JWT in the auth store.
 * On localhost installs, attempts one-time bootstrap from backend auth bypass.
 *
 * Installation drift detection: on the first render per page load, fetches
 * /health and compares installation_id against the persisted value. A mismatch
 * (DB reset or fresh install) clears all auth state so the browser does not
 * keep sending stale workspace IDs to a brand-new backend.
 */

// Checked once per page load — not per React render or route change.
let _installationChecked = false
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { API_BASE_URL, BACKEND_BASE_URL } from '@/api/client'

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
  const workspaceId = useAuthStore((s) => s.workspaceId)
  const login = useAuthStore((s) => s.login)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const setInstallationId = useAuthStore((s) => s.setInstallationId)
  const location = useLocation()
  const [bootstrapFailed, setBootstrapFailed] = useState(false)
  const isLocalhostApp = useMemo(
    () => typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
    [],
  )

  // Installation drift detection — runs once per page load.
  useEffect(() => {
    if (_installationChecked) return
    _installationChecked = true

    async function checkInstallationDrift() {
      try {
        const res = await fetch(`${BACKEND_BASE_URL}/health`)
        if (!res.ok) return // backend unreachable — degrade gracefully
        const data = await res.json()
        const freshId: string | undefined = data.installation_id
        if (!freshId) return
        const stored = useAuthStore.getState().installationId
        if (stored && stored !== freshId) {
          // DB was reset or a fresh install happened — clear stale browser state.
          useAuthStore.getState().clearAuth()
          return
        }
        setInstallationId(freshId)
      } catch {
        // Network error — degrade gracefully, don't block the user.
      }
    }

    checkInstallationDrift()
  }, [setInstallationId])

  useEffect(() => {
    if (!isLocalhostApp) return

    // Re-bootstrap whenever token or workspaceId is missing.
    // workspaceId is excluded from localStorage (partialize) so on refresh
    // token is restored but workspaceId is null — we must re-fetch it.
    const shouldBootstrap = !token || !workspaceId

    if (!shouldBootstrap) return

    let cancelled = false

    async function bootstrapLocalAuth() {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        // Backend auto-authenticates as the first user when is_local_app and no token.
        const [meRes, wsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/auth/me`, { signal: controller.signal }),
          fetch(`${API_BASE_URL}/workspaces`, { signal: controller.signal }),
        ])
        clearTimeout(timer)

        if (meRes.status === 401 || wsRes.status === 401) {
          if (!cancelled && !token) setBootstrapFailed(true)
          return
        }
        if (!meRes.ok || !wsRes.ok) throw new Error('Local auth bootstrap failed')

        const me = (await meRes.json()) as MeOut
        const workspaces = (await wsRes.json()) as WorkspaceOut[]
        const primary = workspaces.find((ws) => ws.id === workspaceId) ?? workspaces[0]
        if (!primary) throw new Error('No workspace available for localhost auth bootstrap')

        if (!cancelled) login('localhost-bypass', me, primary.id, primary.member_role)
      } catch {
        clearTimeout(timer)
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
  }, [token, workspaceId, isLocalhostApp, login, clearAuth])

  // Show loading while bootstrap is in-flight (no token yet, or token present but
  // workspaceId is still null because we excluded it from localStorage persistence).
  const bootstrapInFlight = isLocalhostApp && !bootstrapFailed && (!token || !workspaceId)
  if (bootstrapInFlight) {
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

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
