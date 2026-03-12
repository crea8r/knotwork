import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  login: (token: string, user: UserInfo, workspaceId?: string, role?: 'owner' | 'operator') => void
  // Legacy compat: some older code calls setAuth with positional args
  setAuth: (token: string, userId: string, workspaceId: string, role: 'owner' | 'operator') => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      workspaceId: null,
      role: null,
      login: (token, user, workspaceId, role) =>
        set({ token, user, workspaceId: workspaceId ?? null, role: role ?? null }),
      setAuth: (token, userId, workspaceId, role) =>
        set({ token, user: { id: userId, email: '', name: '' }, workspaceId, role }),
      clearAuth: () => set({ token: null, user: null, workspaceId: null, role: null }),
    }),
    { name: 'knotwork_auth' }
  )
)
