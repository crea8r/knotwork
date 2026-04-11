import { useMemo, useState } from 'react'
import { Sparkles, UserMinus, UserPlus } from 'lucide-react'
import {
  useChannelParticipantList,
  useChannelParticipants,
  useUpdateChannelParticipant,
} from '@modules/communication/frontend/api/channels'
import { useAuthStore } from '@auth'

function AgentZeroMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center rounded-full border border-white bg-brand-500 text-white shadow-sm ${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`}
      title="AgentZero"
    >
      <Sparkles size={compact ? 7 : 8} strokeWidth={2.5} />
    </span>
  )
}

function ParticipantAvatar({
  name,
  avatarUrl,
  agentZeroRole,
}: {
  name: string
  avatarUrl?: string | null
  agentZeroRole?: boolean
}) {
  return (
    <span className="relative inline-flex shrink-0">
      {avatarUrl ? (
      <img
        src={avatarUrl}
        alt={name}
        className="h-6 w-6 rounded-full border border-gray-200 object-cover"
        onError={(event) => {
          ;(event.target as HTMLImageElement).style.display = 'none'
        }}
      />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-600">
          {name[0]?.toUpperCase() ?? '?'}
        </span>
      )}
      {agentZeroRole ? <AgentZeroMark compact /> : null}
    </span>
  )
}

export default function ChannelParticipantsPanel({
  workspaceId,
  channelId,
  locked = false,
}: {
  workspaceId: string
  channelId: string
  locked?: boolean
}) {
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const currentParticipantId = user?.id ? `human:${user.id}` : null
  const isOwner = role === 'owner'
  const [selectedParticipantId, setSelectedParticipantId] = useState('')

  const { data: participants = [] } = useChannelParticipantList(workspaceId, channelId)
  const { data: workspaceParticipants = [] } = useChannelParticipants(workspaceId)
  const updateParticipant = useUpdateChannelParticipant(workspaceId, channelId)

  const activeParticipants = participants.filter((participant) => participant.subscribed)
  const inactiveParticipantIds = new Set(
    participants.filter((participant) => !participant.subscribed).map((participant) => participant.participant_id),
  )
  const availableToAdd = useMemo(() => {
    const activeIds = new Set(activeParticipants.map((participant) => participant.participant_id))
    return workspaceParticipants.filter((participant) => !activeIds.has(participant.participant_id) || inactiveParticipantIds.has(participant.participant_id))
  }, [activeParticipants, inactiveParticipantIds, workspaceParticipants])

  async function addParticipant() {
    if (!selectedParticipantId) return
    await updateParticipant.mutateAsync({ participantId: selectedParticipantId, subscribed: true })
    setSelectedParticipantId('')
  }

  function removeParticipant(participantId: string) {
    void updateParticipant.mutate({ participantId, subscribed: false })
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
        {activeParticipants.map((participant) => {
          const canRemove = !locked && (isOwner || participant.participant_id === currentParticipantId)
          return (
            <span
              key={participant.participant_id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-xs text-stone-700"
            >
              <ParticipantAvatar
                name={participant.display_name}
                avatarUrl={participant.avatar_url}
                agentZeroRole={participant.agent_zero_role}
              />
              <span className="truncate">{participant.display_name}</span>
              {canRemove ? (
                <button
                  type="button"
                  onClick={() => removeParticipant(participant.participant_id)}
                  disabled={updateParticipant.isPending}
                  className="rounded-sm p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
                  title={participant.participant_id === currentParticipantId ? 'Leave channel' : 'Remove from channel'}
                >
                  <UserMinus size={12} />
                </button>
              ) : null}
            </span>
          )
        })}
      {!locked && availableToAdd.length > 0 ? (
        <>
          <select
            value={selectedParticipantId}
            onChange={(event) => setSelectedParticipantId(event.target.value)}
            className="h-7 max-w-[160px] rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700"
          >
            <option value="">Add member</option>
            {availableToAdd.map((participant) => (
              <option key={participant.participant_id} value={participant.participant_id}>
                {participant.display_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { void addParticipant() }}
            disabled={!selectedParticipantId || updateParticipant.isPending}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700 hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
            title="Add member"
          >
            <UserPlus size={13} />
          </button>
        </>
      ) : null}
    </div>
  )
}
