import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { namespacedStorageKey } from '@storage'

export interface UserInfo {
  id: string
  email: string
  name: string
}

interface AuthState {
  token: string | null
  user: UserInfo | null
  workspaceId: string | null
  role: 'owner' | 'operator' | null
  /** UUID returned by /health. Persisted so drift can be detected after a page reload. */
  installationId: string | null
  login: (token: string, user: UserInfo, workspaceId?: string, role?: 'owner' | 'operator') => void
  // Legacy compat: some older code calls setAuth with positional args
  setAuth: (token: string, userId: string, workspaceId: string, role: 'owner' | 'operator') => void
  clearAuth: () => void
  setInstallationId: (id: string) => void
}

type PersistedAuthState = Pick<AuthState, 'token' | 'user' | 'workspaceId' | 'role' | 'installationId'>

const LEGACY_AUTH_STORAGE_KEY = 'knotwork_auth'
const LEGACY_AUTH_STORAGE_PREFIX = `${LEGACY_AUTH_STORAGE_KEY}::`

type PersistedAuthSnapshot = {
  state?: {
    installationId?: string | null
  }
}

function authStorageInstallKey(installationId: string): string {
  return namespacedStorageKey(`auth.install.${installationId}`)
}

function previousAuthStorageBaseKey(): string {
  if (typeof window === 'undefined') return `${LEGACY_AUTH_STORAGE_KEY}::server`
  const runtimeUrl = (window as unknown as { _env?: { API_URL?: string } })._env?.API_URL
  const raw =
    runtimeUrl && runtimeUrl !== 'RUNTIME_API_URL'
      ? runtimeUrl
      : import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
  return `${LEGACY_AUTH_STORAGE_KEY}::${encodeURIComponent(raw.replace(/\/$/, ''))}`
}

function parsePersistedSnapshot(value: string): PersistedAuthSnapshot | null {
  try {
    return JSON.parse(value) as PersistedAuthSnapshot
  } catch {
    return null
  }
}

const authStorage = {
  getItem: (_name: string): string | null => {
    if (typeof window === 'undefined') return null
    const baseKey = namespacedStorageKey('auth')
    const current = window.localStorage.getItem(baseKey)
    if (current !== null) return current

    const previousBaseKey = previousAuthStorageBaseKey()
    const legacyCandidates = [LEGACY_AUTH_STORAGE_KEY, previousBaseKey]
    for (const legacyKey of legacyCandidates) {
      const legacyValue = window.localStorage.getItem(legacyKey)
      if (legacyValue !== null) {
        window.localStorage.setItem(baseKey, legacyValue)
        window.localStorage.removeItem(legacyKey)
        return legacyValue
      }
    }

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key || !key.startsWith(LEGACY_AUTH_STORAGE_PREFIX)) continue
      const legacyValue = window.localStorage.getItem(key)
      if (legacyValue !== null) {
        window.localStorage.setItem(baseKey, legacyValue)
        window.localStorage.removeItem(key)
        return legacyValue
      }
    }

    return null
  },
  setItem: (_name: string, value: string): void => {
    if (typeof window === 'undefined') return
    const baseKey = namespacedStorageKey('auth')
    window.localStorage.setItem(baseKey, value)

    const parsed = parsePersistedSnapshot(value)
    const installationId = parsed?.state?.installationId?.trim()
    if (installationId) {
      window.localStorage.setItem(authStorageInstallKey(installationId), value)
    }

    window.localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY)
    window.localStorage.removeItem(previousAuthStorageBaseKey())
  },
  removeItem: (_name: string): void => {
    if (typeof window === 'undefined') return

    const baseKey = namespacedStorageKey('auth')
    const installPrefix = namespacedStorageKey('auth.install.')
    const keysToRemove: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key) continue
      if (key === baseKey || key.startsWith(installPrefix) || key.startsWith(LEGACY_AUTH_STORAGE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key)
    }
    window.localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY)
    window.localStorage.removeItem(previousAuthStorageBaseKey())
  },
}

export const useAuthStore = create<AuthState>()(
  persist<AuthState, [], [], PersistedAuthState>(
    (set) => ({
      token: null,
      user: null,
      workspaceId: null,
      role: null,
      installationId: null,
      login: (token, user, workspaceId, role) =>
        set({ token, user, workspaceId: workspaceId ?? null, role: role ?? null }),
      setAuth: (token, userId, workspaceId, role) =>
        set({ token, user: { id: userId, email: '', name: '' }, workspaceId, role }),
      clearAuth: () => set({ token: null, user: null, workspaceId: null, role: null }),
      setInstallationId: (id) => set({ installationId: id }),
    }),
    {
      name: LEGACY_AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        workspaceId: state.workspaceId,
        role: state.role,
        installationId: state.installationId,
      }),
    }
  )
)
