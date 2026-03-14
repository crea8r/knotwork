/**
 * MembersTab — Settings → Members tab.
 * Shows all workspace members (paginated) and pending invitations.
 * Owner can invite new members by email.
 */
import { useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { useWorkspaceInvitations, useCreateInvitation, useWorkspaceMembers } from '@/api/auth'
import Badge from '@/components/shared/Badge'
import Card from '@/components/shared/Card'
import Spinner from '@/components/shared/Spinner'

export default function MembersTab() {
  const workspaceId = useAuthStore((s) => s.workspaceId)
  const role = useAuthStore((s) => s.role)
  const isOwner = role === 'owner'
  const isLocalhostApp =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const invitesEnabled = isOwner && !isLocalhostApp

  // Members list
  const [membersPage, setMembersPage] = useState(1)
  const { data: membersData, isLoading: loadingMembers } = useWorkspaceMembers(workspaceId, membersPage)

  // Invitations
  const { data: invitations, isLoading: loadingInv, refetch } = useWorkspaceInvitations(workspaceId)
  const create = useCreateInvitation(workspaceId)

  const [email, setEmail] = useState('')
  const [invRole, setInvRole] = useState<'operator' | 'owner'>('operator')
  const [showForm, setShowForm] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    create.mutate(
      { email, role: invRole },
      {
        onSuccess: () => {
          setSent(email)
          setEmail('')
          setShowForm(false)
          refetch()
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      {/* Team members list */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <p className="text-sm font-medium text-gray-700">Team members</p>
          {membersData && (
            <span className="text-xs text-gray-400">({membersData.total})</span>
          )}
          {loadingMembers && <span className="ml-1 inline-flex align-middle"><Spinner size="sm" /></span>}
        </div>

        {loadingMembers ? (
          <div className="p-6 text-center"><Spinner /></div>
        ) : !membersData || membersData.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">No members found.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                  <th className="text-left px-4 py-3">Member</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {membersData.items.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {m.avatar_url ? (
                          <img
                            src={m.avatar_url}
                            alt={m.name}
                            className="w-8 h-8 rounded-full object-cover border border-gray-200"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-semibold">
                            {m.name[0]?.toUpperCase() ?? '?'}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-800">{m.name}</p>
                          <p className="text-xs text-gray-400">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={m.role === 'owner' ? 'blue' : 'gray'}>{m.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(m.joined_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {membersData.total > membersData.page_size && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-gray-500">
                <span>
                  {(membersPage - 1) * membersData.page_size + 1}–
                  {Math.min(membersPage * membersData.page_size, membersData.total)} of {membersData.total}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMembersPage((p) => p - 1)}
                    disabled={membersPage <= 1}
                    className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setMembersPage((p) => p + 1)}
                    disabled={membersPage * membersData.page_size >= membersData.total}
                    className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Pending invitations */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-sm font-medium text-gray-700">
            Invitations
            {loadingInv && <span className="ml-2 inline-flex align-middle"><Spinner size="sm" /></span>}
          </p>
          {invitesEnabled && !showForm && (
            <button
              onClick={() => { setShowForm(true); setSent(null) }}
              className="text-xs bg-brand-500 text-white px-3 py-1.5 rounded-lg hover:bg-brand-600 transition-colors"
            >
              + Invite member
            </button>
          )}
        </div>

        {isOwner && isLocalhostApp && (
          <div className="px-4 py-2 bg-amber-50 text-amber-800 text-xs border-b">
            Invitations are disabled on localhost installs. Promote this install to a public domain with email delivery before inviting members.
          </div>
        )}

        {/* Invite form */}
        {showForm && invitesEnabled && (
          <form onSubmit={submit} className="p-4 bg-gray-50 border-b">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Email address</label>
                <input
                  type="email"
                  required
                  autoFocus
                  placeholder="colleague@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <select
                  value={invRole}
                  onChange={(e) => setInvRole(e.target.value as 'operator' | 'owner')}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="operator">Operator</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={create.isPending}
                className="bg-brand-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 transition-colors"
              >
                {create.isPending ? 'Sending…' : 'Send invite'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Success banner */}
        {sent && (
          <div className="px-4 py-2 bg-green-50 text-green-700 text-xs border-b">
            ✓ Invitation sent to <strong>{sent}</strong>. They'll receive an email with a link to join.
          </div>
        )}

        {/* Invitations list */}
        {loadingInv ? (
          <div className="p-6 text-center"><Spinner /></div>
        ) : !invitations || invitations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            {invitesEnabled ? 'No invitations yet. Invite a member above.' : 'No pending invitations.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 text-gray-700">{inv.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={inv.role === 'owner' ? 'blue' : 'gray'}>{inv.role}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {inv.accepted_at ? (
                      <Badge variant="green">Accepted</Badge>
                    ) : new Date(inv.expires_at) < new Date() ? (
                      <Badge variant="red">Expired</Badge>
                    ) : (
                      <Badge variant="orange">Pending</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(inv.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
