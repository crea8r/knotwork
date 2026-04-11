import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Lock, Sparkles } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceMembers } from "@modules/admin/frontend/api/auth"
import {
  useChannelMessages,
  useGraphAgentZeroConsultation,
  usePostChannelMessage,
} from '@modules/communication/frontend/api/channels'
import { useGraph } from "@modules/workflows/frontend/api/graphs"
import { ChannelComposer, ChannelShell, ChannelTimeline, type ChannelTimelineItem } from '@modules/communication/frontend/components/ChannelFrame'
import { useAuthStore } from '@auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

interface Props {
  graphId: string
  sessionId: string
  initialConsultationChannelId?: string | null
  onBeforeApplyDelta?: () => void
  shellClassName?: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function DesignerChat({ graphId, initialConsultationChannelId, shellClassName }: Props) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [consultChannelId, setConsultChannelId] = useState(initialConsultationChannelId?.trim() ?? '')
  const [consultationError, setConsultationError] = useState<string | null>(null)
  const consultationRequestedRef = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)

  const { data: graph } = useGraph(workspaceId, graphId)
  const { data: agentMembers } = useWorkspaceMembers(workspaceId, 1, 'agent', false)
  const agentZero = agentMembers?.items.find((member) => member.agent_zero_role) ?? null
  const agentZeroName = agentZero?.name ?? 'AgentZero'
  const openConsultation = useGraphAgentZeroConsultation(workspaceId, graphId)
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
    if (!agentZero || consultChannelId || consultationRequestedRef.current || openConsultation.isPending) {
      return
    }
    setConsultationError(null)
    consultationRequestedRef.current = true
    openConsultation.mutate(undefined, {
      onSuccess: (channel) => {
        if (!channel?.id) {
          consultationRequestedRef.current = false
          setConsultationError('AgentZero consultation opened without a usable channel id.')
          return
        }
        setConsultChannelId(channel.id)
        setConsultationError(null)
      },
      onError: (error: unknown) => {
        consultationRequestedRef.current = false
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
  }, [agentZero, consultChannelId, openConsultation.isPending, openConsultation.mutate])

  useEffect(() => {
    if (consultChannelId) {
      consultationRequestedRef.current = true
      return
    }
    if (!agentZero) {
      consultationRequestedRef.current = false
      setConsultationError(null)
    }
  }, [agentZero, consultChannelId])

  function retryConsultation() {
    consultationRequestedRef.current = false
    setConsultChannelId('')
    setConsultationError(null)
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const latestAssistantMessageId = useMemo(() => {
    const latest = [...messages]
      .reverse()
      .find((message) => message.author_type === 'agent')
    return latest?.id ?? null
  }, [messages])

  useEffect(() => {
    if (!latestAssistantMessageId) return
    qc.invalidateQueries({ queryKey: ['graph', graphId] })
    qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
  }, [graphId, latestAssistantMessageId, qc])

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

  if (!agentZero) {
    return (
      <ChannelShell
        typeIcon={<GitBranch size={14} />}
        title={graph?.name ?? 'Workflow chat'}
        description="Assign an AgentZero member to unlock workflow editor chat."
        parentLabel="Chat unavailable"
        shellClassName={shellClassName}
      >
        <div className="flex flex-1 items-center justify-center bg-[#faf7f1] p-6">
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
    )
  }

  const timelineItems: ChannelTimelineItem[] = messages.map((message) => ({
    id: message.id,
    kind: 'message',
    authorLabel: message.author_name?.trim() || (message.author_type === 'agent' ? agentZeroName : 'You'),
    mine: message.author_type === 'human',
    tone: message.author_type === 'agent' ? 'agent' : message.author_type === 'system' ? 'system' : 'human',
    content: (
      <div>
        <p>{message.content}</p>
        <p className="mt-2 text-[10px] opacity-60">{relativeTime(message.created_at)}</p>
      </div>
    ),
  }))

  if (postMessage.isPending) {
    timelineItems.push({
      id: 'designer-pending',
      kind: 'message',
      authorLabel: 'You',
      mine: true,
      tone: 'human',
      content: 'Sending…',
    })
  }

  return (
    <ChannelShell
      typeIcon={<Sparkles size={14} />}
      title={`${graph?.name ?? 'Workflow chat'} · ${agentZeroName}`}
      description={`Private workflow editor consultation with ${agentZeroName}. The agent can update the workflow draft through Knotwork MCP tools.`}
      parentLabel={
        consultChannelId
          ? 'Private AgentZero consultation'
          : consultationError
            ? 'Consultation unavailable'
            : 'Opening consultation…'
      }
      shellClassName={shellClassName}
    >
      {!consultChannelId && consultationError ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Could not open AgentZero consultation</p>
          <p className="mt-1">{consultationError}</p>
          <button
            type="button"
            onClick={retryConsultation}
            className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      ) : null}
      <ChannelTimeline
        items={timelineItems}
        emptyState="Ask AgentZero to inspect or update this workflow draft."
      />
      <div ref={endRef} />
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
  )
}
