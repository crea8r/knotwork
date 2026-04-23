import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Lock, Sparkles } from 'lucide-react'
import {
  useChannelMessages,
  useChannelParticipants,
  useGraphAgentZeroConsultation,
  usePostChannelMessage,
} from '@modules/communication/frontend/api/channels'
import {
  ChannelComposer,
  ChannelShell,
  ChannelTimeline,
  type ChannelTimelineItem,
} from '@modules/communication/frontend/components/ChannelFrame'

export default function WorkflowAgentZeroConsultationPanel({
  workspaceId,
  graphId,
  graphName,
  initialConsultationChannelId,
  shellClassName,
  onLatestAgentMessageIdChange,
}: {
  workspaceId: string
  graphId: string
  graphName?: string | null
  initialConsultationChannelId?: string | null
  shellClassName?: string
  onLatestAgentMessageIdChange?: (messageId: string | null) => void
}) {
  const [input, setInput] = useState('')
  const [consultChannelId, setConsultChannelId] = useState(initialConsultationChannelId?.trim() ?? '')
  const [consultationError, setConsultationError] = useState<string | null>(null)
  const consultationRequestedRef = useRef(false)
  const openConsultation = useGraphAgentZeroConsultation(workspaceId, graphId)
  const { data: workspaceParticipants = [] } = useChannelParticipants(workspaceId)
  const agentZeroParticipant = useMemo(
    () => workspaceParticipants.find((participant) => participant.agent_zero_role) ?? null,
    [workspaceParticipants],
  )
  const agentZeroName = agentZeroParticipant?.display_name ?? 'AgentZero'
  const { data: messages = [] } = useChannelMessages(workspaceId, consultChannelId)
  const postMessage = usePostChannelMessage(workspaceId, consultChannelId)

  useEffect(() => {
    const seededChannelId = initialConsultationChannelId?.trim() ?? ''
    if (!seededChannelId) return
    setConsultChannelId((current) => current || seededChannelId)
    consultationRequestedRef.current = true
    setConsultationError(null)
  }, [initialConsultationChannelId])

  useEffect(() => {
    if (!agentZeroParticipant || consultChannelId || consultationRequestedRef.current || openConsultation.isPending) {
      return
    }
    setConsultationError(null)
    consultationRequestedRef.current = true
    openConsultation.mutate(undefined, {
      onSuccess: (channel) => {
        if (!channel?.id) {
          setConsultationError('AgentZero consultation opened without a usable channel id.')
          return
        }
        setConsultChannelId(channel.id)
        setConsultationError(null)
      },
      onError: (error: unknown) => {
        const detail =
          typeof error === 'object' && error && 'response' in error
            ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : null
        const message =
          detail
          ?? (error instanceof Error ? error.message : null)
          ?? 'Unable to open AgentZero consultation.'
        setConsultationError(message)
      },
    })
  }, [agentZeroParticipant, consultChannelId, openConsultation.isPending, openConsultation.mutate])

  useEffect(() => {
    if (consultChannelId) {
      consultationRequestedRef.current = true
      return
    }
    if (!agentZeroParticipant) {
      consultationRequestedRef.current = false
      setConsultationError(null)
    }
  }, [agentZeroParticipant, consultChannelId])

  const latestAssistantMessageId = useMemo(() => {
    const latest = [...messages]
      .reverse()
      .find((message) => message.author_type === 'agent')
    return latest?.id ?? null
  }, [messages])

  useEffect(() => {
    onLatestAgentMessageIdChange?.(latestAssistantMessageId)
  }, [latestAssistantMessageId, onLatestAgentMessageIdChange])

  const timelineItems = useMemo<ChannelTimelineItem[]>(() => {
    const items: ChannelTimelineItem[] = messages.map((message) => ({
      id: message.id,
      kind: 'message',
      authorLabel: message.author_name?.trim() || (message.author_type === 'agent' ? agentZeroName : 'You'),
      mine: message.author_type === 'human',
      tone: message.author_type === 'agent' ? 'agent' : message.author_type === 'system' ? 'system' : 'human',
      content: message.content,
      ts: message.created_at,
    }))

    if (postMessage.isPending) {
      items.push({
        id: 'workflow-consultation-pending',
        kind: 'message',
        authorLabel: 'You',
        mine: true,
        tone: 'human',
        content: 'Sending…',
      })
    }

    return items
  }, [agentZeroName, messages, postMessage.isPending])

  async function send() {
    const text = input.trim()
    if (!text || !consultChannelId || postMessage.isPending) return
    setInput('')
    await postMessage.mutateAsync({
      content: text,
      role: 'user',
      author_type: 'human',
      author_name: 'You',
    })
  }

  function retryConsultation() {
    consultationRequestedRef.current = false
    setConsultChannelId('')
    setConsultationError(null)
  }

  if (!agentZeroParticipant) {
    return (
      <div data-ui="consultation.workflow.panel" className="flex h-full min-h-0 flex-col">
        <ChannelShell
          typeIcon={<GitBranch size={14} />}
          title={graphName ?? 'Workflow chat'}
          description="Assign an AgentZero member to unlock workflow editor chat."
          parentLabel="Chat unavailable"
          shellClassName={shellClassName}
        >
          <div data-ui="consultation.workflow.unavailable" className="flex flex-1 items-center justify-center bg-[#faf7f1] p-6">
            <div className="max-w-md rounded-3xl border border-stone-200 bg-white p-6 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                <Lock size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-stone-900">AgentZero required</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                The workflow editor chat now runs as a real private conversation with AgentZero.
                Assign an AgentZero member in Settings to unlock it.
              </p>
            </div>
          </div>
        </ChannelShell>
      </div>
    )
  }

  return (
    <div data-ui="consultation.workflow.panel" className="flex h-full min-h-0 flex-col">
      <ChannelShell
        typeIcon={<Sparkles size={14} />}
        title={`${graphName ?? 'Workflow chat'} · ${agentZeroName}`}
        description={`Private workflow editor consultation with ${agentZeroName}. The agent can update the workflow draft through Knotwork MCP tools.`}
        parentLabel={
          consultChannelId
            ? 'Private AgentZero consultation'
            : consultationError
              ? 'Consultation unavailable'
              : 'Opening consultation…'
        }
        shellClassName={shellClassName}
        topPanel={!consultChannelId && consultationError ? (
          <div
            data-ui="consultation.workflow.error"
            className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <p className="font-medium">Could not open AgentZero consultation</p>
            <p className="mt-1">{consultationError}</p>
            <button
              type="button"
              onClick={retryConsultation}
              data-ui="consultation.workflow.retry"
              className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
            >
              Retry
            </button>
          </div>
        ) : null}
      >
        <ChannelTimeline
          items={timelineItems}
          emptyState="Ask AgentZero to inspect or update this workflow draft."
        />
        <ChannelComposer
          draft={input}
          setDraft={setInput}
          onSend={() => { void send() }}
          pending={postMessage.isPending || openConsultation.isPending}
          placeholder={
            consultChannelId
              ? `Ask ${agentZeroName} to inspect or update this workflow…`
              : consultationError
                ? 'Retry opening AgentZero consultation…'
                : 'Opening AgentZero consultation…'
          }
          rows={4}
        />
      </ChannelShell>
    </div>
  )
}
