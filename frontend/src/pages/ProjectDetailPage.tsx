import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FolderPlus, MessageSquare, Pencil, Plus, Save, Send, Sparkles, Workflow, X } from 'lucide-react'
import { useChannelDecisions, useChannelMessages, usePostChannelMessage } from '@/api/channels'
import { useCreateGraph, useGraphs } from '@/api/graphs'
import {
  useCreateObjective,
  useCreateProjectDocument,
  useCreateProjectStatusUpdate,
  useProjectDashboard,
  useProjectDocument,
  useProjectDocuments,
  useUpdateObjective,
} from '@/api/projects'
import { useAuthStore } from '@/store/auth'
import ObjectiveCanvas from '@/components/canvas/ObjectiveCanvas'
import Btn from '@/components/shared/Btn'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import type { Objective } from '@/types'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

type ProjectView = 'objectives' | 'handbook' | 'channel'
type ObjectivePanelTab = 'info' | 'progress'

function statusVariant(status: string): 'gray' | 'green' | 'orange' | 'red' {
  if (status === 'done' || status === 'completed') return 'green'
  if (status === 'blocked' || status === 'failed') return 'red'
  if (status === 'in_progress' || status === 'running') return 'orange'
  return 'gray'
}

function objectiveLabel(objective: Objective): string {
  return [objective.code, objective.title].filter(Boolean).join(' ')
}

function buildObjectiveTree(objectives: Objective[]) {
  const byParent = new Map<string | null, Objective[]>()
  for (const objective of objectives) {
    const key = objective.parent_task_id ?? null
    const bucket = byParent.get(key) ?? []
    bucket.push(objective)
    byParent.set(key, bucket)
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title))
  }
  const lines: Array<{ objective: Objective; depth: number }> = []
  function walk(parentId: string | null, depth: number) {
    for (const objective of byParent.get(parentId) ?? []) {
      lines.push({ objective, depth })
      walk(objective.id, depth + 1)
    }
  }
  walk(null, 0)
  return lines
}

function useChannelTimeline(workspaceId: string, channelId: string | null) {
  const { data: messages = [] } = useChannelMessages(workspaceId, channelId ?? '')
  const { data: decisions = [] } = useChannelDecisions(workspaceId, channelId ?? '')
  return useMemo(() => {
    const msgItems = messages.map((item) => ({
      id: `m-${item.id}`,
      kind: 'message' as const,
      ts: new Date(item.created_at).getTime(),
      data: item,
    }))
    const decisionItems = decisions.map((item) => ({
      id: `d-${item.id}`,
      kind: 'decision' as const,
      ts: new Date(item.created_at).getTime(),
      data: item,
    }))
    return [...msgItems, ...decisionItems].sort((a, b) => a.ts - b.ts)
  }, [decisions, messages])
}

function ObjectiveTreeList({
  objectives,
  selectedObjectiveId,
  onSelect,
}: {
  objectives: Objective[]
  selectedObjectiveId: string | null
  onSelect: (objectiveId: string) => void
}) {
  const tree = useMemo(() => buildObjectiveTree(objectives), [objectives])
  if (tree.length === 0) return <p className="text-sm text-gray-500">No objectives yet.</p>

  return (
    <div className="space-y-1">
      {tree.map(({ objective, depth }) => (
        <button
          key={objective.id}
          onClick={() => onSelect(objective.id)}
          className={`flex w-full items-start rounded-xl px-3 py-2 text-left text-sm ${
            selectedObjectiveId === objective.id ? 'bg-stone-900 text-white' : 'bg-white text-stone-700 hover:bg-stone-100'
          }`}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          <div>
            <p className="font-semibold">{objectiveLabel(objective)}</p>
            <p className={`mt-0.5 text-xs ${selectedObjectiveId === objective.id ? 'text-stone-300' : 'text-stone-500'}`}>
              {objective.progress_percent}% complete
            </p>
          </div>
        </button>
      ))}
    </div>
  )
}

function ChatTimeline({
  timeline,
  draft,
  setDraft,
  onSend,
  title,
}: {
  timeline: ReturnType<typeof useChannelTimeline>
  draft: string
  setDraft: (value: string) => void
  onSend: () => void
  title: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-stone-200 bg-[#faf7f1]">
      <div className="border-b border-stone-200 bg-white px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {timeline.length === 0 ? <p className="text-sm text-stone-500">No messages yet.</p> : timeline.map((item) => {
          if (item.kind === 'message') {
            const mine = item.data.role === 'user'
            return (
              <div key={item.id} className={`max-w-[90%] ${mine ? 'ml-auto' : 'mr-auto'}`}>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-stone-400">
                  {item.data.author_name ?? (item.data.author_type === 'human' ? 'You' : 'Agent')}
                </p>
                <div className={`rounded-2xl border px-4 py-2.5 text-sm ${mine ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-800'}`}>
                  {item.data.content}
                </div>
              </div>
            )
          }
          return (
            <div key={item.id} className="max-w-[90%] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-amber-700">Decision</p>
              <p className="text-sm text-amber-900">{item.data.decision_type.replace(/_/g, ' ')}</p>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 border-t border-stone-200 bg-white p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) onSend()
          }}
          placeholder="Type a message..."
          className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
        />
        <Btn size="sm" onClick={onSend} disabled={!draft.trim()}>
          <Send size={14} /> Send
        </Btn>
      </div>
    </div>
  )
}

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: dashboard, isLoading } = useProjectDashboard(workspaceId, projectId)
  const { data: docs = [] } = useProjectDocuments(workspaceId, projectId)
  const { data: workflows = [] } = useGraphs(workspaceId, projectId)

  const [view, setView] = useState<ProjectView>('objectives')
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null)
  const [hasAutoSelectedObjective, setHasAutoSelectedObjective] = useState(false)
  const [objectivePanelTab, setObjectivePanelTab] = useState<ObjectivePanelTab>('info')
  const [editingObjectiveHeading, setEditingObjectiveHeading] = useState(false)
  const [selectedPath, setSelectedPath] = useState('')
  const [showObjectiveComposer, setShowObjectiveComposer] = useState(false)
  const [composerParentId, setComposerParentId] = useState<string | null>(null)
  const [projectStatusDraft, setProjectStatusDraft] = useState('')
  const [workflowName, setWorkflowName] = useState('')
  const [docPath, setDocPath] = useState('')
  const [docContent, setDocContent] = useState('')
  const [projectChatDraft, setProjectChatDraft] = useState('')
  const [objectiveChatDraft, setObjectiveChatDraft] = useState('')
  const [objectiveForm, setObjectiveForm] = useState({
    code: '',
    title: '',
    description: '',
    progress_percent: 0,
    status_summary: '',
    key_results_text: '',
    owner_name: '',
    deadline: '',
    status: 'open',
  })
  const [composerForm, setComposerForm] = useState({
    code: '',
    title: '',
    description: '',
  })

  const createObjective = useCreateObjective(workspaceId)
  const updateObjective = useUpdateObjective(workspaceId, selectedObjectiveId ?? '')
  const createDoc = useCreateProjectDocument(workspaceId, projectId)
  const createStatus = useCreateProjectStatusUpdate(workspaceId, projectId)
  const createGraph = useCreateGraph(workspaceId)

  const project = dashboard?.project
  const objectives = dashboard?.tasks ?? []
  const selectedObjective = objectives.find((item) => item.id === selectedObjectiveId) ?? null
  const { data: selectedDoc } = useProjectDocument(workspaceId, projectId, selectedPath)

  useEffect(() => {
    if (!hasAutoSelectedObjective && !selectedObjectiveId && objectives.length > 0) {
      setSelectedObjectiveId(objectives[0].id)
      setHasAutoSelectedObjective(true)
    }
  }, [hasAutoSelectedObjective, objectives, selectedObjectiveId])

  useEffect(() => {
    if (!selectedObjective) return
    setObjectivePanelTab('info')
    setEditingObjectiveHeading(false)
    setObjectiveForm({
      code: selectedObjective.code ?? '',
      title: selectedObjective.title,
      description: selectedObjective.description ?? '',
      progress_percent: selectedObjective.progress_percent ?? 0,
      status_summary: selectedObjective.status_summary ?? '',
      key_results_text: (selectedObjective.key_results ?? []).join('\n'),
      owner_name: selectedObjective.owner_name ?? '',
      deadline: selectedObjective.deadline ?? '',
      status: selectedObjective.status,
    })
  }, [selectedObjective?.id])

  const projectChannelId = project?.project_channel_id ?? null
  const projectTimeline = useChannelTimeline(workspaceId, projectChannelId)
  const objectiveTimeline = useChannelTimeline(workspaceId, selectedObjective?.channel_id ?? null)
  const postProjectMessage = usePostChannelMessage(workspaceId, projectChannelId ?? '')
  const postObjectiveMessage = usePostChannelMessage(workspaceId, selectedObjective?.channel_id ?? '')

  if (isLoading || !project) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  async function submitObjectiveForm() {
    if (!selectedObjective) return
    await updateObjective.mutateAsync({
      code: objectiveForm.code || undefined,
      title: objectiveForm.title,
      description: objectiveForm.description || undefined,
      progress_percent: Number(objectiveForm.progress_percent),
      status_summary: objectiveForm.status_summary || undefined,
      key_results: objectiveForm.key_results_text.split('\n').map((item) => item.trim()).filter(Boolean),
      owner_name: objectiveForm.owner_name || undefined,
      owner_type: objectiveForm.owner_name ? 'human' : undefined,
      deadline: objectiveForm.deadline || undefined,
      status: objectiveForm.status,
    })
  }

  async function createNewObjective() {
    if (!composerForm.title.trim()) return
    const objective = await createObjective.mutateAsync({
      code: composerForm.code.trim() || undefined,
      title: composerForm.title.trim(),
      description: composerForm.description.trim() || undefined,
      project_id: projectId,
      parent_task_id: composerParentId ?? undefined,
      status_summary: 'New objective. Needs a first update.',
    })
    setShowObjectiveComposer(false)
    setComposerParentId(null)
    setComposerForm({ code: '', title: '', description: '' })
    setSelectedObjectiveId(objective.id)
  }

  const sortedDocs = docs.slice().sort((a, b) => a.path.localeCompare(b.path))

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-8">
      <div className="rounded-[32px] border border-stone-200 bg-[#f6f2e8] p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-4xl">
            <Link to="/projects" className="text-xs text-stone-500 hover:text-stone-700">Projects</Link>
            <div className="mt-2 flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950">{project.title}</h1>
              <Badge variant={statusVariant(project.status)}>{project.status.replace('_', ' ')}</Badge>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">{project.objective}</p>
            <div className="mt-4 flex flex-wrap gap-5 text-xs uppercase tracking-wide text-stone-500">
              <span>Deadline: {project.deadline ? new Date(project.deadline).toLocaleDateString() : 'None'}</span>
              <span>{objectives.length} objectives</span>
              <span>{project.run_count} runs</span>
            </div>
          </div>
          <div className="max-w-lg rounded-3xl border border-stone-200 bg-white p-5">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
              <Sparkles size={14} /> Current Status
            </p>
            <p className="mt-3 text-sm leading-6 text-stone-700">
              {dashboard?.latest_status_update?.summary ?? 'No project summary yet.'}
            </p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!projectStatusDraft.trim()) return
                createStatus.mutate({ summary: projectStatusDraft.trim(), author_name: 'You' }, { onSuccess: () => setProjectStatusDraft('') })
              }}
            >
              <textarea
                rows={3}
                value={projectStatusDraft}
                onChange={(e) => setProjectStatusDraft(e.target.value)}
                placeholder="Write a concise project status update."
                className="w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
              />
              <Btn type="submit" size="sm" loading={createStatus.isPending}>
                <Send size={14} /> Update Status
              </Btn>
            </form>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['objectives', 'handbook', 'channel'] as ProjectView[]).map((item) => (
          <button
            key={item}
            onClick={() => setView(item)}
            className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${
              view === item ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {view === 'objectives' && (
        <div className="min-h-[760px]">
          <Card className="relative overflow-hidden rounded-[32px] border-stone-200 bg-[#e9e4d8] p-4">
            <div className="mb-3 flex items-center justify-between gap-3 px-2">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Objective Tree</p>
                <p className="mt-1 text-sm text-stone-700">Map the project as a hierarchy of objectives.</p>
              </div>
              <Btn
                size="sm"
                onClick={() => {
                  setComposerParentId(null)
                  setShowObjectiveComposer(true)
                }}
              >
                <Plus size={14} /> New Objective
              </Btn>
            </div>
            <div className="h-[700px]">
              <ObjectiveCanvas
                objectives={objectives}
                selectedObjectiveId={selectedObjectiveId}
                onSelectObjective={(objectiveId) => {
                  setSelectedObjectiveId(objectiveId)
                  if (objectiveId) setObjectivePanelTab('info')
                }}
              />
            </div>
            {selectedObjective ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-16 py-10">
                <button
                  type="button"
                  aria-label="Close objective detail"
                  onClick={() => setSelectedObjectiveId(null)}
                  className="pointer-events-auto absolute inset-0 cursor-default"
                />
                <Card className="pointer-events-auto w-full max-w-2xl rounded-[32px] border-stone-200 bg-white/96 p-5 shadow-2xl backdrop-blur">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Objective Detail</p>
                      <div className="mt-3 flex items-start gap-3">
                        {editingObjectiveHeading ? (
                          <div className="grid flex-1 gap-3 md:grid-cols-[120px_1fr]">
                            <input
                              autoFocus
                              value={objectiveForm.code}
                              onChange={(e) => setObjectiveForm((current) => ({ ...current, code: e.target.value.slice(0, 5) }))}
                              className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold uppercase outline-none focus:ring-2 focus:ring-stone-900"
                            />
                            <input
                              value={objectiveForm.title}
                              onChange={(e) => setObjectiveForm((current) => ({ ...current, title: e.target.value }))}
                              className="rounded-xl border border-stone-300 px-3 py-2 text-base font-semibold outline-none focus:ring-2 focus:ring-stone-900"
                            />
                          </div>
                        ) : (
                          <div className="flex-1">
                            <h2 className="text-2xl font-semibold text-stone-950">
                              {[objectiveForm.code || selectedObjective.code, objectiveForm.title || selectedObjective.title].filter(Boolean).join(' · ')}
                            </h2>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingObjectiveHeading((value) => !value)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 text-stone-500 hover:bg-stone-100"
                          title="Edit code and title"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(objectiveForm.status)}>{objectiveForm.status.replace('_', ' ')}</Badge>
                      <button
                        type="button"
                        onClick={() => setSelectedObjectiveId(null)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 text-stone-500 hover:bg-stone-100"
                        title="Close"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    {(['info', 'progress'] as ObjectivePanelTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setObjectivePanelTab(tab)}
                        className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${
                          objectivePanelTab === tab ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {objectivePanelTab === 'info' ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="text-sm text-stone-600 md:col-span-2">
                        Description
                        <textarea
                          rows={4}
                          value={objectiveForm.description}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, description: e.target.value }))}
                          className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                      <label className="text-sm text-stone-600">
                        In Charge
                        <input
                          value={objectiveForm.owner_name}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, owner_name: e.target.value }))}
                          placeholder="Human or agent"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                      <label className="text-sm text-stone-600">
                        Deadline
                        <input
                          type="date"
                          value={objectiveForm.deadline}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, deadline: e.target.value }))}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                      <label className="text-sm text-stone-600 md:col-span-2">
                        Status
                        <select
                          value={objectiveForm.status}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, status: e.target.value }))}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        >
                          <option value="open">open</option>
                          <option value="in_progress">in progress</option>
                          <option value="blocked">blocked</option>
                          <option value="done">done</option>
                        </select>
                      </label>
                      <label className="text-sm text-stone-600 md:col-span-2">
                        Key Results
                        <textarea
                          rows={5}
                          value={objectiveForm.key_results_text}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, key_results_text: e.target.value }))}
                          placeholder="One key result per line"
                          className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="flex items-center justify-between text-sm text-stone-600">
                          <span>Progress</span>
                          <span>{objectiveForm.progress_percent}%</span>
                        </div>
                        <div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-200">
                          <div
                            className="h-full rounded-full bg-stone-900 transition-all"
                            style={{ width: `${objectiveForm.progress_percent}%` }}
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={objectiveForm.progress_percent}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, progress_percent: Number(e.target.value) }))}
                          className="mt-3 w-full"
                        />
                      </div>
                      <label className="block text-sm text-stone-600">
                        Current Status
                        <textarea
                          rows={4}
                          value={objectiveForm.status_summary}
                          onChange={(e) => setObjectiveForm((current) => ({ ...current, status_summary: e.target.value }))}
                          className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </label>
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Btn size="sm" onClick={submitObjectiveForm} loading={updateObjective.isPending}>
                      <Save size={14} /> Save Objective
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setComposerParentId(selectedObjective.id)
                        setShowObjectiveComposer(true)
                      }}
                    >
                      <FolderPlus size={14} /> New Child Objective
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => setView('channel')}
                    >
                      <MessageSquare size={14} /> Open Objective Chat
                    </Btn>
                  </div>
                </Card>
              </div>
            ) : null}
          </Card>

          <Card className="mt-5 rounded-[32px] border-stone-200 bg-white p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Recent Run Activity</p>
            <div className="mt-4 space-y-3">
              {dashboard.recent_runs.length === 0 ? <p className="text-sm text-stone-500">No runs yet.</p> : dashboard.recent_runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => navigate(`/runs/${run.id}`)}
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-left hover:bg-stone-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-stone-900">{run.name || run.id}</p>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {view === 'handbook' && (
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="rounded-[32px] border-stone-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Project Files</p>
                <p className="mt-1 text-sm text-stone-700">Project-specific notes, briefs, and decisions.</p>
              </div>
            </div>
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!docPath.trim() || !docContent.trim()) return
                createDoc.mutate(
                  { path: docPath.trim(), content: docContent, title: docPath.trim().split('/').pop() },
                  {
                    onSuccess: (doc) => {
                      setSelectedPath(doc.path)
                      setDocPath('')
                      setDocContent('')
                    },
                  },
                )
              }}
            >
              <input
                value={docPath}
                onChange={(e) => setDocPath(e.target.value)}
                placeholder="brief.md"
                className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
              />
              <textarea
                rows={8}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                placeholder="Write project-specific context."
                className="w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
              />
              <Btn type="submit" size="sm" loading={createDoc.isPending}>
                <Plus size={14} /> Save File
              </Btn>
            </form>
            <div className="mt-5 space-y-2">
              {sortedDocs.length === 0 ? <p className="text-sm text-stone-500">No project files yet.</p> : sortedDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => setSelectedPath(doc.path)}
                  className={`w-full rounded-2xl border px-3 py-2 text-left text-sm ${selectedPath === doc.path ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white hover:bg-stone-50'}`}
                >
                  {doc.path}
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-[32px] border-stone-200 bg-white p-6">
              <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Selected File</p>
              {selectedDoc ? (
                <div className="mt-4 rounded-3xl border border-stone-200 bg-[#faf7f1] p-5">
                  <p className="text-xs uppercase tracking-wide text-stone-500">{selectedDoc.path}</p>
                  <pre className="mt-3 whitespace-pre-wrap text-sm text-stone-700">{selectedDoc.content}</pre>
                </div>
              ) : (
                <p className="mt-4 text-sm text-stone-500">Choose a file to preview it here.</p>
              )}
            </Card>

            <Card className="rounded-[32px] border-stone-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Project Workflows</p>
                  <p className="mt-1 text-sm text-stone-700">Workflows here stay scoped to this project.</p>
                </div>
                <Workflow size={16} className="text-stone-400" />
              </div>
              <form
                className="mt-5 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!workflowName.trim()) return
                  createGraph.mutate(
                    { name: workflowName.trim(), project_id: projectId },
                    { onSuccess: (graph) => { setWorkflowName(''); navigate(`/graphs/${graph.id}`) } },
                  )
                }}
              >
                <input
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  placeholder="New project workflow"
                  className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                />
                <Btn type="submit" size="sm" loading={createGraph.isPending}>
                  <Plus size={14} /> Add
                </Btn>
              </form>
              <div className="mt-4 space-y-2">
                {workflows.length === 0 ? <p className="text-sm text-stone-500">No project workflows yet.</p> : workflows.map((graph) => (
                  <button
                    key={graph.id}
                    onClick={() => navigate(`/graphs/${graph.id}`)}
                    className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-left hover:bg-stone-50"
                  >
                    <p className="font-medium text-stone-900">{graph.name}</p>
                    <p className="mt-1 text-xs text-stone-500">{graph.run_count} run(s)</p>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {view === 'channel' && (
        <div className="grid min-h-[720px] gap-5 lg:grid-cols-[320px_1fr]">
          <Card className="rounded-[32px] border-stone-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Objectives</p>
              <Btn size="sm" variant="ghost" onClick={() => setSelectedObjectiveId(null)}>
                Project
              </Btn>
            </div>
            <button
              onClick={() => setSelectedObjectiveId(null)}
              className={`mt-4 w-full rounded-2xl px-3 py-3 text-left text-sm ${
                selectedObjectiveId === null ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              <p className="font-semibold">Project Channel</p>
              <p className={`mt-1 text-xs ${selectedObjectiveId === null ? 'text-stone-300' : 'text-stone-500'}`}>General coordination and updates</p>
            </button>
            <div className="mt-4 max-h-[600px] overflow-y-auto">
              <ObjectiveTreeList
                objectives={objectives}
                selectedObjectiveId={selectedObjectiveId}
                onSelect={(objectiveId) => setSelectedObjectiveId(objectiveId)}
              />
            </div>
          </Card>

          {selectedObjectiveId && selectedObjective ? (
            <ChatTimeline
              title={`Objective Chat · ${objectiveLabel(selectedObjective)}`}
              timeline={objectiveTimeline}
              draft={objectiveChatDraft}
              setDraft={setObjectiveChatDraft}
              onSend={() => {
                if (!selectedObjective.channel_id || !objectiveChatDraft.trim()) return
                postObjectiveMessage.mutate(
                  { content: objectiveChatDraft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
                  { onSuccess: () => setObjectiveChatDraft('') },
                )
              }}
            />
          ) : (
            <ChatTimeline
              title="Project Channel"
              timeline={projectTimeline}
              draft={projectChatDraft}
              setDraft={setProjectChatDraft}
              onSend={() => {
                if (!projectChannelId || !projectChatDraft.trim()) return
                postProjectMessage.mutate(
                  { content: projectChatDraft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
                  { onSuccess: () => setProjectChatDraft('') },
                )
              }}
            />
          )}
        </div>
      )}

      {showObjectiveComposer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-[32px] bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-stone-950">
              {composerParentId ? 'New Child Objective' : 'New Objective'}
            </h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void createNewObjective()
              }}
            >
              <div className="grid gap-4 md:grid-cols-[120px_1fr]">
                <label className="text-sm text-stone-600">
                  Code
                  <input
                    value={composerForm.code}
                    onChange={(e) => setComposerForm((current) => ({ ...current, code: e.target.value.slice(0, 5) }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </label>
                <label className="text-sm text-stone-600">
                  Title
                  <input
                    autoFocus
                    value={composerForm.title}
                    onChange={(e) => setComposerForm((current) => ({ ...current, title: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </label>
              </div>
              <label className="block text-sm text-stone-600">
                Description
                <textarea
                  rows={4}
                  value={composerForm.description}
                  onChange={(e) => setComposerForm((current) => ({ ...current, description: e.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Btn type="button" variant="ghost" size="sm" onClick={() => setShowObjectiveComposer(false)}>Cancel</Btn>
                <Btn type="submit" size="sm" loading={createObjective.isPending}>Create Objective</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
