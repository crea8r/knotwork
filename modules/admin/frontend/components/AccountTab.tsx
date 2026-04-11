/**
 * AccountTab — profile editing (name, bio, avatar) + logout.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@auth'
import {
  useMe,
  useRequestLocalhostSwitchUser,
  useUpdateMe,
  useWorkspaceEmailConfig,
  useWorkspaceMembers,
} from "@modules/admin/frontend/api/auth"
import Card from '@ui/components/Card'
import Btn from '@ui/components/Btn'
import Spinner from '@ui/components/Spinner'

export default function AccountTab() {
  const navigate = useNavigate()
  const { clearAuth, login, token, workspaceId, role } = useAuthStore()
  const { data: me, isLoading } = useMe()
  const update = useUpdateMe()
  const { data: membersData, isLoading: membersLoading } = useWorkspaceMembers(workspaceId, 1)
  const { data: emailConfig } = useWorkspaceEmailConfig(workspaceId)
  const switchUser = useRequestLocalhostSwitchUser(workspaceId)
  const isLocalhostApp =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [saved, setSaved] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [switchSentTo, setSwitchSentTo] = useState<string | null>(null)

  useEffect(() => {
    if (me) {
      setName(me.name ?? '')
      setBio(me.bio ?? '')
      setAvatarUrl(me.avatar_url ?? '')
    }
  }, [me])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(false)
    update.mutate(
      { name: name.trim(), bio: bio.trim(), avatar_url: avatarUrl.trim() },
      {
        onSuccess: (updated) => {
          // Sync updated name/bio/avatar into the auth store so header etc. reflects it
          if (token && updated) {
            login(
              token,
              { id: updated.id, email: updated.email, name: updated.name },
              workspaceId ?? undefined,
              role ?? undefined,
            )
          }
          setSaved(true)
        },
      }
    )
  }

  const handleLogout = () => {
    clearAuth()
    navigate('/login', { replace: true })
  }

  const switchableMembers = (membersData?.items ?? []).filter(
    (member) => member.user_id !== me?.id && !!member.email,
  )
  const localhostSwitchEnabled =
    isLocalhostApp &&
    !!emailConfig?.enabled &&
    (membersData?.total ?? 0) > 1

  const handleRequestSwitch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUserId) return
    setSwitchSentTo(null)
    switchUser.mutate(
      { user_id: selectedUserId },
      {
        onSuccess: (result) => setSwitchSentTo(result.email),
      },
    )
  }

  const handleReturnToDefault = () => {
    clearAuth()
    window.location.href = '/'
  }

  if (isLoading) return <div className="py-12 flex justify-center"><Spinner /></div>
  if (!me) return null

  const initials = me.name?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="space-y-6">
      {/* Profile form */}
      <Card className="p-6">
        <p className="text-sm font-medium text-gray-700 mb-5">Your profile</p>

        {/* Avatar preview */}
        <div className="flex items-center gap-4 mb-5">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="w-16 h-16 rounded-full object-cover border border-gray-200"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-2xl font-semibold">
              {initials}
            </div>
          )}
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Avatar URL</label>
            <input
              type="url"
              placeholder="https://example.com/photo.jpg"
              value={avatarUrl}
              onChange={(e) => { setAvatarUrl(e.target.value); setSaved(false) }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              required
              value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false) }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              readOnly
              value={me.email}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
            />
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed here.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Bio <span className="text-gray-400">({bio.length}/300)</span>
            </label>
            <textarea
              rows={3}
              maxLength={300}
              placeholder="A short description about yourself…"
              value={bio}
              onChange={(e) => { setBio(e.target.value); setSaved(false) }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>

          <div className="flex items-center gap-3">
            <Btn type="submit" variant="primary" loading={update.isPending}>
              Save changes
            </Btn>
            {saved && <span className="text-sm text-green-600">✓ Saved</span>}
            {update.isError && (
              <span className="text-sm text-red-600">Failed to save — try again</span>
            )}
          </div>
        </form>
      </Card>

      {isLocalhostApp && (
        <Card className="p-6">
          <p className="text-sm font-medium text-gray-700 mb-1">Localhost Account Switching</p>
          <p className="text-xs text-gray-400 mb-4">
            Localhost keeps a safe default account. Use this to send a magic link to another workspace member without leaving the resilient localhost mode.
          </p>

          {!emailConfig?.enabled ? (
            <p className="text-xs text-amber-700">
              Configure workspace email in System settings to enable localhost user switching.
            </p>
          ) : membersLoading ? (
            <div className="py-4"><Spinner size="sm" /></div>
          ) : !localhostSwitchEnabled || switchableMembers.length === 0 ? (
            <p className="text-xs text-gray-500">
              Add at least one more workspace member with an email address to test account switching.
            </p>
          ) : (
            <form onSubmit={handleRequestSwitch} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Switch to</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">Select a workspace member</option>
                  {switchableMembers.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.name} ({member.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <Btn type="submit" variant="primary" loading={switchUser.isPending} disabled={!selectedUserId}>
                  Send magic link
                </Btn>
                <Btn type="button" variant="secondary" onClick={handleReturnToDefault}>
                  Return to default account
                </Btn>
              </div>
              {switchSentTo && (
                <p className="text-sm text-green-600">Magic link sent to {switchSentTo}.</p>
              )}
              {switchUser.isError && (
                <p className="text-sm text-red-600">
                  {(switchUser.error as { response?: { data?: { detail?: string } } } | undefined)?.response?.data?.detail ?? 'Failed to send magic link'}
                </p>
              )}
            </form>
          )}
        </Card>
      )}

      {/* Sign out / recovery */}
      <Card className="p-6">
        <p className="text-sm font-medium text-gray-700 mb-1">{isLocalhostApp ? 'Localhost Recovery' : 'Sign out'}</p>
        {isLocalhostApp ? (
          <>
            <p className="text-xs text-amber-700 mb-2">
              Sign out stays disabled on localhost so the default account remains the recovery path.
            </p>
            <p className="text-xs text-gray-400">
              Use the localhost account switcher above to test other users, or return to the default account at any time.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-4">
              You'll be redirected to the login page. Your session token will be cleared.
            </p>
            <Btn variant="danger" onClick={handleLogout}>
              Sign out
            </Btn>
          </>
        )}
      </Card>
    </div>
  )
}
