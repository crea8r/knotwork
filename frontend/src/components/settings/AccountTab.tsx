/**
 * AccountTab — profile editing (name, bio, avatar) + logout.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { useMe, useUpdateMe } from '@/api/auth'
import Card from '@/components/shared/Card'
import Btn from '@/components/shared/Btn'
import Spinner from '@/components/shared/Spinner'

export default function AccountTab() {
  const navigate = useNavigate()
  const { clearAuth, login, token, workspaceId, role } = useAuthStore()
  const { data: me, isLoading } = useMe()
  const update = useUpdateMe()

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [saved, setSaved] = useState(false)

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
            <Btn type="submit" variant="primary" isLoading={update.isPending}>
              Save changes
            </Btn>
            {saved && <span className="text-sm text-green-600">✓ Saved</span>}
            {update.isError && (
              <span className="text-sm text-red-600">Failed to save — try again</span>
            )}
          </div>
        </form>
      </Card>

      {/* Sign out */}
      <Card className="p-6">
        <p className="text-sm font-medium text-gray-700 mb-1">Sign out</p>
        <p className="text-xs text-gray-400 mb-4">
          You'll be redirected to the login page. Your session token will be cleared.
        </p>
        <Btn variant="danger" onClick={handleLogout}>
          Sign out
        </Btn>
      </Card>
    </div>
  )
}
