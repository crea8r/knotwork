import { useEffect, useMemo, useState, type RefObject, type ReactNode } from 'react'
import { useChannelParticipants } from '@modules/communication/frontend/api/channels'

interface MentionDetection {
  mentionMenuNode: ReactNode
  hasMentions: boolean
}

export function useMentionDetection(
  workspaceId: string,
  draft: string,
  setDraft: (value: string) => void,
  inputRef: RefObject<HTMLTextAreaElement | null>,
): MentionDetection {
  const { data: participants = [] } = useChannelParticipants(workspaceId)
  const [menuSuppressed, setMenuSuppressed] = useState(false)

  const activeMention = useMemo(() => {
    const cursor = inputRef.current?.selectionStart ?? draft.length
    const beforeCursor = draft.slice(0, cursor)
    const match = beforeCursor.match(/(^|\s)@([A-Za-z0-9._-]*)$/)
    if (!match || match.index == null) return null
    const query = match[2] ?? ''
    const start = match.index + match[1].length
    return { query: query.toLowerCase(), start, end: cursor }
  }, [draft, inputRef])

  useEffect(() => {
    if (!activeMention) {
      setMenuSuppressed(false)
    }
  }, [activeMention])

  const mentionSuggestions = useMemo(() => {
    if (!activeMention || menuSuppressed) return []
    return participants
      .filter((p) => p.mention_handle)
      .filter((p) => {
        const handle = (p.mention_handle ?? '').toLowerCase()
        const name = p.display_name.toLowerCase()
        return !activeMention.query || handle.includes(activeMention.query) || name.includes(activeMention.query)
      })
      .slice(0, 6)
  }, [activeMention, menuSuppressed, participants])

  function insertMention(handle: string) {
    if (!activeMention) return
    setMenuSuppressed(true)
    const next = `${draft.slice(0, activeMention.start)}@${handle} ${draft.slice(activeMention.end)}`
    setDraft(next)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const pos = activeMention.start + handle.length + 2
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const mentionMenuNode: ReactNode =
    mentionSuggestions.length > 0 ? (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {mentionSuggestions.map((participant) => (
          <button
            key={participant.participant_id}
            type="button"
            onClick={() => insertMention(participant.mention_handle ?? '')}
            className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
          >
            <div className="text-sm text-gray-800">{participant.display_name}</div>
            <div className="text-xs text-gray-500">
              @{participant.mention_handle}
              {participant.email ? ` · ${participant.email}` : ''}
            </div>
          </button>
        ))}
      </div>
    ) : null

  return { mentionMenuNode, hasMentions: mentionSuggestions.length > 0 }
}
