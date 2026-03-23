import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { X } from 'lucide-react'
import {
  useRun, useRunNodes, useRunWorklog, useDeleteRun, useCloneRun,
  useExecuteRunInline, useRunChatMessages, useAbortRun,
} from '@/api/runs'
import { useGraphVersion } from '@/api/graphs'
import { useEscalations, useResolveEscalationAny } from '@/api/escalations'
import { useRegisteredAgents } from '@/api/agents'
import GraphCanvas from '@/components/canvas/GraphCanvas'
import Spinner from '@/components/shared/Spinner'
import RunInputPanel from '@/components/operator/RunInputPanel'
import MessageBubble from '@/components/operator/MessageBubble'
import DecisionCard from '@/components/operator/DecisionCard'
import DebugTimelinePanel from '@/components/operator/DebugTimelinePanel'
import RunDetailHeader from '@/components/operator/RunDetailHeader'
import { useAuthStore } from '@/store/auth'
import { useRunNodeStatuses } from '@/hooks/useRunNodeStatuses'
import { useRunChatItems } from '@/hooks/useRunChatItems'
import { useRunDebugTimeline } from '@/hooks/useRunDebugTimeline'
import { useRunWebSocket } from '@/hooks/useRunWebSocket'
import { buildThinkingPhrases, pickRandomPhrase } from '@/pages/runDetail/runDetailTypes'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'
const ACTIVE = new Set(['queued', 'running'])

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE

  const isActivePoll = (run?: { status?: string }) => run && (ACTIVE.has(run.status!) || run.status === 'paused') ? 3000 : false

  const { data: run, refetch: refetchRun } = useRun(workspaceId, runId!, {
    refetchInterval: (q) => { const s = (q.state.data as { status?: string } | undefined)?.status; return !s || ACTIVE.has(s) ? 2000 : false },
  })
  const { data: nodeStates = [], refetch: refetchNodes } = useRunNodes(workspaceId, runId!, { refetchInterval: isActivePoll(run) })
  const { data: graphVersion } = useGraphVersion(workspaceId, run?.graph_version_id ?? '')
  const { data: runMessages = [], refetch: refetchRunMessages } = useRunChatMessages(workspaceId, runId!, {
    refetchInterval: run && (ACTIVE.has(run.status) || run.status === 'paused') ? 2000 : false,
  })
  const { data: worklog = [] } = useRunWorklog(workspaceId, runId!, { refetchInterval: isActivePoll(run) })
  const { data: escalations = [], refetch: refetchEscalations } = useEscalations(workspaceId)
  const { data: agents = [] } = useRegisteredAgents()
  const deleteRun = useDeleteRun(workspaceId)
  const cloneRun = useCloneRun(workspaceId)
  const executeInline = useExecuteRunInline(workspaceId)
  const abortRun = useAbortRun(workspaceId)
  const resolveEscalation = useResolveEscalationAny(workspaceId)

  const definition = graphVersion?.definition ?? { nodes: [], edges: [] }
  const nodeStatuses = useRunNodeStatuses(nodeStates, definition, run?.status ?? '')
  const nodeNameMap = useMemo(() => Object.fromEntries((definition.nodes ?? []).map(n => [n.id, n.name])), [definition.nodes])
  const nodeSpeakerMap = useMemo(() => {
    const byId = new Map(agents.map(a => [a.id, a.display_name]))
    const map = new Map<string, string>()
    const mapAgentId = new Map<string, string>()
    for (const n of definition.nodes ?? []) {
      if (n.type !== 'agent') continue
      if (n.agent_ref === 'human') { map.set(n.id, 'Human'); continue }
      const rid = typeof n.registered_agent_id === 'string' ? n.registered_agent_id : ''
      if (rid && byId.has(rid)) { map.set(n.id, byId.get(rid)!); mapAgentId.set(n.id, rid) }
      else { map.set(n.id, n.agent_ref ?? 'Agent') }
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
  const chatScrollRef = useRef<HTMLDivElement | null>(null)

  const wsConnected = useRunWebSocket({ runId: runId!, runStatus: run?.status, refetchRun, refetchNodes, refetchEscalations, refetchRunMessages })

  const latestProgress = useMemo(() => {
    const msgs = runMessages.filter((m) => (m.metadata_ as Record<string, unknown>).kind === 'agent_progress')
    if (!msgs.length) return null
    const l = msgs[msgs.length - 1]; return { id: l.id, text: l.content }
  }, [runMessages])
  const runEscalations = useMemo(() => escalations.filter((e) => e.run_id === runId).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [escalations, runId])
  const openEscalation = [...runEscalations].reverse().find((e) => e.status === 'open') ?? null

  const chatItems = useRunChatItems({ run, runMessages, nodeStates, nodeNameMap, nodeSpeakerMap, runEscalations, awaitingAgentAfterReply, lockedEscalationId, openEscalation, thinkingText, thinkingPhrases, latestProgress })
  const debugTimeline = useRunDebugTimeline(nodeStates, nodeNameMap, worklog)

  useEffect(() => { if (run?.status === 'running' || openEscalation) setAwaitingAgentAfterReply(false) }, [run?.status, openEscalation])
  useEffect(() => {
    if (!lockedEscalationId) return
    if (openEscalation && openEscalation.id !== lockedEscalationId) { setLockedEscalationId(null); setAwaitingAgentAfterReply(false); return }
    if (!openEscalation && run && run.status !== 'paused') { setLockedEscalationId(null); setAwaitingAgentAfterReply(false) }
  }, [lockedEscalationId, openEscalation, run])
  useEffect(() => {
    const active = !!run && (run.status === 'running' || (run.status === 'paused' && !openEscalation))
    if (!active) return
    setThinkingText((prev) => pickRandomPhrase(thinkingPhrases, prev))
    const t = window.setInterval(() => setThinkingText((prev) => pickRandomPhrase(thinkingPhrases, prev)), 4500)
    return () => window.clearInterval(t)
  }, [run, openEscalation, thinkingPhrases])
  useEffect(() => { const el = chatScrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [chatItems.length, run?.status])

  async function handleDelete() {
    if (!confirm('Delete this run? This cannot be undone.')) return
    try { await deleteRun.mutateAsync(runId!); navigate('/runs') }
    catch (err) { alert(`Delete failed: ${axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)}`) }
  }
  async function handleAbort() {
    if (!confirm('Abort this run?\n\nUse this only when the agent appears stuck with no response.')) return
    try { await abortRun.mutateAsync(runId!); refetchRun(); refetchNodes(); refetchRunMessages(); refetchEscalations() }
    catch (err) { alert(`Abort failed: ${axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)}`) }
  }
  async function handleCloneAndRun() {
    try { const d = await cloneRun.mutateAsync(runId!); await executeInline.mutateAsync(d.id); navigate(`/runs/${d.id}`) }
    catch (err) { alert(`Clone failed: ${axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)}`) }
  }

  if (!run) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>

  const canvasProps = { definition, nodeStatuses, selectedNodeId, onSelectNode: (nid: string | null) => setSelectedNodeId(nid) }

  return (
    <div className="h-full flex flex-col pt-11 md:pt-0">
      <RunDetailHeader
        run={run} runId={runId!} workspaceId={workspaceId} wsConnected={wsConnected}
        showInputPanel={showInputPanel} executeInline={executeInline} abortRun={abortRun}
        cloneRun={cloneRun} deleteRun={deleteRun} refetchRun={refetchRun} refetchNodes={refetchNodes}
        onShowInputPanel={setShowInputPanel} onShowMobileMap={() => setShowMobileMap(true)}
        onAbort={handleAbort} onCloneAndRun={handleCloneAndRun} onDelete={handleDelete}
      />
      {run.status === 'running' && (
        <div className="px-4 md:px-6 py-1.5 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400 select-none">
          <span className="font-medium text-gray-500">ℹ Policy:</span>
          <span>auto-fail if silent &gt; 15 min</span><span className="text-gray-300">·</span>
          <span>24 h hard limit</span><span className="text-gray-300">·</span>
          <span>keep each node task under ~1 h</span><span className="text-gray-300">·</span>
          <span>stop run to cancel</span>
        </div>
      )}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col min-h-0 border-r border-gray-200 bg-[#f7f8fb]">
          <DebugTimelinePanel debugTimeline={debugTimeline} />
          {run.status === 'failed' && run.error && (
            <div className="mx-3 md:mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-red-500">✕</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-red-700 mb-0.5">Run failed</p>
                <pre className="text-xs text-red-800 whitespace-pre-wrap break-words font-mono leading-relaxed">{run.error}</pre>
              </div>
            </div>
          )}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2.5">
            {chatItems.map((item) => (
              item.kind === 'decision_confident' || item.kind === 'decision_escalate' ? (
                <DecisionCard key={item.id} item={item} resolveEscalation={resolveEscalation}
                  disabled={resolveEscalation.isPending || (!!openEscalation && lockedEscalationId === openEscalation.id)}
                  onAfterResolve={() => { setAwaitingAgentAfterReply(true); if (item.escalation?.id) setLockedEscalationId(item.escalation.id); refetchEscalations(); refetchRun(); refetchNodes(); refetchRunMessages() }}
                />
              ) : (
                <MessageBubble key={item.id} item={item}
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
            <GraphCanvas {...canvasProps} />
          </div>
        </div>
      </div>
      {showMobileMap && (
        <div className="xl:hidden fixed inset-0 z-40 bg-black/40">
          <div className="absolute inset-x-3 top-16 bottom-3 bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Workflow map</p>
              <button onClick={() => setShowMobileMap(false)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
            <div className="flex-1 p-3"><GraphCanvas {...canvasProps} /></div>
          </div>
        </div>
      )}
      {showInputPanel && (
        <RunInputPanel runId={runId!} workspaceId={workspaceId} runStatus={run.status} input={run.input} definition={definition} onClose={() => setShowInputPanel(false)} onInputSaved={refetchRun} />
      )}
    </div>
  )
}
