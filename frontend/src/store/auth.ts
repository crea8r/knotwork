import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  userId: string | null
  workspaceId: string | null
  role: 'owner' | 'operator' | null
  setAuth: (token: string, userId: string, workspaceId: string, role: 'owner' | 'operator') => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      workspaceId: null,
      role: null,
      setAuth: (token, userId, workspaceId, role) =>
        set({ token, userId, workspaceId, role }),
      clearAuth: () =>
        set({ token: null, userId: null, workspaceId: null, role: null }),
    }),
    { name: 'knotwork_auth' }
  )
)
