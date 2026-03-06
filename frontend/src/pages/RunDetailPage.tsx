import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import {
  Play, Trash2, Pencil, Check, Send, CheckCircle2, XCircle, Map as MapIcon, X, Bug,
} from 'lucide-react'
import { useRun, useRunNodes, useDeleteRun, useExecuteRunInline, useRenameRun, useRunOpenAILogs, useRunWorklog, useRunChatMessages } from '@/api/runs'
import { useGraphVersion } from '@/api/graphs'
import { useEscalations, useResolveEscalationAny } from '@/api/escalations'
import { useRegisteredAgents } from '@/api/agents'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import StatusBadge from '@/components/shared/StatusBadge'
import Spinner from '@/components/shared/Spinner'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import RunInputPanel from '@/components/operator/RunInputPanel'
import { useAuthStore } from '@/store/auth'
import type { Escalation, NodeStatus } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const TERMINAL = new Set(['completed', 'failed', 'stopped'])
const ACTIVE = new Set(['queued', 'running'])
const DELETABLE = new Set(['completed', 'failed', 'stopped', 'draft', 'queued', 'paused'])

type ChatRole = 'assistant' | 'user' | 'system'
type ChatItem = {
  id: string
  role: ChatRole
  speaker: string
  speakerAgentId?: string
  nodeId?: string
  nodeName?: string
  text: string
  markdown?: boolean
  raw: unknown
  ts?: string | null
}

function InlineRename({ runId, workspaceId, currentName }: { runId: string; workspaceId: string; currentName: string | null }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentName ?? '')
  const rename = useRenameRun(workspaceId)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    if (value.trim()) rename.mutate({ runId, name: value.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="border border-brand-400 rounded px-2 py-0.5 text-sm font-semibold text-gray-900 outline-none w-56"
        />
        <button onClick={commit} className="text-green-600 hover:text-green-700"><Check size={14} /></button>
      </div>
    )
  }
  return (
    <button
      onClick={() => { setValue(currentName ?? ''); setEditing(true) }}
      className="flex items-center gap-1 group"
      title="Click to rename"
    >
      <span className="font-semibold text-gray-900 text-sm">
        {currentName ?? <span className="text-gray-400 font-normal">Untitled run</span>}
      </span>
      <Pencil size={11} className="text-gray-300 group-hover:text-gray-500" />
    </button>
  )
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function humanizeInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input)
  if (!entries.length) return 'No input provided.'
  return entries
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : formatJson(v)}`)
    .join('\n')
}

function maybeString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value
}

function resolutionMessage(esc: Escalation): string | null {
  const data = (esc.resolution_data ?? {}) as Record<string, unknown>
  if (data.note === 'superseded_by_new_escalation') return null
  if ((esc.resolution === 'request_revision' || esc.resolution === 'guided') && typeof data.guidance === 'string' && data.guidance.trim()) {
    return data.guidance
  }
  const override = data.override_output ?? data.edited_output
  if ((esc.resolution === 'override_output' || esc.resolution === 'edited') && override != null) {
    if (typeof override === 'object' && override && 'text' in (override as Record<string, unknown>)) {
      return String((override as Record<string, unknown>).text ?? '')
    }
    return formatJson(override)
  }
  if (esc.resolution === 'accept_output' || esc.resolution === 'approved') return 'Accepted output. Continue.'
  if (esc.resolution === 'abort_run' || esc.resolution === 'aborted') return 'Abort this run.'
  return null
}

function MessageBubble({
  item,
  highlighted,
  dimmed,
  onClick,
}: {
  item: ChatItem
  highlighted: boolean
  dimmed: boolean
  onClick?: () => void
}) {
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div
      className={`max-w-[90%] ${item.role === 'user' ? 'ml-auto' : 'mr-auto'}`}
      style={{
        opacity: dimmed ? 0.58 : 1,
        transition: 'opacity 160ms ease',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        {item.speakerAgentId ? (
          <Link to={`/agents/${item.speakerAgentId}`} className="text-[10px] uppercase tracking-wide text-brand-600 hover:underline">
            {item.speaker}{item.nodeName ? ` • ${item.nodeName}` : ''}
          </Link>
        ) : (
          <p className="text-[10px] uppercase tracking-wide text-gray-400">
            {item.speaker}{item.nodeName ? ` • ${item.nodeName}` : ''}
          </p>
        )}
        <button
          onClick={() => setShowRaw(v => !v)}
          className="text-[10px] text-gray-400 hover:text-gray-700 inline-flex items-center gap-1"
        >
          <Bug size={11} /> {showRaw ? 'Hide raw' : 'Raw'}
        </button>
      </div>

      <div
        onClick={onClick}
        className={`w-full text-left rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed border transition-colors ${
          item.role === 'assistant'
            ? 'bg-white text-gray-800 border-gray-200 shadow-sm'
            : item.role === 'user'
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-gray-100 text-gray-600 border-gray-200'
        } ${highlighted ? 'ring-4 ring-blue-600 shadow-[0_8px_18px_rgba(37,99,235,0.28)] scale-[1.04]' : ''} select-text`}
        style={highlighted ? { boxShadow: '0 0 0 10px rgba(37,99,235,0.32), 0 8px 18px rgba(37,99,235,0.28)' } : undefined}
      >
        {item.markdown ? <MarkdownViewer content={item.text} maxHeight="24rem" /> : item.text}
      </div>

      {showRaw && (
        <pre className="mt-2 bg-black text-green-200 rounded-lg p-3 text-[11px] overflow-auto max-h-56">
          {formatJson(item.raw)}
        </pre>
      )}
      {item.ts && (
        <p className="text-[10px] text-gray-400 mt-1">
          {new Date(item.ts).toLocaleString()}
        </p>
      )}
    </div>
  )
}

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const { data: run, refetch: refetchRun } = useRun(workspaceId, runId!, {
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)?.status
      return !status || ACTIVE.has(status) ? 2000 : false
    },
  })
  const { data: nodeStates = [], refetch: refetchNodes } = useRunNodes(workspaceId, runId!, {
    refetchInterval: run && ACTIVE.has(run.status) ? 3000 : false,
  })
  const { data: graphVersion } = useGraphVersion(workspaceId, run?.graph_version_id ?? '')
  const { data: openaiLogs = [] } = useRunOpenAILogs(workspaceId, runId!, {
    refetchInterval: run && ACTIVE.has(run.status) ? 3000 : false,
  })
  const { data: worklogEntries = [] } = useRunWorklog(workspaceId, runId!, {
    refetchInterval: run && ACTIVE.has(run.status) ? 3000 : false,
  })
  const { data: runMessages = [] } = useRunChatMessages(workspaceId, runId!, {
    refetchInterval: run && (ACTIVE.has(run.status) || run.status === 'paused') ? 2000 : false,
  })
  const { data: escalations = [], refetch: refetchEscalations } = useEscalations(workspaceId)
  const { data: agents = [] } = useRegisteredAgents()
  const deleteRun = useDeleteRun(workspaceId)
  const executeInline = useExecuteRunInline(workspaceId)
  const resolveEscalation = useResolveEscalationAny(workspaceId)

  const definition = graphVersion?.definition ?? { nodes: [], edges: [] }
  const nodeStatuses = Object.fromEntries(nodeStates.map((n) => [n.node_id, n.status as NodeStatus]))
  const nodeNameMap = Object.fromEntries((definition.nodes ?? []).map(n => [n.id, n.name]))
  const nodeSpeakerMap = useMemo(() => {
    const byId = new Map(agents.map(a => [a.id, a.display_name]))
    const map = new Map<string, string>()
    const mapAgentId = new Map<string, string>()
    for (const n of definition.nodes ?? []) {
      if (n.type !== 'agent') continue
      if (n.agent_ref === 'human') {
        map.set(n.id, 'Human')
        continue
      }
      const rid = typeof n.registered_agent_id === 'string' ? n.registered_agent_id : ''
      if (rid && byId.has(rid)) {
        map.set(n.id, byId.get(rid)!)
        mapAgentId.set(n.id, rid)
      } else if (n.agent_ref) {
        map.set(n.id, n.agent_ref)
      } else {
        map.set(n.id, 'Agent')
      }
    }
    return { nameMap: map, agentIdMap: mapAgentId }
  }, [agents, definition.nodes])

  const [showInputPanel, setShowInputPanel] = useState(false)
  const [showMobileMap, setShowMobileMap] = useState(false)
  const [guidance, setGuidance] = useState('')
  const [overrideOutput, setOverrideOutput] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [awaitingAgentAfterReply, setAwaitingAgentAfterReply] = useState(false)
  const [lockedEscalationId, setLockedEscalationId] = useState<string | null>(null)

  const runEscalations = useMemo(
    () =>
      escalations
        .filter((e) => e.run_id === runId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [escalations, runId],
  )
  // If multiple opens exist (e.g. retries), the newest one is the active question.
  const openEscalation = [...runEscalations].reverse().find((e) => e.status === 'open') ?? null

  const wsRef = useRef<WebSocket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!runId || (run && TERMINAL.has(run.status))) return
    const apiBase = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1').replace(/^http/, 'ws')
    const ws = new WebSocket(`${apiBase}/ws/runs/${runId}`)
    wsRef.current = ws
    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string)
        if (event.type === 'node_completed' || event.type === 'escalation_created') refetchNodes()
        if (event.type === 'escalation_created' || event.type === 'escalation_resolved') refetchEscalations()
        if (event.type === 'run_status_changed' || event.type === 'escalation_resolved') refetchRun()
      } catch {
        // Ignore malformed events
      }
    }
    return () => { ws.close(); wsRef.current = null }
  }, [runId, run?.status, refetchRun, refetchNodes, refetchEscalations])

  useEffect(() => {
    if (run?.status === 'running' || openEscalation) {
      setAwaitingAgentAfterReply(false)
    }
  }, [run?.status, openEscalation])

  useEffect(() => {
    if (!lockedEscalationId) return
    if (openEscalation && openEscalation.id !== lockedEscalationId) {
      setLockedEscalationId(null)
      setAwaitingAgentAfterReply(false)
      return
    }
    if (!openEscalation && run && run.status !== 'paused') {
      setLockedEscalationId(null)
      setAwaitingAgentAfterReply(false)
    }
  }, [lockedEscalationId, openEscalation, run])

  const chatItems: ChatItem[] = useMemo(() => {
    const items: ChatItem[] = []
    if (!run) return items

    if (runMessages.length > 0) {
      return runMessages.map((m) => {
        const role: ChatRole =
          m.role === 'assistant' || m.role === 'user'
            ? m.role
            : 'system'
        return {
          id: m.id,
          role,
          speaker: m.author_name || (m.author_type === 'human' ? 'You' : m.author_type === 'agent' ? 'Agent' : 'Knotwork'),
          nodeId: m.node_id ?? undefined,
          nodeName: m.node_id ? (nodeNameMap[m.node_id] ?? m.node_id) : undefined,
          text: m.content,
          markdown: role === 'assistant',
          raw: m.metadata_ ?? {},
          ts: m.created_at,
        }
      })
    }

    items.push({
      id: `run-input-${run.id}`,
      role: 'user',
      speaker: 'You',
      text: `Started run with:\n${humanizeInput(run.input)}`,
      raw: run.input,
      ts: run.created_at,
    })

    const escalationsByNodeState = new Map<string, Escalation[]>()
    for (const esc of runEscalations) {
      const key = esc.run_node_state_id
      const arr = escalationsByNodeState.get(key) ?? []
      arr.push(esc)
      escalationsByNodeState.set(key, arr)
    }

    for (const ns of nodeStates) {
      const nodeName = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
      const speaker = nodeSpeakerMap.nameMap.get(ns.node_id) ?? (ns.agent_ref || 'Agent')
      const speakerAgentId = nodeSpeakerMap.agentIdMap.get(ns.node_id)

      const relatedEscalations = (escalationsByNodeState.get(ns.id) ?? [])
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      for (const relatedEsc of relatedEscalations) {
        const ctx = relatedEsc.context as Record<string, unknown>
        const q = typeof ctx.question === 'string'
          ? ctx.question
          : (typeof ctx.prompt === 'string' ? ctx.prompt : null)
        if (q) {
          const opts = Array.isArray(ctx.options) ? ctx.options.map(String) : []
          const readable = opts.length
            ? `${q}\n\nOptions:\n${opts.map((x) => `- ${x}`).join('\n')}`
            : q
          items.push({
            id: `esc-q-${relatedEsc.id}`,
            role: 'assistant',
            speaker,
            speakerAgentId,
            nodeId: ns.node_id,
            nodeName,
            text: readable,
            raw: relatedEsc.context,
            ts: relatedEsc.created_at,
          })
        }

        const response = resolutionMessage(relatedEsc)
        if (response) {
          items.push({
            id: `esc-a-${relatedEsc.id}`,
            role: 'user',
            speaker: 'You',
            nodeId: ns.node_id,
            nodeName,
            text: response,
            raw: relatedEsc.resolution_data,
            ts: relatedEsc.resolved_at,
          })
        }
      }

      const out = ns.output as Record<string, unknown> | null
      if (out && typeof out.text === 'string' && out.text.trim()) {
        items.push({
          id: `node-out-${ns.id}`,
          role: 'assistant',
            speaker,
            speakerAgentId,
            nodeId: ns.node_id,
          nodeName,
          text: out.text,
          markdown: true,
          raw: ns.output,
          ts: ns.completed_at,
        })
      }

      if (ns.status === 'failed' && ns.error) {
        items.push({
          id: `node-err-${ns.id}`,
          role: 'system',
          speaker: 'Knotwork',
          nodeId: ns.node_id,
          nodeName,
          text: `Node failed: ${ns.error}`,
          raw: { error: ns.error },
          ts: ns.completed_at,
        })
      }
    }

    items.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : Number.MAX_SAFE_INTEGER
      const tb = b.ts ? new Date(b.ts).getTime() : Number.MAX_SAFE_INTEGER
      if (ta !== tb) return ta - tb
      return a.id.localeCompare(b.id)
    })

    if (run.status === 'running') {
      items.push({
        id: `run-live-${run.id}`,
        role: 'system',
        speaker: 'Knotwork',
        text: 'Agent is thinking…',
        raw: { status: run.status },
        ts: null,
      })
    }
    if (awaitingAgentAfterReply && run.status === 'paused' && !openEscalation) {
      items.push({
        id: `run-resume-wait-${run.id}`,
        role: 'system',
        speaker: 'Knotwork',
        text: 'Your response was sent. Agent is working…',
        raw: { status: run.status, waiting: true },
        ts: null,
      })
    }

    return items
  }, [run, runMessages, nodeStates, nodeNameMap, nodeSpeakerMap, runEscalations, awaitingAgentAfterReply, openEscalation])

  const nodeOpenAIIds = useMemo(() => {
    type OpenAIIdRow = {
      nodeStateId: string
      nodeId: string
      nodeName: string
      assistantId: string | null
      threadId: string | null
      runId: string | null
      startedAt: string | null
    }
    const rows: OpenAIIdRow[] = []
    for (const ns of nodeStates) {
      const input = (ns.input ?? {}) as Record<string, unknown>
      const ids = (input.openai_ids ?? {}) as Record<string, unknown>
      const assistantId = maybeString(ids.assistant_id)
      const threadId = maybeString(ids.thread_id)
      const openaiRunId = maybeString(ids.run_id)
      if (!assistantId && !threadId && !openaiRunId) continue
      rows.push({
        nodeStateId: ns.id,
        nodeId: ns.node_id,
        nodeName: nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id,
        assistantId,
        threadId,
        runId: openaiRunId,
        startedAt: ns.started_at,
      })
    }
    rows.sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0
      return ta - tb
    })
    return rows
  }, [nodeStates, nodeNameMap])

  const toolCallLogs = useMemo(
    () => worklogEntries.filter((e) => e.entry_type === 'tool_call' || e.entry_type === 'action' || !!((e.metadata_ ?? {}) as Record<string, unknown>).tool),
    [worklogEntries],
  )

  const promptAttempts = useMemo(() => {
    return nodeStates
      .map((ns) => {
        const input = (ns.input ?? {}) as Record<string, unknown>
        const systemPrompt = typeof input.system_prompt === 'string' ? input.system_prompt : ''
        const userPrompt = typeof input.user_prompt === 'string' ? input.user_prompt : ''
        const humanGuidance = typeof input.human_guidance === 'string' ? input.human_guidance : ''
        return {
          id: ns.id,
          nodeId: ns.node_id,
          nodeName: nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id,
          startedAt: ns.started_at,
          systemPrompt,
          userPrompt,
          humanGuidance,
          runInput: input.run_input ?? null,
          priorOutputs: input.prior_outputs ?? null,
        }
      })
      .filter((x) => x.systemPrompt || x.userPrompt || x.humanGuidance)
      .sort((a, b) => new Date(a.startedAt ?? 0).getTime() - new Date(b.startedAt ?? 0).getTime())
  }, [nodeStates, nodeNameMap])

  useEffect(() => {
    const el = chatScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chatItems.length, run?.status])

  async function handleDelete() {
    if (!confirm('Delete this run? This cannot be undone.')) return
    try {
      await deleteRun.mutateAsync(runId!)
      navigate('/runs')
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.detail ?? err.message)
        : String(err)
      alert(`Delete failed: ${message}`)
    }
  }

  async function sendGuidance(value: string) {
    if (!openEscalation) return
    const trimmed = value.trim()
    if (!trimmed) return
    setAwaitingAgentAfterReply(true)
    await resolveEscalation.mutateAsync({
      escalationId: openEscalation.id,
      data: { resolution: 'request_revision', guidance: trimmed },
    })
    setLockedEscalationId(openEscalation.id)
    setGuidance('')
    refetchEscalations()
    refetchRun()
    refetchNodes()
  }

  if (!run) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  const isDeletable = DELETABLE.has(run.status)
  const isReplyLocked = !!openEscalation && lockedEscalationId === openEscalation.id
  const quickOptions = openEscalation && Array.isArray((openEscalation.context as Record<string, unknown>).options)
    ? ((openEscalation.context as Record<string, unknown>).options as unknown[]).map((x) => String(x))
    : []

  return (
    <div className="h-full flex flex-col pt-11 md:pt-0">
      <div className="px-4 md:px-6 py-3 border-b border-gray-200 bg-white flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-xs text-gray-400">Run</p>
          <p className="font-mono text-xs text-gray-400">{runId?.slice(0, 8)}…</p>
        </div>
        <InlineRename runId={runId!} workspaceId={workspaceId} currentName={run.name} />
        <StatusBadge status={run.status} />
        <button
          onClick={() => setShowInputPanel((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
            showInputPanel
              ? 'border-brand-400 text-brand-600 bg-brand-50'
              : 'border-gray-200 text-gray-600 hover:border-gray-400'
          }`}
        >
          Input
        </button>
        <button
          onClick={() => setShowMobileMap(true)}
          className="xl:hidden flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400"
        >
          <MapIcon size={12} />
          Workflow map
        </button>
        {(run.status === 'queued' || run.status === 'draft') && (
          <button
            onClick={() => executeInline.mutate(runId!, {
              onSuccess: () => { refetchRun(); refetchNodes() },
              onError: () => { refetchRun(); refetchNodes() },
            })}
            disabled={executeInline.isPending || executeInline.isSuccess}
            className="flex items-center gap-1.5 text-xs bg-brand-500 text-white px-3 py-1.5 rounded-lg hover:bg-brand-600 disabled:opacity-50"
          >
            <Play size={12} /> {executeInline.isPending || executeInline.isSuccess ? 'Starting…' : 'Run now'}
          </button>
        )}
        {wsConnected && run.status === 'running' && (
          <span className="text-xs text-blue-500 animate-pulse">live</span>
        )}
        {isDeletable && (
          <button
            onClick={handleDelete}
            disabled={deleteRun.isPending}
            className="ml-auto flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
          >
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col min-h-0 border-r border-gray-200 bg-[#f7f8fb]">
          <div className="px-4 md:px-5 pt-3">
            <details className="rounded-xl border border-gray-200 bg-white">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs text-gray-700 font-medium flex items-center justify-between">
                <span>OpenAI Debug ({openaiLogs.length} calls / {nodeOpenAIIds.length} node IDs / {promptAttempts.length} prompts / {toolCallLogs.length} tool calls)</span>
                <span className="text-[11px] text-gray-400">Expand</span>
              </summary>
              <div className="px-3 pb-3 space-y-3 border-t border-gray-100">
                <div className="overflow-auto">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 mt-2 mb-1">Prompt Attempts</p>
                  <div className="space-y-2">
                    {promptAttempts.map((p) => (
                      <details key={p.id} className="rounded-lg border border-gray-200 bg-gray-50">
                        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-gray-700 flex items-center justify-between">
                          <span className="font-mono">
                            {p.startedAt ? new Date(p.startedAt).toLocaleString() : '-'} • {p.nodeName}
                          </span>
                          <span className="text-gray-400">System/User prompt + context</span>
                        </summary>
                        <div className="px-3 pb-3 border-t border-gray-200 space-y-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-gray-500 mt-2 mb-1">System Prompt</p>
                            <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-72 whitespace-pre-wrap">{p.systemPrompt || '(empty)'}</pre>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-gray-500 mt-2 mb-1">User Prompt</p>
                            <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-72 whitespace-pre-wrap">{p.userPrompt || '(empty)'}</pre>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Human Guidance</p>
                              <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-48">{p.humanGuidance || '(none)'}</pre>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Run Input</p>
                              <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-48">{formatJson(p.runInput)}</pre>
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Prior Outputs</p>
                            <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-48">{formatJson(p.priorOutputs)}</pre>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>

                <div className="overflow-auto">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 mt-2 mb-1">Tool Call Logs</p>
                  <table className="w-full text-[11px] min-w-[780px]">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-1 pr-3">Time</th>
                        <th className="text-left py-1 pr-3">Tool</th>
                        <th className="text-left py-1 pr-3">Node</th>
                        <th className="text-left py-1 pr-3">Input/Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolCallLogs.map((row) => {
                        const md = (row.metadata_ ?? {}) as Record<string, unknown>
                        const tool = typeof md.tool === 'string' ? md.tool : row.content
                        return (
                          <tr key={row.id} className="border-b border-gray-100 align-top">
                            <td className="py-1 pr-3 text-gray-600 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                            <td className="py-1 pr-3 font-mono text-gray-800">{tool}</td>
                            <td className="py-1 pr-3 font-mono text-gray-700">{row.node_id}</td>
                            <td className="py-1 pr-3">
                              <details>
                                <summary className="cursor-pointer text-brand-600 hover:underline">View input/output</summary>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-2">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Input</p>
                                    <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-44">{formatJson(md.input)}</pre>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Output</p>
                                    <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-44">{formatJson(md.output)}</pre>
                                  </div>
                                </div>
                              </details>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {nodeOpenAIIds.length > 0 && (
                  <div className="overflow-auto">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 mt-2 mb-1">Node OpenAI IDs</p>
                    <table className="w-full text-[11px] min-w-[760px]">
                      <thead className="text-gray-500">
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-1 pr-3">Time</th>
                          <th className="text-left py-1 pr-3">Node</th>
                          <th className="text-left py-1 pr-3">Assistant ID</th>
                          <th className="text-left py-1 pr-3">Thread ID</th>
                          <th className="text-left py-1 pr-3">Run ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodeOpenAIIds.map((row) => (
                          <tr key={row.nodeStateId} className="border-b border-gray-100 align-top">
                            <td className="py-1 pr-3 text-gray-600 whitespace-nowrap">
                              {row.startedAt ? new Date(row.startedAt).toLocaleString() : '-'}
                            </td>
                            <td className="py-1 pr-3 text-gray-700">{row.nodeName}</td>
                            <td className="py-1 pr-3 font-mono text-gray-700">{row.assistantId ?? '-'}</td>
                            <td className="py-1 pr-3 font-mono text-gray-700">{row.threadId ?? '-'}</td>
                            <td className="py-1 pr-3 font-mono text-gray-700">{row.runId ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="overflow-auto">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 mt-2 mb-1">OpenAI Call Logs</p>
                  <table className="w-full text-[11px] min-w-[1040px]">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-1 pr-3">Time</th>
                        <th className="text-left py-1 pr-3">Status</th>
                        <th className="text-left py-1 pr-3">Agent</th>
                        <th className="text-left py-1 pr-3">Workflow ID</th>
                        <th className="text-left py-1 pr-3">Run ID</th>
                        <th className="text-left py-1 pr-3">Node ID</th>
                        <th className="text-left py-1 pr-3">Assistant</th>
                        <th className="text-left py-1 pr-3">Thread</th>
                        <th className="text-left py-1 pr-3">OpenAI Run</th>
                        <th className="text-left py-1 pr-3">Prompt Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openaiLogs.map((row) => (
                        <tr key={row.id} className="border-b border-gray-100 align-top">
                          <td className="py-1 pr-3 text-gray-600 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                          <td className="py-1 pr-3">
                            <span className={`inline-flex px-1.5 py-0.5 rounded-full border ${
                              row.status.includes('failed') || row.status.includes('timeout')
                                ? 'border-red-200 text-red-700 bg-red-50'
                                : row.status.includes('started')
                                  ? 'border-amber-200 text-amber-700 bg-amber-50'
                                  : 'border-green-200 text-green-700 bg-green-50'
                            }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-1 pr-3 text-gray-700">{row.agent_ref ?? '-'}</td>
                          <td className="py-1 pr-3 font-mono text-gray-700">{row.workflow_id ?? '-'}</td>
                          <td className="py-1 pr-3 font-mono text-gray-700">{row.run_id}</td>
                          <td className="py-1 pr-3 font-mono text-gray-700">{row.node_id}</td>
                          <td className="py-1 pr-3 font-mono text-gray-700">{row.openai_assistant_id ?? '-'}</td>
                          <td className="py-1 pr-3 font-mono text-gray-700">{row.openai_thread_id ?? '-'}</td>
                          <td className="py-1 pr-3 font-mono text-gray-700">{row.openai_run_id ?? '-'}</td>
                          <td className="py-1 pr-3">
                            <details>
                              <summary className="cursor-pointer text-brand-600 hover:underline">View prompts</summary>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">System Prompt</p>
                                  <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-64 whitespace-pre-wrap">{String((row.request_payload?.system_prompt as string) ?? '') || '(empty)'}</pre>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">User Prompt</p>
                                  <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-64 whitespace-pre-wrap">{String((row.request_payload?.user_prompt as string) ?? '') || '(empty)'}</pre>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Tools</p>
                                  <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-40">{formatJson(row.request_payload?.tools)}</pre>
                                </div>
                              </div>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2">
                  {openaiLogs.map((row) => (
                    <details key={`payload-${row.id}`} className="rounded-lg border border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-gray-700 flex items-center justify-between">
                        <span className="font-mono">{row.openai_run_id ?? row.id} - {row.status}</span>
                        <span className="text-gray-400">Request/Response JSON</span>
                      </summary>
                      <div className="px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-2 border-t border-gray-200">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-500 mt-2 mb-1">Request</p>
                          <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-52">{formatJson(row.request_payload)}</pre>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-500 mt-2 mb-1">Response</p>
                          <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-52">{formatJson(row.response_payload)}</pre>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </details>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
            {chatItems.map((item) => (
              <MessageBubble
                key={item.id}
                item={item}
                highlighted={!!selectedNodeId && item.nodeId === selectedNodeId}
                dimmed={!!selectedNodeId && !!item.nodeId && item.nodeId !== selectedNodeId}
                onClick={item.nodeId ? () => setSelectedNodeId(item.nodeId!) : undefined}
              />
            ))}
          </div>

          {openEscalation && run.status === 'paused' && (
            <div className="border-t border-gray-200 bg-white p-4 space-y-3">
              <p className="text-xs text-gray-500">
                {isReplyLocked
                  ? 'Response sent. Agent is working on it. You can reply again after the next agent question.'
                  : 'Agent is waiting for your answer. Reply to continue this step.'}
              </p>

              {quickOptions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {quickOptions.map((opt, idx) => (
                    <button
                      key={`${opt}-${idx}`}
                      onClick={() => sendGuidance(opt)}
                      disabled={resolveEscalation.isPending || isReplyLocked}
                      className="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-700 hover:border-brand-400 hover:text-brand-700"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && guidance.trim()) {
                      e.preventDefault()
                      void sendGuidance(guidance)
                    }
                  }}
                  placeholder="Type guidance to the agent…"
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  onClick={() => sendGuidance(guidance)}
                  disabled={!guidance.trim() || resolveEscalation.isPending || isReplyLocked}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm disabled:opacity-40"
                >
                  <Send size={14} />
                  Send
                </button>
              </div>

              <div className="space-y-2">
                <textarea
                  value={overrideOutput}
                  onChange={(e) => setOverrideOutput(e.target.value)}
                  rows={3}
                  placeholder="Override with human output..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  onClick={() => resolveEscalation.mutate(
                    {
                      escalationId: openEscalation.id,
                      data: {
                        resolution: 'override_output',
                        override_output: { text: overrideOutput.trim() },
                      },
                    },
                    {
                      onSuccess: () => {
                        setOverrideOutput('')
                        setAwaitingAgentAfterReply(true)
                        setLockedEscalationId(openEscalation.id)
                        refetchEscalations()
                        refetchRun()
                        refetchNodes()
                      },
                    },
                  )}
                  disabled={!overrideOutput.trim() || resolveEscalation.isPending || isReplyLocked}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-300 text-blue-700 text-xs hover:bg-blue-50 disabled:opacity-50"
                >
                  Override with human output
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => resolveEscalation.mutate(
                    { escalationId: openEscalation.id, data: { resolution: 'accept_output' } },
                    { onSuccess: () => {
                      setAwaitingAgentAfterReply(true)
                      setLockedEscalationId(openEscalation.id)
                      refetchEscalations()
                      refetchRun()
                      refetchNodes()
                    } },
                  )}
                  disabled={resolveEscalation.isPending || isReplyLocked}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-green-300 text-green-700 text-xs hover:bg-green-50"
                >
                  <CheckCircle2 size={13} />
                  Accept output
                </button>
                <button
                  onClick={() => resolveEscalation.mutate(
                    { escalationId: openEscalation.id, data: { resolution: 'abort_run' } },
                    { onSuccess: () => {
                      setAwaitingAgentAfterReply(false)
                      setLockedEscalationId(null)
                      refetchEscalations()
                      refetchRun()
                      refetchNodes()
                    } },
                  )}
                  disabled={resolveEscalation.isPending || isReplyLocked}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 text-red-700 text-xs hover:bg-red-50"
                >
                  <XCircle size={13} />
                  Abort run
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="hidden xl:block min-h-0 p-4 bg-white">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Workflow map</p>
          <div className="h-[calc(100%-1.75rem)] min-h-[360px] border border-gray-200 rounded-xl overflow-hidden">
            <GraphCanvas
              definition={definition}
              nodeStatuses={nodeStatuses}
              selectedNodeId={selectedNodeId}
              onSelectNode={(nid) => setSelectedNodeId(nid)}
            />
          </div>
        </div>
      </div>

      {showMobileMap && (
        <div className="xl:hidden fixed inset-0 z-40 bg-black/40">
          <div className="absolute inset-x-3 top-16 bottom-3 bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Workflow map</p>
              <button onClick={() => setShowMobileMap(false)} className="text-gray-400 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 p-3">
              <GraphCanvas
                definition={definition}
                nodeStatuses={nodeStatuses}
                selectedNodeId={selectedNodeId}
                onSelectNode={(nid) => setSelectedNodeId(nid)}
              />
            </div>
          </div>
        </div>
      )}

      {showInputPanel && (
        <RunInputPanel
          runId={runId!}
          workspaceId={workspaceId}
          runStatus={run.status}
          input={run.input}
          definition={definition}
          onClose={() => setShowInputPanel(false)}
          onInputSaved={refetchRun}
        />
      )}
    </div>
  )
}
