/**
 * AcceptInvitePage — handles both:
 *   - Workspace invitations: /accept-invite?token=<invite_token>
 *   - Magic link logins:     /accept-invite?magic=<magic_token>
 *
 * On success: stores JWT, fetches current user + workspace, redirects to /inbox.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAcceptInvitation, useGetInvitation, useVerifyMagicLink, useMe } from '@/api/auth'
import { useAuthStore } from '@/store/auth'
import { api } from '@/api/client'
import knotworkLogo from '@/assets/knotwork-logo.svg'

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const inviteToken = searchParams.get('token')
  const magicToken = searchParams.get('magic')
  const login = useAuthStore((s) => s.login)

  // ── Magic link flow ────────────────────────────────────────────────────────
  const verifyMagic = useVerifyMagicLink()
  useEffect(() => {
    if (!magicToken) return
    verifyMagic.mutate(magicToken, {
      onSuccess: async (data) => {
        // Temporarily set token to fetch /me
        login(data.access_token, { id: '', email: '', name: '' })
        try {
          const me = await api.get('/auth/me').then((r) => r.data)
          const ws = await api.get('/workspaces').then((r) => r.data)
          const workspaceId = ws?.[0]?.id ?? null
          login(data.access_token, me, workspaceId, ws?.[0]?.member_role ?? 'operator')
        } catch {
          // /me succeeded, workspace optional
        }
        navigate('/inbox', { replace: true })
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magicToken])

  if (magicToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {verifyMagic.isPending && (
            <>
              <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Logging you in…</p>
            </>
          )}
          {verifyMagic.isError && (
            <>
              <p className="text-red-600 font-medium">Invalid or expired link</p>
              <p className="text-sm text-gray-500 mt-1">Request a new magic link from the login page.</p>
              <button
                className="mt-4 text-sm text-brand-500 hover:underline"
                onClick={() => navigate('/login')}
              >
                Go to login
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Invitation flow ────────────────────────────────────────────────────────
  return <InviteAcceptFlow token={inviteToken} />
}

function InviteAcceptFlow({ token }: { token: string | null }) {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const { data: inv, isLoading, isError } = useGetInvitation(token)
  const accept = useAcceptInvitation()
  const [name, setName] = useState('')

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">No invitation token found.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isError || !inv) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 font-medium">Invalid or expired invitation</p>
          <p className="text-sm text-gray-500 mt-1">Ask the workspace owner to send a new invite.</p>
        </div>
      </div>
    )
  }

  if (inv.already_accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-700 font-medium">Invitation already accepted</p>
          <button
            className="mt-3 text-sm text-brand-500 hover:underline"
            onClick={() => navigate('/login')}
          >
            Go to login
          </button>
        </div>
      </div>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    accept.mutate(
      { token, name },
      {
        onSuccess: (data) => {
          login(
            data.access_token,
            { id: data.user_id, email: data.email, name: data.name },
            data.workspace_id,
            data.role as 'owner' | 'operator',
          )
          navigate('/inbox', { replace: true })
        },
      }
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={knotworkLogo} alt="Knotwork" className="mx-auto mb-3 h-12 w-12" />
          <h1 className="text-xl font-semibold text-gray-900">Join {inv.workspace_name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            You've been invited as <strong>{inv.role}</strong>
          </p>
        </div>

        <form onSubmit={submit} className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <p className="text-sm text-gray-700 font-medium">{inv.email}</p>
          </div>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Your name
            </label>
            <input
              id="name"
              type="text"
              required
              autoFocus
              placeholder="e.g. Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          {accept.isError && (
            <p className="text-xs text-red-600">Something went wrong. Please try again.</p>
          )}
          <button
            type="submit"
            disabled={accept.isPending || !name.trim()}
            className="w-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            {accept.isPending ? 'Joining…' : 'Accept invitation'}
          </button>
        </form>
      </div>
    </div>
  )
}
