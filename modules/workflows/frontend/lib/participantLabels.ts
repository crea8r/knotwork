import type { NodeDef, ParticipantMentionOption } from '@data-models'

export type ParticipantLabelMap = Record<string, string>

export function buildParticipantLabelMap(participants: ParticipantMentionOption[] | undefined): ParticipantLabelMap {
  return Object.fromEntries(
    (participants ?? []).map((participant) => [
      participant.participant_id,
      participant.display_name.trim() || participant.participant_id,
    ]),
  )
}

export function resolveParticipantLabel(
  participantId: string | null | undefined,
  participantLabelMap: ParticipantLabelMap,
  fallback = 'Unassigned',
): string {
  if (!participantId) return fallback
  return participantLabelMap[participantId] ?? participantId
}

export function formatAssignedParticipants(
  assignedTo: string[] | undefined,
  participantLabelMap: ParticipantLabelMap,
): string {
  if (!assignedTo || assignedTo.length === 0) return 'Any participant'
  const labels = Array.from(
    new Set(assignedTo.map((participantId) => resolveParticipantLabel(participantId, participantLabelMap, participantId))),
  )
  return labels.join(', ')
}

export function getNodeAssignmentLabels(node: NodeDef, participantLabelMap: ParticipantLabelMap) {
  return {
    operator: resolveParticipantLabel(node.operator_id, participantLabelMap),
    supervisor: resolveParticipantLabel(node.supervisor_id, participantLabelMap),
  }
}
