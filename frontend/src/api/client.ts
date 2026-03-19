/**
 * Axios instance for all API calls.
 * Reads JWT from the Zustand auth store (persisted to localStorage under 'knotwork_auth').
 * Handles 401 by redirecting to /login.
 *
 * VITE_API_URL must be an absolute URL (e.g. http://localhost:8000/api/v1).
 * The frontend calls the backend directly — no proxy, no redirect.
 */
import axios from 'axios'
import { useAuthStore } from '@/store/auth'

const _raw: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
export const API_BASE_URL = _raw.replace(/\/$/, '')
export const BACKEND_BASE_URL = new URL(API_BASE_URL).origin
export const WS_API_BASE_URL = API_BASE_URL.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'))

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
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
