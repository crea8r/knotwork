import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  useRun, useRunNodes, useDeleteRun, useCloneRun,
  useExecuteRunInline, useRunChatMessages, useAbortRun, useRunDefinition,
} from "@modules/workflows/frontend/api/runs"
import { useChannelParticipants, useMyChannelSubscriptions, useRespondChannelMessage } from '@modules/communication/frontend/api/channels'
import { useRegisteredAgents } from "@modules/admin/frontend/api/agents"
import GraphCanvas from '@modules/workflows/frontend/components/canvas/GraphCanvas'
import Spinner from '@ui/components/Spinner'
import RunInputPanel from '@modules/workflows/frontend/components/operator/RunInputPanel'
import MessageBubble from '@modules/workflows/frontend/components/operator/MessageBubble'
import DecisionCard from '@modules/workflows/frontend/components/operator/DecisionCard'
import RunDetailHeader from '@modules/workflows/frontend/components/operator/RunDetailHeader'
import RunFinalResultCard from '@modules/workflows/frontend/components/operator/RunFinalResultCard'
import RunStartInputCard from '@modules/workflows/frontend/components/operator/RunStartInputCard'
import { useAuthStore } from '@auth'
import { useRunNodeStatuses } from '@modules/workflows/frontend/hooks/useRunNodeStatuses'
import { useRunChatItems } from '@modules/workflows/frontend/hooks/useRunChatItems'
import { useRunWebSocket } from '@modules/workflows/frontend/hooks/useRunWebSocket'
import { buildThinkingPhrases, pickRandomPhrase } from '@modules/workflows/frontend/pages/runDetail/runDetailTypes'
import { buildParticipantLabelMap, formatAssignedParticipants } from '@modules/workflows/frontend/lib/participantLabels'
import { getRunFinalOutput } from '@modules/workflows/frontend/lib/runOutput'
import { humanizeRunInput } from '@modules/workflows/frontend/lib/runInput'

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
  const { data: runDefinition } = useRunDefinition(workspaceId, runId!)
  const { data: runMessages = [], refetch: refetchRunMessages } = useRunChatMessages(workspaceId, runId!, {
    refetchInterval: run && (ACTIVE.has(run.status) || run.status === 'paused') ? 2000 : false,
  })
  const { data: agents = [] } = useRegisteredAgents()
  const { data: participants = [] } = useChannelParticipants(workspaceId)
  const deleteRun = useDeleteRun(workspaceId)
  const cloneRun = useCloneRun(workspaceId)
  const executeInline = useExecuteRunInline(workspaceId)
  const abortRun = useAbortRun(workspaceId)
  const runChannelId = runMessages[0]?.channel_id ?? ''
  const respondToMessage = useRespondChannelMessage(workspaceId, runChannelId)
  const { data: mySubscriptions = [] } = useMyChannelSubscriptions(workspaceId)
  const currentParticipantId = useMemo(() => {
    const inRunChannel = mySubscriptions.find((row) => row.channel_id === runChannelId)
    if (inRunChannel?.participant_id) return inRunChannel.participant_id
    return mySubscriptions[0]?.participant_id ?? null
  }, [mySubscriptions, runChannelId])

  const definition = runDefinition ?? { nodes: [], edges: [] }
  const nodeStatuses = useRunNodeStatuses(nodeStates, definition, run?.status ?? '')
  const finalOutput = useMemo(() => getRunFinalOutput(run), [run])
  const startInputMarkdown = useMemo(() => humanizeRunInput(run?.input ?? {}), [run?.input])
  const startNodeId = useMemo(
    () => definition.nodes.find((node) => node.type === 'start')?.id ?? null,
    [definition.nodes],
  )
  const endNodeId = useMemo(
    () => definition.nodes.find((node) => node.type === 'end')?.id ?? null,
    [definition.nodes],
  )
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
  const participantLabelMap = useMemo(() => buildParticipantLabelMap(participants), [participants])

  const [showInputPanel, setShowInputPanel] = useState(false)
  const [showMobileMap, setShowMobileMap] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [awaitingAgentAfterReply, setAwaitingAgentAfterReply] = useState(false)
  const [lockedRequestMessageId, setLockedRequestMessageId] = useState<string | null>(null)
  const [escalationPanelCollapsed, setEscalationPanelCollapsed] = useState(false)
  const thinkingPhrases = useMemo(() => buildThinkingPhrases(), [])
  const [thinkingText, setThinkingText] = useState(() => pickRandomPhrase(thinkingPhrases))
  const chatScrollRef = useRef<HTMLDivElement | null>(null)

  const wsConnected = useRunWebSocket({ runId: runId!, runStatus: run?.status, refetchRun, refetchNodes, refetchRunMessages })

  const latestProgress = useMemo(() => {
    const msgs = runMessages.filter((m) => (m.metadata_ as Record<string, unknown>).kind === 'agent_progress')
    if (!msgs.length) return null
    const l = msgs[msgs.length - 1]; return { id: l.id, text: l.content }
  }, [runMessages])
  const completedNodeIds = useMemo(
    () => new Set(nodeStates.filter((nodeState) => nodeState.status === 'completed').map((nodeState) => nodeState.node_id)),
    [nodeStates],
  )
  const openRequestMessageId = useMemo(() => {
    const resolvedEscalationIds = new Set<string>()
    for (const message of runMessages) {
      const meta = message.metadata_ as Record<string, unknown>
      if (meta.kind !== 'escalation_resolution') continue
      const escalationId = typeof meta.escalation_id === 'string' ? meta.escalation_id : null
      if (escalationId) resolvedEscalationIds.add(escalationId)
    }
    for (let i = runMessages.length - 1; i >= 0; i -= 1) {
      const message = runMessages[i]
      const meta = message.metadata_ as Record<string, unknown>
      if (meta.kind !== 'request') continue
      if (message.node_id && completedNodeIds.has(message.node_id)) continue
      const req = meta.request as Record<string, unknown> | undefined
      if (!req) continue
      const assignedTo = Array.isArray(req.assigned_to) ? req.assigned_to.map(String) : []
      const addressedToCurrentParticipant = assignedTo.length === 0 || (!!currentParticipantId && assignedTo.includes(currentParticipantId))
      if (!addressedToCurrentParticipant) continue
      const escalationId = typeof req.escalation_id === 'string' ? req.escalation_id : null
      if (escalationId && resolvedEscalationIds.has(escalationId)) continue
      if (req.status === 'answered') continue
      return message.id
    }
    return null
  }, [runMessages, currentParticipantId, completedNodeIds])

  const chatItems = useRunChatItems({
    run,
    runMessages,
    nodeStates,
    nodeNameMap,
    nodeSpeakerMap,
    awaitingAgentAfterReply,
    lockedRequestMessageId,
    openRequestMessageId,
    thinkingText,
    thinkingPhrases,
    latestProgress,
  })
  const openRequestItem = useMemo(() => {
    if (!openRequestMessageId) return null
    for (let i = chatItems.length - 1; i >= 0; i -= 1) {
      const item = chatItems[i]
      if (item.kind === 'request' && item.requestMessageId === openRequestMessageId && item.request?.status === 'open') return item
    }
    return null
  }, [chatItems, openRequestMessageId])
  const formatAssigneeText = (assignedTo?: string[]) => formatAssignedParticipants(assignedTo, participantLabelMap)

  useEffect(() => { if (run?.status === 'running' || openRequestMessageId) setAwaitingAgentAfterReply(false) }, [run?.status, openRequestMessageId])
  useEffect(() => {
    if (!lockedRequestMessageId) return
    if (openRequestMessageId && openRequestMessageId !== lockedRequestMessageId) { setLockedRequestMessageId(null); setAwaitingAgentAfterReply(false); return }
    if (!openRequestMessageId && run && run.status !== 'paused') { setLockedRequestMessageId(null); setAwaitingAgentAfterReply(false) }
  }, [lockedRequestMessageId, openRequestMessageId, run])
  useEffect(() => {
    const active = !!run && (run.status === 'running' || (run.status === 'paused' && !openRequestMessageId))
    if (!active) return
    setThinkingText((prev) => pickRandomPhrase(thinkingPhrases, prev))
    const t = window.setInterval(() => setThinkingText((prev) => pickRandomPhrase(thinkingPhrases, prev)), 4500)
    return () => window.clearInterval(t)
  }, [run, openRequestMessageId, thinkingPhrases])
  useEffect(() => { setEscalationPanelCollapsed(false) }, [openRequestItem?.requestMessageId])
  useEffect(() => { const el = chatScrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [chatItems.length, run?.status])

  async function handleDelete() {
    if (!confirm('Delete this run? This cannot be undone.')) return
    try { await deleteRun.mutateAsync(runId!); navigate('/runs') }
    catch (err) { alert(`Delete failed: ${axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)}`) }
  }
  async function handleAbort() {
    if (!confirm('Abort this run?\n\nUse this only when the agent appears stuck with no response.')) return
    try { await abortRun.mutateAsync(runId!); refetchRun(); refetchNodes(); refetchRunMessages() }
    catch (err) { alert(`Abort failed: ${axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)}`) }
  }
  async function handleCloneAndRun() {
    try { const d = await cloneRun.mutateAsync(runId!); await executeInline.mutateAsync(d.id); navigate(`/runs/${d.id}`) }
    catch (err) { alert(`Clone failed: ${axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)}`) }
  }

  if (!run) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>

  const canvasProps = {
    definition,
    nodeStatuses,
    participantLabelMap,
    selectedNodeId,
    onSelectNode: (nid: string | null) => setSelectedNodeId(nid),
  }

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
          {run.status === 'failed' && run.error && (
            <div className="mx-3 md:mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-red-500">✕</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-red-700 mb-0.5">Run failed</p>
                <pre className="text-xs text-red-800 whitespace-pre-wrap break-words font-mono leading-relaxed">{run.error}</pre>
              </div>
            </div>
          )}
          <div ref={chatScrollRef} className="relative flex-1 overflow-y-auto p-3 md:p-4 space-y-2.5">
            <RunStartInputCard
              inputMarkdown={startInputMarkdown}
              createdAt={run.created_at}
              onClick={startNodeId ? () => setSelectedNodeId(startNodeId) : undefined}
            />
            {chatItems.map((item) => (
              <div key={item.id}>
                {item.kind === 'decision_confident' ? (
                  <DecisionCard item={item} respondToMessage={respondToMessage}
                    disabled={respondToMessage.isPending || (!!openRequestMessageId && lockedRequestMessageId === openRequestMessageId)}
                    onAfterResolve={() => { setAwaitingAgentAfterReply(true); if (item.requestMessageId) setLockedRequestMessageId(item.requestMessageId); refetchRun(); refetchNodes(); refetchRunMessages() }}
                  />
                ) : item.kind === 'request' ? (
                  item.request?.status === 'open' && item.requestMessageId === openRequestMessageId ? null : (
                  <div className="max-w-[92%] mr-auto rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-amber-700">Operator request</p>
                        <p className="text-sm text-amber-950 truncate">
                          {`Waiting for ${formatAssigneeText(item.request?.assigned_to)} to respond.`}
                        </p>
                        {item.nodeName ? (
                          <p className="mt-0.5 text-xs text-amber-900/80 truncate">
                            Step: {item.nodeName}
                          </p>
                        ) : null}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                        item.request?.status === 'open'
                          ? 'bg-amber-200 text-amber-800'
                          : 'bg-gray-200 text-gray-700'
                      }`}>
                        {item.request?.status ?? 'pending'}
                      </span>
                    </div>
                    {item.preText && (
                      <div className="mt-1.5 rounded-lg border border-amber-100 bg-white/70 px-2.5 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-amber-700/80">Task context</p>
                        <p className="mt-0.5 text-xs text-amber-900/90 line-clamp-3">
                          {item.preText.replace(/\s+/g, ' ').trim()}
                        </p>
                      </div>
                    )}
                  </div>
                  )
                ) : (
                  <MessageBubble item={item}
                    highlighted={!!selectedNodeId && item.nodeId === selectedNodeId}
                    dimmed={!!selectedNodeId && !!item.nodeId && item.nodeId !== selectedNodeId}
                    onClick={item.nodeId ? () => setSelectedNodeId(item.nodeId!) : undefined}
                  />
                )}
              </div>
            ))}
            {run.status === 'completed' && finalOutput ? (
              <RunFinalResultCard
                finalOutput={finalOutput}
                completedAt={run.completed_at}
                onClick={endNodeId ? () => setSelectedNodeId(endNodeId) : undefined}
              />
            ) : null}
            {openRequestItem && (
              <div className="pointer-events-none sticky bottom-3 md:bottom-4 z-20 flex justify-center px-1 md:px-2">
                <div className="pointer-events-auto w-full rounded-2xl border border-amber-300 bg-white/96 shadow-[0_16px_40px_rgba(0,0,0,0.18)] backdrop-blur">
                  <button
                    type="button"
                    onClick={() => setEscalationPanelCollapsed((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 rounded-t-2xl px-3 py-2.5 text-left hover:bg-amber-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-amber-700">Awaiting operator response</p>
                      <p className="truncate text-sm font-medium text-gray-900">
                        {openRequestItem.nodeName ? openRequestItem.nodeName : 'Active request'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-amber-900/80">
                        Assigned to: {formatAssigneeText(openRequestItem.request?.assigned_to)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                        {openRequestItem.request?.status ?? 'open'}
                      </span>
                      {escalationPanelCollapsed ? <ChevronUp size={16} className="text-amber-700" /> : <ChevronDown size={16} className="text-amber-700" />}
                    </div>
                  </button>
                  {!escalationPanelCollapsed && (
                    <div className="max-h-[65vh] overflow-y-auto border-t border-amber-100 px-2 pb-2 md:max-h-[58vh]">
                      <DecisionCard item={openRequestItem} respondToMessage={respondToMessage}
                        assigneeText={formatAssigneeText(openRequestItem.request?.assigned_to)}
                        disabled={respondToMessage.isPending || (!!openRequestMessageId && lockedRequestMessageId === openRequestMessageId)}
                        onAfterResolve={() => { setAwaitingAgentAfterReply(true); if (openRequestItem.requestMessageId) setLockedRequestMessageId(openRequestItem.requestMessageId); refetchRun(); refetchNodes(); refetchRunMessages() }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
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
