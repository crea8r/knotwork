import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import {
  Play, Trash2, Pencil, Check, Send, CheckCircle2, Map as MapIcon, X, Bug,
} from 'lucide-react'
import { useRun, useRunNodes, useDeleteRun, useExecuteRunInline, useRenameRun, useRunChatMessages } from '@/api/runs'
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
const DELETABLE = new Set(['completed', 'failed', 'stopped', 'draft', 'queued', 'paused', 'running'])

type ChatRole = 'assistant' | 'user' | 'system'
type ChatItem = {
  id: string
  role: ChatRole
  kind?: 'message' | 'decision_confident' | 'decision_escalate' | 'loading'
  speaker: string
  speakerAgentId?: string
  nodeId?: string
  nodeName?: string
  text: string
  markdown?: boolean
  raw: unknown
  ts?: string | null
  escalation?: Escalation
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?(#.*)?$/i
type ExtractedImage = { src: string; inlineSvg: boolean }

function normalizeCandidateUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?]+$/, '')
}

function isImageSource(url: string): boolean {
  if (!url) return false
  if (/^data:image\//i.test(url)) return true
  return IMAGE_EXT_RE.test(url)
}

function extractImageSources(text: string): ExtractedImage[] {
  const found = new Map<string, ExtractedImage>()

  const mdImageRe = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of text.matchAll(mdImageRe)) {
    const url = normalizeCandidateUrl(match[1] ?? '')
    if (isImageSource(url)) found.set(url, { src: url, inlineSvg: false })
  }

  const mdLinkRe = /\[[^\]]+]\((https?:\/\/[^)\s]+)\)/g
  for (const match of text.matchAll(mdLinkRe)) {
    const url = normalizeCandidateUrl(match[1] ?? '')
    if (isImageSource(url)) found.set(url, { src: url, inlineSvg: false })
  }

  const plainUrlRe = /(https?:\/\/[^\s<>"')\]]+)/g
  for (const match of text.matchAll(plainUrlRe)) {
    const url = normalizeCandidateUrl(match[1] ?? '')
    if (isImageSource(url)) found.set(url, { src: url, inlineSvg: false })
  }

  const svgBlocks = text.match(/<svg[\s\S]*?<\/svg>/gi) ?? []
  for (const svg of svgBlocks) {
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
    found.set(src, { src, inlineSvg: true })
  }

  return Array.from(found.values()).slice(0, 6)
}

function stripInlineSvg(text: string): string {
  return text.replace(/<svg[\s\S]*?<\/svg>/gi, '').trim()
}

function hashString(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) - h + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

function friendlyProgressText(messageId: string, progress: string, phrases: string[]): string {
  const phrase = phrases[hashString(messageId) % phrases.length] ?? 'Agent is working…'
  const clean = progress.trim()
  if (!clean) return phrase
  return `${phrase} • ${clean}`
}

const THINKING_PREFIXES = [
  'Checking context',
  'Reviewing prior steps',
  'Mapping the workflow path',
  'Validating assumptions',
  'Comparing alternatives',
  'Synthesizing evidence',
  'Refining the response',
  'Verifying constraints',
  'Cross-checking details',
  'Preparing the final output',
]

const THINKING_ACTIONS = [
  'to avoid missing edge cases',
  'to keep the result consistent',
  'to improve answer quality',
  'to keep the run aligned',
  'to reduce rework later',
  'to catch conflicts early',
  'to make the next step clear',
  'to keep decisions traceable',
  'to ensure clean handoff',
  'to maintain reliable output',
]

function buildThinkingPhrases(): string[] {
  const phrases: string[] = []
  for (const prefix of THINKING_PREFIXES) {
    for (const action of THINKING_ACTIONS) {
      phrases.push(`${prefix} ${action}…`)
    }
  }
  return phrases
}

function pickRandomPhrase(phrases: string[], previous?: string): string {
  if (phrases.length === 0) return 'Agent is working…'
  if (phrases.length === 1) return phrases[0]
  let next = phrases[Math.floor(Math.random() * phrases.length)]
  while (next === previous) next = phrases[Math.floor(Math.random() * phrases.length)]
  return next
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
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const images = useMemo(() => extractImageSources(item.text), [item.text])
  const renderText = useMemo(() => {
    if (images.some((img) => img.inlineSvg)) return stripInlineSvg(item.text)
    return item.text
  }, [item.text, images])

  return (
    <div
      className={`max-w-[90%] ${item.role === 'user' ? 'ml-auto' : 'mr-auto'}`}
      style={{
        opacity: dimmed ? 0.58 : 1,
        transition: 'opacity 160ms ease',
      }}
    >
      <div className="flex items-center gap-2 mb-0.5">
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
        className={`w-full text-left rounded-2xl px-3 py-2 text-sm leading-relaxed border transition-colors ${
          item.role === 'assistant'
            ? 'bg-white text-gray-800 border-gray-200 shadow-sm'
            : item.role === 'user'
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-gray-100 text-gray-600 border-gray-200'
        } ${highlighted ? 'ring-4 ring-blue-600 shadow-[0_8px_18px_rgba(37,99,235,0.28)] scale-[1.04]' : ''} select-text`}
        style={highlighted ? { boxShadow: '0 0 0 10px rgba(37,99,235,0.32), 0 8px 18px rgba(37,99,235,0.28)' } : undefined}
      >
        {images.length > 0 && (
          <div className="mb-2 space-y-2">
            {images.map((img, idx) => (
              <button
                key={`${img.src}-${idx}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setPreviewImage(img.src)
                }}
                className="block"
              >
                <img
                  src={img.src}
                  alt={`response-image-${idx + 1}`}
                  loading="lazy"
                  className="max-h-80 w-auto max-w-full rounded-lg border border-gray-200 bg-white object-contain"
                />
              </button>
            ))}
          </div>
        )}
        {item.markdown ? <MarkdownViewer content={renderText} compact /> : <span className="whitespace-pre-wrap">{renderText}</span>}
      </div>
      {previewImage && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 p-4 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="Full size"
            className="max-h-[95vh] max-w-[95vw] rounded-lg bg-white object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showRaw && (
        <pre className="mt-1.5 bg-black text-green-200 rounded-lg p-2.5 text-[11px] overflow-auto max-h-56">
          {formatJson(item.raw)}
        </pre>
      )}
      {item.ts && (
        <p className="text-[10px] text-gray-400 mt-0.5">
          {new Date(item.ts).toLocaleString()}
        </p>
      )}
    </div>
  )
}

function DecisionCard({
  item,
  resolveEscalation,
  disabled,
  onAfterResolve,
}: {
  item: ChatItem
  resolveEscalation: ReturnType<typeof useResolveEscalationAny>
  disabled: boolean
  onAfterResolve: () => void
}) {
  const esc = item.escalation
  const [guidance, setGuidance] = useState('')
  const [overrideOutput, setOverrideOutput] = useState('')
  const isOpen = esc?.status === 'open'

  if (item.kind === 'decision_confident') {
    return (
      <div className="max-w-[92%] mr-auto rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-emerald-700">Decision</p>
        <p className="text-sm text-emerald-900">{item.text}</p>
      </div>
    )
  }

  if (!esc) return null
  const ctx = esc.context as Record<string, unknown>
  const question = typeof ctx.question === 'string' ? ctx.question : 'Needs human input'
  const options = Array.isArray(ctx.options) ? ctx.options.map(String) : []

  return (
    <div className="max-w-[92%] mr-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-amber-700">Decision: Escalate</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${isOpen ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {esc.status}
        </span>
      </div>
      <p className="text-sm text-amber-900">{question}</p>
      {options.length > 0 && (
        <ul className="text-xs text-amber-800 list-disc pl-4">
          {options.map((opt, i) => <li key={`${opt}-${i}`}>{opt}</li>)}
        </ul>
      )}

      {isOpen && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => resolveEscalation.mutate(
                { escalationId: esc.id, data: { resolution: 'accept_output' } },
                { onSuccess: onAfterResolve },
              )}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-300 text-green-700 text-xs hover:bg-green-50 disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              Approve current output
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="Request revision comments…"
              className="flex-1 border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={() => {
                const trimmed = guidance.trim()
                if (!trimmed) return
                resolveEscalation.mutate(
                  { escalationId: esc.id, data: { resolution: 'request_revision', guidance: trimmed } },
                  { onSuccess: () => { setGuidance(''); onAfterResolve() } },
                )
              }}
              disabled={disabled || !guidance.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm disabled:opacity-40"
            >
              <Send size={14} />
              Request revision
            </button>
          </div>
          <div className="space-y-2">
            <textarea
              value={overrideOutput}
              onChange={(e) => setOverrideOutput(e.target.value)}
              rows={3}
              placeholder="Edit answer and use this for next step…"
              className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={() => {
                const trimmed = overrideOutput.trim()
                if (!trimmed) return
                resolveEscalation.mutate(
                  { escalationId: esc.id, data: { resolution: 'override_output', override_output: { text: trimmed } } },
                  { onSuccess: () => { setOverrideOutput(''); onAfterResolve() } },
                )
              }}
              disabled={disabled || !overrideOutput.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-300 text-blue-700 text-xs hover:bg-blue-50 disabled:opacity-50"
            >
              Use edited answer
            </button>
          </div>
        </>
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
  const { data: runMessages = [], refetch: refetchRunMessages } = useRunChatMessages(workspaceId, runId!, {
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [awaitingAgentAfterReply, setAwaitingAgentAfterReply] = useState(false)
  const [lockedEscalationId, setLockedEscalationId] = useState<string | null>(null)
  const thinkingPhrases = useMemo(() => buildThinkingPhrases(), [])
  const [thinkingText, setThinkingText] = useState(() => pickRandomPhrase(thinkingPhrases))

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
        if (event.type === 'node_completed' || event.type === 'run_status_changed' || event.type === 'escalation_created' || event.type === 'escalation_resolved') {
          refetchRunMessages()
        }
      } catch {
        // Ignore malformed events
      }
    }
    return () => { ws.close(); wsRef.current = null }
  }, [runId, run?.status, refetchRun, refetchNodes, refetchEscalations, refetchRunMessages])

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

  useEffect(() => {
    const activeThinking = !!run && (run.status === 'running' || (awaitingAgentAfterReply && run.status === 'paused' && !openEscalation))
    if (!activeThinking) return
    setThinkingText((prev) => pickRandomPhrase(thinkingPhrases, prev))
    const timer = window.setInterval(() => {
      setThinkingText((prev) => pickRandomPhrase(thinkingPhrases, prev))
    }, 4500)
    return () => window.clearInterval(timer)
  }, [run, awaitingAgentAfterReply, openEscalation, thinkingPhrases])

  const chatItems: ChatItem[] = useMemo(() => {
    const items: ChatItem[] = []
    if (!run) return items
    const escalationsByNodeState = new Map<string, Escalation[]>()
    for (const esc of runEscalations) {
      const key = esc.run_node_state_id
      const arr = escalationsByNodeState.get(key) ?? []
      arr.push(esc)
      escalationsByNodeState.set(key, arr)
    }

    for (const m of runMessages) {
      const role: ChatRole =
        m.role === 'assistant' || m.role === 'user'
          ? m.role
          : 'system'
      const meta = m.metadata_ as Record<string, unknown>
      const kind = typeof meta.kind === 'string' ? meta.kind : ''
      const text = kind === 'agent_progress'
        ? friendlyProgressText(m.id, m.content, thinkingPhrases)
        : m.content
      items.push({
        id: m.id,
        role,
        kind: kind === 'agent_progress' ? 'loading' : 'message',
        speaker: m.author_name || (m.author_type === 'human' ? 'You' : m.author_type === 'agent' ? 'Agent' : 'Knotwork'),
        nodeId: m.node_id ?? undefined,
        nodeName: m.node_id ? (nodeNameMap[m.node_id] ?? m.node_id) : undefined,
        text,
        markdown: role === 'assistant' && kind !== 'agent_progress',
        raw: m.metadata_ ?? {},
        ts: m.created_at,
      })
    }

    for (const ns of nodeStates) {
      if (ns.status !== 'completed') continue
      const relatedEsc = escalationsByNodeState.get(ns.id) ?? []
      if (relatedEsc.length > 0) continue
      const speaker = nodeSpeakerMap.nameMap.get(ns.node_id) ?? (ns.agent_ref || 'Agent')
      const nodeName = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
      items.push({
        id: `decision-confident-${ns.id}`,
        role: 'system',
        kind: 'decision_confident',
        speaker: 'Knotwork',
        nodeId: ns.node_id,
        nodeName,
        text: `${speaker} is confident with the answer and will move on to the next step.`,
        raw: { node_state_id: ns.id, decision: 'confident' },
        ts: ns.completed_at,
      })
    }

    for (const esc of runEscalations) {
      const nodeName = nodeNameMap[esc.node_id] ?? esc.node_id
      items.push({
        id: `decision-escalate-${esc.id}`,
        role: 'system',
        kind: 'decision_escalate',
        speaker: 'Knotwork',
        nodeId: esc.node_id,
        nodeName,
        text: 'Escalation requires human decision.',
        raw: esc.context,
        escalation: esc,
        ts: esc.created_at,
      })
    }

    if (runMessages.length > 0) {
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
          kind: 'loading',
          speaker: 'Knotwork',
          text: thinkingText,
          raw: { status: run.status },
          ts: null,
        })
      }
      return items
    }

    items.push({
      id: `run-input-${run.id}`,
      role: 'user',
      speaker: 'You',
      text: `Started run with:\n${humanizeInput(run.input)}`,
      raw: run.input,
      ts: run.created_at,
    })

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

      // Only surface output in the chat view for completed nodes.
      // Paused/escalated node output (the agent's full research body) belongs in
      // the debug panel — showing it in the conversation would be overwhelming
      // and the ordering relative to the escalation question is unreliable.
      const out = ns.output as Record<string, unknown> | null
      if (ns.status !== 'paused' && out && typeof out.text === 'string' && out.text.trim()) {
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
        text: thinkingText,
        raw: { status: run.status },
        ts: null,
      })
    }
    if (awaitingAgentAfterReply && run.status === 'paused' && !openEscalation) {
      items.push({
        id: `run-resume-wait-${run.id}`,
        role: 'system',
        speaker: 'Knotwork',
        text: `Your response was sent. ${thinkingText}`,
        raw: { status: run.status, waiting: true },
        ts: null,
      })
    }

    return items
  }, [run, runMessages, nodeStates, nodeNameMap, nodeSpeakerMap, runEscalations, awaitingAgentAfterReply, openEscalation, thinkingText, thinkingPhrases])

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

  if (!run) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  const isDeletable = DELETABLE.has(run.status)

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

      {run.status === 'running' && (
        <div className="px-4 md:px-6 py-1.5 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400 select-none">
          <span title="Execution policy" className="font-medium text-gray-500">ℹ Policy:</span>
          <span>auto-fail if silent &gt; 15 min</span>
          <span className="text-gray-300">·</span>
          <span>24 h hard limit</span>
          <span className="text-gray-300">·</span>
          <span>keep each node task under ~1 h</span>
          <span className="text-gray-300">·</span>
          <span>stop run to cancel</span>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col min-h-0 border-r border-gray-200 bg-[#f7f8fb]">
          <div className="px-4 md:px-5 pt-3">
            <details className="rounded-xl border border-gray-200 bg-white">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs text-gray-700 font-medium flex items-center justify-between">
                <span>OpenClaw Debug ({promptAttempts.length} messages)</span>
                <span className="text-[11px] text-gray-400">Expand</span>
              </summary>
              <div className="px-3 pb-3 space-y-4 border-t border-gray-100">

                {/* Per-node IN → OUT */}
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 mt-2 mb-1">Messages In / Out</p>
                  <div className="space-y-2">
                    {nodeStates
                      .filter((ns) => ns.input || ns.output)
                      .slice()
                      .sort((a, b) => new Date(a.started_at ?? 0).getTime() - new Date(b.started_at ?? 0).getTime())
                      .map((ns) => {
                        const inp = (ns.input ?? {}) as Record<string, unknown>
                        const out = (ns.output ?? {}) as Record<string, unknown>
                        const logs = Array.isArray(ns.agent_logs) ? ns.agent_logs : []
                        const name = nodeNameMap[ns.node_id] ?? ns.node_name ?? ns.node_id
                        const agentRef = ns.agent_ref ?? (typeof inp.agent_ref === 'string' ? inp.agent_ref : null)
                        const systemPrompt = typeof inp.system_prompt === 'string' ? inp.system_prompt : ''
                        const userPrompt = typeof inp.user_prompt === 'string' ? inp.user_prompt : ''
                        const humanGuidance = typeof inp.human_guidance === 'string' ? inp.human_guidance : ''
                        const outputText = typeof out.text === 'string' ? out.text : null
                        return (
                          <details key={ns.id} className="rounded-lg border border-gray-200 bg-gray-50">
                            <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-gray-700 flex items-center justify-between gap-2">
                              <span className="font-mono truncate">
                                {ns.started_at ? new Date(ns.started_at).toLocaleTimeString() : '-'} · {name}
                              </span>
                              <span className="shrink-0 flex items-center gap-2 text-gray-400">
                                {agentRef && <span className="font-mono text-brand-600">{agentRef}</span>}
                                <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${
                                  ns.status === 'completed' ? 'border-green-200 text-green-700 bg-green-50'
                                  : ns.status === 'failed' ? 'border-red-200 text-red-700 bg-red-50'
                                  : ns.status === 'running' ? 'border-blue-200 text-blue-700 bg-blue-50'
                                  : 'border-gray-200 text-gray-500 bg-white'
                                }`}>{ns.status}</span>
                              </span>
                            </summary>
                            <div className="px-3 pb-3 border-t border-gray-200 space-y-3">
                              {/* IN */}
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-green-600 mt-2 mb-1 flex items-center gap-1">
                                  <span>▶ IN</span>
                                  <span className="text-gray-400 normal-case tracking-normal">→ OpenClaw agent</span>
                                </p>
                                {systemPrompt && (
                                  <div className="mb-1.5">
                                    <p className="text-[10px] text-gray-400 mb-0.5">Extra system prompt</p>
                                    <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-48 whitespace-pre-wrap">{systemPrompt}</pre>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[10px] text-gray-400 mb-0.5">Message</p>
                                  <pre className="bg-black text-green-200 rounded-lg p-3 text-[10px] overflow-auto max-h-72 whitespace-pre-wrap">{userPrompt || '(empty)'}</pre>
                                </div>
                                {humanGuidance && (
                                  <div className="mt-1.5">
                                    <p className="text-[10px] text-amber-600 mb-0.5">Human guidance</p>
                                    <pre className="bg-black text-amber-200 rounded-lg p-3 text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">{humanGuidance}</pre>
                                  </div>
                                )}
                              </div>
                              {/* OUT */}
                              {(outputText || ns.status === 'failed') && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-blue-600 mb-1 flex items-center gap-1">
                                    <span>◀ OUT</span>
                                    <span className="text-gray-400 normal-case tracking-normal">← OpenClaw response</span>
                                    {ns.status === 'paused' && (
                                      <span className="text-amber-500 normal-case tracking-normal">(paused — awaiting human)</span>
                                    )}
                                  </p>
                                  {outputText ? (
                                    <pre className="bg-black text-blue-200 rounded-lg p-3 text-[10px] overflow-auto max-h-72 whitespace-pre-wrap">{outputText}</pre>
                                  ) : (
                                    <pre className="bg-black text-red-300 rounded-lg p-3 text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">{ns.error ?? '(failed — no output)'}</pre>
                                  )}
                                </div>
                              )}
                              {/* Agent logs */}
                              {logs.length > 0 && (
                                <details>
                                  <summary className="cursor-pointer text-[10px] text-gray-500 hover:text-gray-700">
                                    Agent logs ({logs.length} entries)
                                  </summary>
                                  <pre className="mt-1 bg-black text-yellow-200 rounded-lg p-3 text-[10px] overflow-auto max-h-52 whitespace-pre-wrap">
                                    {JSON.stringify(logs, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </details>
                        )
                      })}
                    {nodeStates.filter((ns) => ns.input || ns.output).length === 0 && (
                      <p className="text-[11px] text-gray-400 italic">No node messages yet.</p>
                    )}
                  </div>
                </div>

              </div>
            </details>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2.5">
            {chatItems.map((item) => (
              item.kind === 'decision_confident' || item.kind === 'decision_escalate' ? (
                <DecisionCard
                  key={item.id}
                  item={item}
                  resolveEscalation={resolveEscalation}
                  disabled={resolveEscalation.isPending || (!!openEscalation && lockedEscalationId === openEscalation.id)}
                  onAfterResolve={() => {
                    setAwaitingAgentAfterReply(true)
                    if (item.escalation?.id) setLockedEscalationId(item.escalation.id)
                    refetchEscalations()
                    refetchRun()
                    refetchNodes()
                    refetchRunMessages()
                  }}
                />
              ) : (
                <MessageBubble
                  key={item.id}
                  item={item}
                  highlighted={!!selectedNodeId && item.nodeId === selectedNodeId}
                  dimmed={!!selectedNodeId && !!item.nodeId && item.nodeId !== selectedNodeId}
                  onClick={item.nodeId ? () => setSelectedNodeId(item.nodeId!) : undefined}
                />
              )
            ))}
          </div>
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
