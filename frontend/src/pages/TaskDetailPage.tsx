import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PlayCircle, Send } from 'lucide-react'
import { useChannelDecisions, useChannelMessages, usePostChannelMessage } from '@/api/channels'
import { useGraphs } from '@/api/graphs'
import { useRuns, useTriggerRunAny } from '@/api/runs'
import { useTask, useUpdateTask } from '@/api/projects'
import { useAuthStore } from '@/store/auth'
import Btn from '@/components/shared/Btn'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

function statusVariant(status: string): 'gray' | 'green' | 'orange' | 'red' {
  if (status === 'done' || status === 'completed') return 'green'
  if (status === 'blocked' || status === 'failed') return 'red'
  if (status === 'in_progress' || status === 'running') return 'orange'
  return 'gray'
}

export default function TaskDetailPage() {
  const { taskId = '' } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: task, isLoading } = useTask(workspaceId, taskId)
  const { data: runs = [] } = useRuns(workspaceId)
  const { data: workflows = [] } = useGraphs(workspaceId, task?.project_id)
  const { data: messages = [] } = useChannelMessages(workspaceId, task?.channel_id ?? '')
  const { data: decisions = [] } = useChannelDecisions(workspaceId, task?.channel_id ?? '')
  const postMessage = usePostChannelMessage(workspaceId, task?.channel_id ?? '')
  const updateTask = useUpdateTask(workspaceId, taskId)
  const triggerRun = useTriggerRunAny(workspaceId)

  const [draft, setDraft] = useState('')
  const [runGraphId, setRunGraphId] = useState('')
  const [runInput, setRunInput] = useState('{"text": ""}')

  const taskRuns = useMemo(() => runs.filter((run) => run.task_id === taskId), [runs, taskId])
  const timeline = useMemo(() => {
    const msgItems = messages.map((m) => ({ id: `m-${m.id}`, kind: 'message' as const, ts: new Date(m.created_at).getTime(), data: m }))
    const decisionItems = decisions.map((d) => ({ id: `d-${d.id}`, kind: 'decision' as const, ts: new Date(d.created_at).getTime(), data: d }))
    return [...msgItems, ...decisionItems].sort((a, b) => a.ts - b.ts)
  }, [messages, decisions])

  if (isLoading || !task) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to={task.project_id ? `/projects/${task.project_id}` : '/projects'} className="text-xs text-gray-500 hover:text-gray-700">
            {task.project_id ? 'Back to project' : 'Projects'}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{task.code ? `${task.code} · ${task.title}` : task.title}</h1>
          {task.description && <p className="mt-2 text-sm text-gray-600">{task.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(task.status)}>{task.status.replace('_', ' ')}</Badge>
          <select
            value={task.status}
            onChange={(e) => updateTask.mutate({ status: e.target.value })}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="open">open</option>
            <option value="in_progress">in progress</option>
            <option value="blocked">blocked</option>
            <option value="done">done</option>
          </select>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <div className="rounded-2xl border border-gray-200 bg-[#f7f8fb] overflow-hidden">
          <div className="border-b border-gray-200 bg-white px-4 py-3">
            <h2 className="font-semibold text-gray-900">Objective Channel</h2>
          </div>
          <div className="max-h-[28rem] overflow-y-auto p-4 space-y-3">
            {timeline.length === 0 ? <p className="text-sm text-gray-500">No messages yet.</p> : timeline.map((item) => {
              if (item.kind === 'message') {
                const mine = item.data.role === 'user'
                return (
                  <div key={item.id} className={`max-w-[90%] ${mine ? 'ml-auto' : 'mr-auto'}`}>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">
                      {item.data.author_name ?? (item.data.author_type === 'human' ? 'You' : 'Agent')}
                    </p>
                    <div className={`rounded-2xl border px-4 py-2.5 text-sm ${mine ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-200 bg-white text-gray-800'}`}>
                      {item.data.content}
                    </div>
                  </div>
                )
              }
              return (
                <div key={item.id} className="max-w-[90%] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-amber-700">Decision</p>
                  <p className="text-sm text-amber-900">{item.data.decision_type.replace(/_/g, ' ')}</p>
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 border-t border-gray-200 bg-white p-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  postMessage.mutate({ content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' }, { onSuccess: () => setDraft('') })
                }
              }}
              placeholder="Type a message..."
              className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
            <Btn
              size="sm"
              onClick={() => postMessage.mutate({ content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' }, { onSuccess: () => setDraft('') })}
              disabled={!draft.trim()}
            >
              <Send size={14} /> Send
            </Btn>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-900">Runs</h2>
            <div className="mt-3 space-y-2">
              {taskRuns.length === 0 ? <p className="text-sm text-gray-500">No runs yet.</p> : taskRuns.map((run) => (
                <button
                  key={run.id}
                  onClick={() => navigate(`/runs/${run.id}`)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-900">{run.name || run.id}</span>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-900">Trigger Run</h2>
            <div className="mt-3 space-y-3">
              <select
                value={runGraphId}
                onChange={(e) => setRunGraphId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select workflow</option>
                {workflows.map((graph) => <option key={graph.id} value={graph.id}>{graph.name}</option>)}
              </select>
              <textarea
                rows={6}
                value={runInput}
                onChange={(e) => setRunInput(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-brand-500"
              />
              <Btn
                size="sm"
                loading={triggerRun.isPending}
                disabled={!runGraphId}
                onClick={async () => {
                  try {
                    const parsed = JSON.parse(runInput)
                    const run = await triggerRun.mutateAsync({ graphId: runGraphId, input: parsed, task_id: taskId })
                    navigate(`/runs/${run.id}`)
                  } catch {
                    window.alert('Run input must be valid JSON.')
                  }
                }}
              >
                <PlayCircle size={14} /> Run Workflow
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
