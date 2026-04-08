/**
 * MembersTab — Settings → Members tab.
 * Shows all workspace members (paginated) with kind filter (human/agent).
 * Owner can:
 *   - Invite a human member by email (sends invitation link)
 *   - Add an agent member by ed25519 public key (creates account immediately)
 */
import { useState } from 'react'
import { Ban, Check, CircleHelp, Pencil, Sparkles, Undo2, X } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { BACKEND_BASE_URL } from '@/api/client'
import {
  useWorkspaceInvitations,
  useCreateInvitation,
  useAddAgentMember,
  useUpdateWorkspaceMember,
  useWorkspaceEmailConfig,
  useWorkspaceMembers,
} from '@/api/auth'
import type { MemberOut } from '@/api/auth'
import Badge from '@/components/shared/Badge'
import Card from '@/components/shared/Card'
import Spinner from '@/components/shared/Spinner'

type KindFilter = 'all' | 'human' | 'agent'
type AccessFilter = 'active' | 'disabled'
type InviteMode = 'email' | 'pubkey'
type AvailabilityStatus = MemberOut['availability_status']
type CapacityLevel = MemberOut['capacity_level']

const AVAILABILITY_OPTIONS: AvailabilityStatus[] = ['available', 'focused', 'busy', 'away', 'blocked']
const CAPACITY_OPTIONS: CapacityLevel[] = ['open', 'limited', 'full']

function statusVariant(status: AvailabilityStatus): 'blue' | 'green' | 'orange' | 'red' | 'gray' {
  if (status === 'available') return 'green'
  if (status === 'focused') return 'blue'
  if (status === 'busy') return 'orange'
  if (status === 'blocked') return 'red'
  return 'gray'
}

function capacityVariant(level: CapacityLevel): 'green' | 'orange' | 'red' {
  if (level === 'open') return 'green'
  if (level === 'limited') return 'orange'
  return 'red'
}

function workItemLabel(item: Record<string, unknown>) {
  const title = item.title ?? item.name ?? item.summary ?? item.objective ?? item.description
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled'
}

function AgentZeroMark() {
  return (
    <span
      className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white bg-brand-500 text-white shadow-sm"
      title="AgentZero"
    >
      <Sparkles size={8} strokeWidth={2.5} />
    </span>
  )
}

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
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('active')
  const currentUser = useAuthStore((s) => s.user)
  const { data: membersData, isLoading: loadingMembers } = useWorkspaceMembers(
    workspaceId,
    membersPage,
    kindFilter === 'all' ? undefined : kindFilter,
    accessFilter === 'disabled',
  )
  const updateMember = useUpdateWorkspaceMember(workspaceId)
  const [showAgentZeroHelp, setShowAgentZeroHelp] = useState(false)
  const [editingBriefMemberId, setEditingBriefMemberId] = useState<string | null>(null)
  const [briefDraft, setBriefDraft] = useState('')
  const [editingStatusMemberId, setEditingStatusMemberId] = useState<string | null>(null)
  const [availabilityDraft, setAvailabilityDraft] = useState<AvailabilityStatus>('available')
  const [capacityDraft, setCapacityDraft] = useState<CapacityLevel>('open')
  const [statusNoteDraft, setStatusNoteDraft] = useState('')
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)

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

  const startBriefEdit = (memberId: string, value: string | null) => {
    setEditingBriefMemberId(memberId)
    setBriefDraft(value ?? '')
  }

  const startStatusEdit = (member: MemberOut) => {
    setEditingStatusMemberId(member.id)
    setAvailabilityDraft(member.availability_status ?? 'available')
    setCapacityDraft(member.capacity_level ?? 'open')
    setStatusNoteDraft(member.status_note ?? '')
  }

  const clearMemberModalState = () => {
    setSelectedMemberId(null)
    setEditingBriefMemberId(null)
    setEditingStatusMemberId(null)
    setBriefDraft('')
    setStatusNoteDraft('')
  }

  const selectedMember: MemberOut | null = membersData?.items.find((member) => member.id === selectedMemberId) ?? null

  const saveBrief = async (memberId: string) => {
    await updateMember.mutateAsync({ memberId, contribution_brief: briefDraft })
    setEditingBriefMemberId(null)
    setBriefDraft('')
  }

  const saveStatus = async (memberId: string) => {
    await updateMember.mutateAsync({
      memberId,
      availability_status: availabilityDraft,
      capacity_level: capacityDraft,
      status_note: statusNoteDraft,
    })
    setEditingStatusMemberId(null)
    setStatusNoteDraft('')
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAgentZeroHelp((open) => !open)}
                onBlur={() => setShowAgentZeroHelp(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title="AgentZero"
              >
                <CircleHelp size={14} />
              </button>
              {showAgentZeroHelp ? (
                <div className="absolute left-0 top-7 z-20 w-64 rounded-md border border-stone-200 bg-white p-2 text-xs leading-5 text-stone-600 shadow-lg">
                  AgentZero marks the one human or machine with the broadest workspace context to consult.
                </div>
              ) : null}
            </div>
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
            {(['active', 'disabled'] as AccessFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => { setAccessFilter(filter); setMembersPage(1) }}
                className={`px-2.5 py-1 rounded-full capitalize transition-colors ${
                  accessFilter === filter
                    ? 'bg-stone-900 text-white font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {filter}
              </button>
            ))}
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
                  <th className="text-left px-4 py-3">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {membersData.items.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => {
                      setSelectedMemberId(m.id)
                      setEditingBriefMemberId(null)
                      setEditingStatusMemberId(null)
                      setBriefDraft('')
                      setStatusNoteDraft('')
                    }}
                    className="cursor-pointer hover:bg-stone-50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
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
                          {m.agent_zero_role ? <AgentZeroMark /> : null}
                        </div>
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
                      <div className="flex items-center justify-end gap-2 sm:justify-start">
                        {m.agent_zero_role ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-brand-200 bg-brand-50 text-brand-600" title="AgentZero">
                            <Sparkles size={13} />
                          </span>
                        ) : null}
                        <Badge variant={m.access_disabled_at ? 'red' : 'green'}>
                          {m.access_disabled_at ? 'disabled' : 'active'}
                        </Badge>
                      </div>
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

      {selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative shrink-0">
                  {selectedMember.avatar_url ? (
                    <img
                      src={selectedMember.avatar_url}
                      alt={selectedMember.name}
                      className="h-9 w-9 rounded-full border border-gray-200 object-cover"
                      onError={(event) => {
                        ;(event.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600">
                      {selectedMember.name[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                  {selectedMember.agent_zero_role ? <AgentZeroMark /> : null}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">{selectedMember.name}</p>
                  {selectedMember.email ? (
                    <p className="truncate text-xs text-stone-400">{selectedMember.email}</p>
                  ) : (
                    <p className="text-xs italic text-stone-300">agent account</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={clearMemberModalState}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Close"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-stone-400">Kind</p>
                  <div className="mt-1">
                    <Badge variant={selectedMember.kind === 'agent' ? 'orange' : 'gray'}>{selectedMember.kind}</Badge>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-stone-400">Role</p>
                  <div className="mt-1">
                    <Badge variant={selectedMember.role === 'owner' ? 'blue' : 'gray'}>{selectedMember.role}</Badge>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-stone-400">Access</p>
                  <div className="mt-1">
                    <Badge variant={selectedMember.access_disabled_at ? 'red' : 'green'}>
                      {selectedMember.access_disabled_at ? 'disabled' : 'active'}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-stone-400">Joined</p>
                  <p className="mt-1 text-stone-700">{new Date(selectedMember.joined_at).toLocaleDateString()}</p>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-wide text-stone-400">Status</p>
                  {(isOwner || selectedMember.user_id === currentUser?.id) && editingStatusMemberId !== selectedMember.id ? (
                    <button
                      type="button"
                      onClick={() => startStatusEdit(selectedMember)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                  ) : null}
                </div>
                {editingStatusMemberId === selectedMember.id ? (
                  <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-stone-500">
                        Availability
                        <select
                          value={availabilityDraft}
                          onChange={(event) => setAvailabilityDraft(event.target.value as AvailabilityStatus)}
                          className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-stone-900"
                        >
                          {AVAILABILITY_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option.replace('_', ' ')}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-stone-500">
                        Capacity
                        <select
                          value={capacityDraft}
                          onChange={(event) => setCapacityDraft(event.target.value as CapacityLevel)}
                          className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-stone-900"
                        >
                          {CAPACITY_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <textarea
                      value={statusNoteDraft}
                      onChange={(event) => setStatusNoteDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditingStatusMemberId(null)
                          setStatusNoteDraft('')
                        }
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          void saveStatus(selectedMember.id)
                        }
                      }}
                      maxLength={500}
                      rows={3}
                      className="w-full resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-stone-900"
                      placeholder="Blocked on customer copy review until Friday."
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStatusMemberId(null)
                          setStatusNoteDraft('')
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                      >
                        <X size={13} />
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => { void saveStatus(selectedMember.id) }}
                        disabled={updateMember.isPending}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-stone-900 px-2.5 text-xs text-white disabled:opacity-50"
                      >
                        <Check size={13} />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant(selectedMember.availability_status)}>
                        {selectedMember.availability_status.replace('_', ' ')}
                      </Badge>
                      <Badge variant={capacityVariant(selectedMember.capacity_level)}>
                        {selectedMember.capacity_level}
                      </Badge>
                    </div>
                    {selectedMember.status_note ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{selectedMember.status_note}</p>
                    ) : null}
                    {selectedMember.status_updated_at ? (
                      <p className="mt-2 text-[11px] text-stone-400">
                        Updated {new Date(selectedMember.status_updated_at).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-wide text-stone-400">Role and objective</p>
                  {(isOwner || selectedMember.user_id === currentUser?.id) && editingBriefMemberId !== selectedMember.id ? (
                    <button
                      type="button"
                      onClick={() => startBriefEdit(selectedMember.id, selectedMember.contribution_brief)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                  ) : null}
                </div>
                {editingBriefMemberId === selectedMember.id ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      value={briefDraft}
                      onChange={(event) => setBriefDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditingBriefMemberId(null)
                          setBriefDraft('')
                        }
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          void saveBrief(selectedMember.id)
                        }
                      }}
                      maxLength={500}
                      rows={4}
                      className="w-full resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-stone-900"
                      placeholder="Product: clarify scope and translate user problems into objectives."
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBriefMemberId(null)
                          setBriefDraft('')
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                      >
                        <X size={13} />
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => { void saveBrief(selectedMember.id) }}
                        disabled={updateMember.isPending}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-stone-900 px-2.5 text-xs text-white disabled:opacity-50"
                      >
                        <Check size={13} />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    {selectedMember.contribution_brief || 'Not set'}
                  </p>
                )}
              </div>

              {(selectedMember.current_commitments.length > 0 || selectedMember.recent_work.length > 0) ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedMember.current_commitments.length > 0 ? (
                    <div>
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-stone-400">Commitments</p>
                      <div className="space-y-1.5">
                        {selectedMember.current_commitments.slice(0, 5).map((item, index) => (
                          <div key={index} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                            {workItemLabel(item)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {selectedMember.recent_work.length > 0 ? (
                    <div>
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-stone-400">Recent work</p>
                      <div className="space-y-1.5">
                        {selectedMember.recent_work.slice(0, 5).map((item, index) => (
                          <div key={index} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                            {workItemLabel(item)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2 border-t border-stone-100 pt-4">
                {isOwner ? (
                  <button
                    type="button"
                    onClick={() => updateMember.mutate({ memberId: selectedMember.id, agent_zero_role: !selectedMember.agent_zero_role })}
                    disabled={updateMember.isPending || !!selectedMember.access_disabled_at}
                    className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      selectedMember.agent_zero_role
                        ? 'border-brand-200 bg-brand-50 text-brand-600 hover:bg-brand-100'
                        : 'border-stone-200 text-stone-700 hover:bg-stone-50'
                    }`}
                  >
                    <Sparkles size={14} />
                    {selectedMember.agent_zero_role ? 'Remove AgentZero' : 'Set AgentZero'}
                  </button>
                ) : null}
                {isOwner && selectedMember.user_id !== currentUser?.id ? (
                  <button
                    type="button"
                    onClick={() => updateMember.mutate({ memberId: selectedMember.id, access_disabled: !selectedMember.access_disabled_at })}
                    disabled={updateMember.isPending}
                    className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border text-sm transition-colors disabled:opacity-50 ${
                      selectedMember.access_disabled_at
                        ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                        : 'border-red-200 text-red-700 hover:bg-red-50'
                    }`}
                  >
                    {selectedMember.access_disabled_at ? <Undo2 size={14} /> : <Ban size={14} />}
                    {selectedMember.access_disabled_at ? 'Enable access' : 'Disable access'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

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
