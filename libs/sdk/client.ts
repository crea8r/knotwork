/**
 * Axios instance for all API calls.
 * Reads JWT from the Zustand auth store (persisted to a server-scoped localStorage key).
 * Handles 401 by redirecting to /login.
 *
 * VITE_API_URL must be an absolute URL (e.g. http://localhost:8000/api/v1).
 * The frontend calls the backend directly — no proxy, no redirect.
 */
import axios from 'axios'
import { useAuthStore } from '@auth'

// Runtime injection (Docker prod): env.js sets window._env.API_URL at container start.
// Dev (npm run dev): env.js has the literal placeholder — fall back to Vite env.
const _runtimeUrl: string | undefined =
  (window as unknown as { _env?: { API_URL?: string } })._env?.API_URL
const _raw: string =
  _runtimeUrl && _runtimeUrl !== 'RUNTIME_API_URL'
    ? _runtimeUrl
    : import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
export const API_BASE_URL = _raw.replace(/\/$/, '')
export const BACKEND_BASE_URL = new URL(API_BASE_URL).origin
export const WS_API_BASE_URL = API_BASE_URL.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'))

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  // 'localhost-bypass' is a sentinel for the dev auto-login flow — not a real JWT.
  if (token && token !== 'localhost-bypass') config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)
