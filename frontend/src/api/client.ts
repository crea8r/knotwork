/**
 * Axios instance for all API calls.
 * Reads JWT from the Zustand auth store (persisted to localStorage under 'knotwork_auth').
 * Handles 401 by redirecting to /login.
 */
import axios from 'axios'
import { useAuthStore } from '@/store/auth'

function resolveApiUrl(): URL {
  const raw = import.meta.env.VITE_API_URL ?? '/api/v1'
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  return new URL(raw, base)
}

const apiUrl = resolveApiUrl()

export const API_BASE_URL = apiUrl.toString().replace(/\/$/, '')
export const BACKEND_BASE_URL = apiUrl.origin
export const WS_API_BASE_URL = API_BASE_URL.replace(/^http/, 'ws')

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
