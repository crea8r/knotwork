import { createElement, useMemo } from 'react'
import { useChannelMessages, useChannelDecisions } from '@modules/communication/frontend/api/channels'
import type { ChannelTimelineItem } from './ChannelFrame'
import InlineKnowledgeChangeCard from './InlineKnowledgeChangeCard'

export function decisionLabel(kind: string): string {
  switch (kind) {
    case 'approved':
    case 'accept_output':
      return 'Accepted output'
    case 'edited':
    case 'override_output':
      return 'Overrode with human output'
    case 'guided':
    case 'request_revision':
      return 'Requested revision'
    case 'aborted':
    case 'abort_run':
      return 'Aborted run'
    case 'handbook_change_requested':
      return 'Handbook change requested'
    default:
      return kind.replace(/_/g, ' ')
  }
}

interface UseChannelTimelineResult {
  items: ChannelTimelineItem[]
  isLoading: boolean
}

export function useChannelTimeline(workspaceId: string, channelId: string): UseChannelTimelineResult {
  const { data: messages = [], isLoading: messagesLoading } = useChannelMessages(workspaceId, channelId)
  const { data: decisions = [], isLoading: decisionsLoading } = useChannelDecisions(workspaceId, channelId)
  const isLoading = messagesLoading || decisionsLoading

  const items = useMemo<ChannelTimelineItem[]>(() => {
    const merged = [
      ...messages.map((m) => ({
        id: `m-${m.id}`,
        ts: new Date(m.created_at).getTime(),
        kind: 'message' as const,
        item: m,
      })),
      ...decisions.map((d) => ({
        id: `d-${d.id}`,
        ts: new Date(d.created_at).getTime(),
        kind: 'decision' as const,
        item: d,
      })),
    ].sort((a, b) => a.ts - b.ts)

    return merged.map((entry) => {
      if (entry.kind === 'message') {
        const m = entry.item
        const meta = m.metadata_ as Record<string, unknown>
        if (meta.kind === 'knowledge_change_created' && meta.inline_review === true) {
          return {
            id: entry.id,
            kind: 'custom' as const,
            content: createElement(InlineKnowledgeChangeCard, {
              workspaceId,
              channelId,
              createdAt: m.created_at,
              metadata: meta,
            }),
          }
        }
        return {
          id: entry.id,
          kind: 'message' as const,
          authorLabel: m.author_name ?? (m.author_type === 'human' ? 'You' : 'Agent'),
          mine: m.role === 'user',
          tone: (m.author_type === 'system' ? 'system' : m.author_type === 'human' ? 'human' : 'agent') as 'human' | 'agent' | 'system',
          content: m.content,
          markdown: true,
          ts: m.created_at,
        }
      }
      const d = entry.item
      return {
        id: entry.id,
        kind: 'decision' as const,
        label: decisionLabel(d.decision_type),
        actorName: d.actor_name,
        ts: d.created_at,
      }
    })
  }, [messages, decisions])

  return { items, isLoading }
}
