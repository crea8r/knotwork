/**
 * RequireAuth — wraps protected routes.
 * Redirects to /login if there is no JWT in the auth store.
 */
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'

interface Props {
  children: React.ReactNode
}

export default function RequireAuth({ children }: Props) {
  const token = useAuthStore((s) => s.token)
  const location = useLocation()

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
