/**
 * MembersTab — Settings → Members tab.
 * Shows all workspace members (paginated) with kind filter (human/agent).
 * Owner can:
 *   - Invite a human member by email (sends invitation link)
 *   - Add an agent member by ed25519 public key (creates account immediately)
 */
import { useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { BACKEND_BASE_URL } from '@/api/client'
import {
  useWorkspaceInvitations,
  useCreateInvitation,
  useAddAgentMember,
  useWorkspaceEmailConfig,
  useWorkspaceMembers,
} from '@/api/auth'
import Badge from '@/components/shared/Badge'
import Card from '@/components/shared/Card'
import Spinner from '@/components/shared/Spinner'

type KindFilter = 'all' | 'human' | 'agent'
type InviteMode = 'email' | 'pubkey'

function DiscoveryPrompt({ workspaceId }: { workspaceId: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${BACKEND_BASE_URL}/api/v1/workspaces/${workspaceId}/.well-known/agent`

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 space-y-1.5">
      <p className="text-xs text-blue-800 font-medium">Agent discovery URL</p>
      <p className="text-xs text-blue-700">
        Give this URL to your agent. It tells the agent how to authenticate and connect to
        this workspace — no other configuration needed.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs font-mono bg-white border border-blue-100 rounded px-2 py-1.5 text-blue-900 truncate select-all">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 text-xs px-2.5 py-1.5 rounded border border-blue-200 bg-white text-blue-700 hover:bg-blue-50 transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export default function MembersTab() {
  const workspaceId = useAuthStore((s) => s.workspaceId)
  const role = useAuthStore((s) => s.role)
  const isOwner = role === 'owner'

  // Members list
  const [membersPage, setMembersPage] = useState(1)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const { data: membersData, isLoading: loadingMembers } = useWorkspaceMembers(
    workspaceId,
    membersPage,
    kindFilter === 'all' ? undefined : kindFilter,
  )

  // Invitations
  const { data: invitations, isLoading: loadingInv, refetch } = useWorkspaceInvitations(workspaceId)
  const createInvitation = useCreateInvitation(workspaceId)
  const addAgent = useAddAgentMember(workspaceId)
  const { data: emailConfig } = useWorkspaceEmailConfig(workspaceId)

  // Invite form state
  const [showForm, setShowForm] = useState(false)
  const [inviteMode, setInviteMode] = useState<InviteMode>('email')

  // Email invite fields
  const [email, setEmail] = useState('')
  const [invRole, setInvRole] = useState<'operator' | 'owner'>('operator')
  const [sentEmail, setSentEmail] = useState<string | null>(null)

  // Public key fields
  const [displayName, setDisplayName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [agentRole, setAgentRole] = useState<'operator' | 'owner'>('operator')
  const [addedAgent, setAddedAgent] = useState<string | null>(null)
  const [pubkeyError, setPubkeyError] = useState<string | null>(null)

  const resetForm = () => {
    setShowForm(false)
    setEmail('')
    setDisplayName('')
    setPublicKey('')
    setPubkeyError(null)
    setSentEmail(null)
    setAddedAgent(null)
  }

  const submitEmailInvite = (e: React.FormEvent) => {
    e.preventDefault()
    createInvitation.mutate(
      { email, role: invRole },
      {
        onSuccess: () => {
          setSentEmail(email)
          setEmail('')
          setShowForm(false)
          refetch()
        },
      },
    )
  }

  const submitPubkeyAdd = (e: React.FormEvent) => {
    e.preventDefault()
    setPubkeyError(null)
    addAgent.mutate(
      { display_name: displayName, public_key: publicKey.trim(), role: agentRole },
      {
        onSuccess: (member) => {
          setAddedAgent(member.name)
          setDisplayName('')
          setPublicKey('')
          setShowForm(false)
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            'Failed to add agent'
          setPubkeyError(msg)
        },
      },
    )
  }

  return (
    <div className="space-y-6">
      {/* Team members list */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-700">Team members</p>
            {membersData && (
              <span className="text-xs text-gray-400">({membersData.total})</span>
            )}
            {loadingMembers && (
              <span className="ml-1 inline-flex align-middle">
                <Spinner size="sm" />
              </span>
            )}
          </div>

          {/* Kind filter */}
          <div className="flex gap-1 text-xs">
            {(['all', 'human', 'agent'] as KindFilter[]).map((k) => (
              <button
                key={k}
                onClick={() => { setKindFilter(k); setMembersPage(1) }}
                className={`px-2.5 py-1 rounded-full capitalize transition-colors ${
                  kindFilter === k
                    ? 'bg-brand-100 text-brand-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {loadingMembers ? (
          <div className="p-6 text-center">
            <Spinner />
          </div>
        ) : !membersData || membersData.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">No members found.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                  <th className="text-left px-4 py-3">Member</th>
                  <th className="text-left px-4 py-3">Kind</th>
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
                            onError={(e) => {
                              ;(e.target as HTMLImageElement).style.display = 'none'
                            }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-semibold">
                            {m.name[0]?.toUpperCase() ?? '?'}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-800">{m.name}</p>
                          {m.email ? (
                            <p className="text-xs text-gray-400">{m.email}</p>
                          ) : (
                            <p className="text-xs text-gray-300 italic">agent account</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={m.kind === 'agent' ? 'orange' : 'gray'}>{m.kind}</Badge>
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
                  {Math.min(membersPage * membersData.page_size, membersData.total)} of{' '}
                  {membersData.total}
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

      {/* Pending invitations + add-member forms */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-sm font-medium text-gray-700">
            Invitations
            {loadingInv && (
              <span className="ml-2 inline-flex align-middle">
                <Spinner size="sm" />
              </span>
            )}
          </p>
          {isOwner && !showForm && (
            <button
              onClick={() => {
                setShowForm(true)
                setSentEmail(null)
                setAddedAgent(null)
              }}
              className="text-xs bg-brand-500 text-white px-3 py-1.5 rounded-lg hover:bg-brand-600 transition-colors"
            >
              + Add member
            </button>
          )}
        </div>

        {/* Add-member form */}
        {showForm && isOwner && (
          <div className="p-4 bg-gray-50 border-b space-y-3">
            {/* Mode toggle */}
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setInviteMode('email')}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  inviteMode === 'email'
                    ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-100'
                }`}
              >
                Invite by email
              </button>
              <button
                type="button"
                onClick={() => setInviteMode('pubkey')}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  inviteMode === 'pubkey'
                    ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-100'
                }`}
              >
                Add agent by public key
              </button>
            </div>

            {/* Email invite form */}
            {inviteMode === 'email' && (
              <form onSubmit={submitEmailInvite}>
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
                    disabled={createInvitation.isPending || !emailConfig?.enabled}
                    className="bg-brand-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 transition-colors"
                  >
                    {createInvitation.isPending ? 'Sending…' : 'Send invite'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2"
                  >
                    Cancel
                  </button>
                </div>
                {!emailConfig?.enabled && (
                  <p className="mt-2 text-xs text-amber-600">
                    Configure workspace email in System settings before sending invitations.
                  </p>
                )}
              </form>
            )}

            {/* Public key / agent form */}
            {inviteMode === 'pubkey' && (
              <form onSubmit={submitPubkeyAdd} className="space-y-3">
                {/* Discovery URL — give this to the agent */}
                <DiscoveryPrompt workspaceId={workspaceId ?? ''} />

                <div className="flex gap-2 items-end">
                  <div className="w-40">
                    <label className="block text-xs text-gray-500 mb-1">Display name</label>
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="My Agent"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      ed25519 public key{' '}
                      <span className="text-gray-400">(base64url, 32 bytes)</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="MCowBQYDK2VdAyEA…"
                      value={publicKey}
                      onChange={(e) => { setPublicKey(e.target.value); setPubkeyError(null) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Role</label>
                    <select
                      value={agentRole}
                      onChange={(e) => setAgentRole(e.target.value as 'operator' | 'owner')}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                    >
                      <option value="operator">Operator</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={addAgent.isPending}
                    className="bg-brand-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 transition-colors"
                  >
                    {addAgent.isPending ? 'Adding…' : 'Add agent'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2"
                  >
                    Cancel
                  </button>
                </div>
                {pubkeyError && (
                  <p className="text-xs text-red-600">{pubkeyError}</p>
                )}
              </form>
            )}
          </div>
        )}

        {/* Success banners */}
        {sentEmail && (
          <div className="px-4 py-2 bg-green-50 text-green-700 text-xs border-b">
            ✓ Invitation sent to <strong>{sentEmail}</strong>. They'll receive an email with a link
            to join.
          </div>
        )}
        {addedAgent && (
          <div className="px-4 py-2 bg-green-50 text-green-700 text-xs border-b">
            ✓ Agent <strong>{addedAgent}</strong> added. Share the discovery URL above with the
            agent owner — that&apos;s all they need to authenticate and connect.
          </div>
        )}

        {/* Invitations list */}
        {loadingInv ? (
          <div className="p-6 text-center">
            <Spinner />
          </div>
        ) : !invitations || invitations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            {isOwner
              ? emailConfig?.enabled
                ? 'No invitations yet. Add a member above.'
                : 'Configure workspace email first to send human invitations.'
              : 'No pending invitations.'}
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
