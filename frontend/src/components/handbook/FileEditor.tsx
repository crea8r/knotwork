/**
 * FileEditor — inline editor for a Handbook file (editor / history / health tabs).
 * Shared by HandbookPage (inline panel) and KnowledgeFilePage (standalone route).
 */
import { useState, useEffect } from 'react'
import {
  useProjectDocument,
  useProjectDocumentHealth,
  useProjectDocumentHistory,
  useProjectDocumentSuggestions,
  useRestoreProjectDocument,
  useSummarizeProjectDocumentDiff,
  useUpdateProjectDocument,
} from '@/api/projects'
import {
  useKnowledgeFile,
  useKnowledgeHistory,
  useKnowledgeHealth,
  useKnowledgeSuggestions,
  useSummarizeKnowledgeDiff,
  useUpdateKnowledgeFile,
  useRestoreKnowledgeFile,
} from '@/api/knowledge'
import Card from '@/components/shared/Card'
import HealthDots from '@/components/shared/HealthDots'
import Btn from '@/components/shared/Btn'
import Badge from '@/components/shared/Badge'
import Spinner from '@/components/shared/Spinner'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import MarkdownWysiwygEditor from '@/components/handbook/MarkdownWysiwygEditor'
import FileViewer from '@/components/handbook/FileViewer'

type Tab = 'editor' | 'history' | 'health'

function HealthPanel({
  path,
  workspaceId,
  projectId,
}: {
  path: string
  workspaceId?: string
  projectId?: string
}) {
  const knowledgeHealth = useKnowledgeHealth(!projectId ? path : null)
  const projectHealth = useProjectDocumentHealth(workspaceId ?? '', projectId ?? '', projectId ? path : null)
  const knowledgeSuggestions = useKnowledgeSuggestions(!projectId ? path : null)
  const projectSuggestions = useProjectDocumentSuggestions(workspaceId ?? '', projectId ?? '', projectId ? path : null)
  const health = projectId ? projectHealth.data : knowledgeHealth.data
  const sugg = projectId ? projectSuggestions.data : knowledgeSuggestions.data
  const hLoading = projectId ? projectHealth.isLoading : knowledgeHealth.isLoading
  const sLoading = projectId ? projectSuggestions.isLoading : knowledgeSuggestions.isLoading
  const score = health?.health_score ?? null

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Health score</p>
        {hLoading ? <Spinner /> : (
          <div className="flex items-center gap-3">
            <HealthDots score={score} />
            <span className="text-xl font-bold text-gray-800">
              {score !== null ? `${score.toFixed(1)}/5` : 'No data'}
            </span>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-1">token 20% · confidence 30% · escalation 25% · rating 25%</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Mode B Suggestions</p>
        {sLoading ? <Spinner /> : !sugg?.suggestions.length ? (
          <p className="text-sm text-gray-400">No suggestions yet.</p>
        ) : (
          <ul className="space-y-2">
            {sugg.suggestions.map((s, i) => (
              <li key={i} className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                💡 {s}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function HistoryPanel({
  path,
  workspaceId,
  projectId,
}: {
  path: string
  workspaceId?: string
  projectId?: string
}) {
  const knowledgeHistory = useKnowledgeHistory(!projectId ? path : null)
  const projectHistory = useProjectDocumentHistory(workspaceId ?? '', projectId ?? '', projectId ? path : null)
  const restoreKnowledge = useRestoreKnowledgeFile(path)
  const restoreProject = useRestoreProjectDocument(workspaceId ?? '', projectId ?? '', path)
  const versions = (projectId ? projectHistory.data : knowledgeHistory.data) ?? []
  const isLoading = projectId ? projectHistory.isLoading : knowledgeHistory.isLoading
  const restore = projectId ? restoreProject : restoreKnowledge
  if (isLoading) return <Spinner />
  if (!versions.length) return <p className="text-sm text-gray-400">No versions yet.</p>
  return (
    <Card className="divide-y">
      {versions.map((v, i) => (
        <div key={v.version_id} className="flex items-start gap-4 p-4">
          <div className="flex-1">
            <p className="font-mono text-xs text-gray-500">{v.version_id.slice(0, 8)}…</p>
            <p className="text-sm text-gray-700">{v.change_summary ?? '(no summary)'}</p>
            <p className="text-xs text-gray-400">{new Date(v.saved_at).toLocaleString()}</p>
          </div>
          {i === 0
            ? <Badge variant="green">Current</Badge>
            : <Btn variant="ghost" size="sm" loading={restore.isPending} onClick={() => restore.mutate(v.version_id)}>Restore</Btn>
          }
        </div>
      ))}
    </Card>
  )
}

interface Props {
  path: string
  workspaceId?: string
  projectId?: string
}

export default function FileEditor({ path, workspaceId, projectId }: Props) {
  const knowledgeFile = useKnowledgeFile(!projectId ? path || null : null)
  const projectFile = useProjectDocument(workspaceId ?? '', projectId ?? '', projectId ? path : '')
  const updateKnowledge = useUpdateKnowledgeFile(path)
  const updateProject = useUpdateProjectDocument(workspaceId ?? '', projectId ?? '', path)
  const summarizeKnowledgeDiff = useSummarizeKnowledgeDiff(path)
  const summarizeProjectDiff = useSummarizeProjectDocumentDiff(workspaceId ?? '', projectId ?? '', path)
  const file = projectId ? projectFile.data : knowledgeFile.data
  const isLoading = projectId ? projectFile.isLoading : knowledgeFile.isLoading
  const error = projectId ? projectFile.error : knowledgeFile.error
  const update = projectId ? updateProject : updateKnowledge
  const summarizeDiff = projectId ? summarizeProjectDiff : summarizeKnowledgeDiff

  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('editor')
  const [mode, setMode] = useState<'view' | 'edit'>('view')

  useEffect(() => {
    if (file) { setContent(file.content); setDirty(false); setMode('view') }
  }, [file?.version_id])

  async function save() {
    let changeSummary = summary.trim()
    if (!changeSummary) {
      const generated = await summarizeDiff.mutateAsync({ content })
      changeSummary = generated.summary
    }
    await update.mutateAsync({ content, change_summary: changeSummary || undefined })
    setSummary('')
    setDirty(false)
  }

  if (isLoading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error) return <div className="p-6 text-red-500 text-sm">File not found.</div>
  if (!file) return null

  const isEditable = 'is_editable' in file ? file.is_editable : true
  const fileType = 'file_type' in file ? file.file_type : 'md'

  // Binary view-only files (PDF, DOCX, image) bypass the editor entirely
  if (!isEditable) {
    return <FileViewer path={file.path} file_type={fileType} title={file.title} />
  }

  const tokenCount = file.raw_token_count
  const tokenWarn = tokenCount < 300 || tokenCount > 6000

  return (
    <div className="flex flex-col h-full">
      {/* File header */}
      <div className="px-5 pt-5 pb-3 border-b">
        <div className="flex items-center justify-between gap-4 mt-1">
          <div className="flex gap-4 text-sm">
            {(['editor', 'history', 'health'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`pb-1.5 capitalize transition-colors ${
                  tab === t
                    ? 'border-b-2 border-brand-500 text-brand-600 font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'health' ? 'Health' : t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs ${tokenWarn ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
              {tokenCount} tok{tokenWarn ? ' ⚠' : ''}
            </span>
            <HealthDots score={file.health_score} />
            {tab === 'editor' && mode === 'view' && (
              <Btn size="sm" onClick={() => setMode('edit')}>Edit</Btn>
            )}
            {tab === 'editor' && mode === 'edit' && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  setContent(file.content)
                  setDirty(false)
                  setMode('view')
                }}
              >
                Cancel edit
              </Btn>
            )}
          </div>
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'editor' && (
          <div className="space-y-3">
            {mode === 'view' ? (
              <div className="border border-gray-200 rounded-lg p-4 bg-white">
                <MarkdownViewer content={file.content} />
              </div>
            ) : (
              <>
                <MarkdownWysiwygEditor
                  value={content}
                  onChange={(next) => {
                    setContent(next)
                    setDirty(next !== file.content)
                  }}
                />
                {dirty && (
                  <div className="flex items-center gap-2">
                    <input
                      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1"
                      placeholder="Change summary (optional)"
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                    />
                    <Btn size="sm" loading={update.isPending || summarizeDiff.isPending} onClick={save}>Save</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => { setContent(file.content); setDirty(false) }}>
                      Discard
                    </Btn>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {tab === 'history' && <HistoryPanel path={path} workspaceId={workspaceId} projectId={projectId} />}
        {tab === 'health' && <HealthPanel path={path} workspaceId={workspaceId} projectId={projectId} />}
      </div>
    </div>
  )
}
