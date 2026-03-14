/**
 * Axios instance for all API calls.
 * Reads JWT from the Zustand auth store (persisted to localStorage under 'knotwork_auth').
 * Handles 401 by redirecting to /login.
 */
import axios from 'axios'
import { useAuthStore } from '@/store/auth'

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

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
