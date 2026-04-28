/**
 * FileEditor — inline editor for a knowledge asset file (editor / history / usage tabs).
 * Shared by the workspace knowledge page and KnowledgeFilePage.
 */
import { useState, useEffect } from 'react'
import {
  useProjectAssetFile,
  useProjectAssetHistory,
  useRestoreProjectAssetFile,
  useUpdateProjectAssetFile,
} from "@modules/assets/frontend/api/projectAssets"
import {
  useKnowledgeFile,
  useKnowledgeHistory,
  useUpdateKnowledgeFile,
  useRestoreKnowledgeFile,
} from "@modules/assets/frontend/api/knowledge"
import Card from '@ui/components/Card'
import Btn from '@ui/components/Btn'
import Badge from '@ui/components/Badge'
import Spinner from '@ui/components/Spinner'
import { EditorWorkspaceBody, EditorWorkspaceTabs } from '@ui/components/EditorWorkspace'
import { getAssetEditorPlugin } from '@modules/assets/frontend/editor/plugins/registry'

type Tab = 'editor' | 'history' | 'usage'
const FILE_EDITOR_TABS: { id: Tab; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'history', label: 'History' },
  { id: 'usage', label: 'Usage' },
]

function UsagePanel({
  linkedPaths,
}: {
  linkedPaths: string[]
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Used by</p>
      {!linkedPaths.length ? (
        <p className="text-sm text-gray-400">No linked workflows or documents yet.</p>
      ) : (
        <ul className="space-y-2">
          {linkedPaths.map((linkedPath) => (
            <li key={linkedPath} className="rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-700">
              {linkedPath}
            </li>
          ))}
        </ul>
      )}
    </Card>
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
  const projectHistory = useProjectAssetHistory(workspaceId ?? '', projectId ?? '', projectId ? path : null)
  const restoreKnowledge = useRestoreKnowledgeFile(path)
  const restoreProject = useRestoreProjectAssetFile(workspaceId ?? '', projectId ?? '', path)
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
  const projectFile = useProjectAssetFile(workspaceId ?? '', projectId ?? '', projectId ? path : '')
  const updateKnowledge = useUpdateKnowledgeFile(path)
  const updateProject = useUpdateProjectAssetFile(workspaceId ?? '', projectId ?? '', path)
  const file = projectId ? projectFile.data : knowledgeFile.data
  const isLoading = projectId ? projectFile.isLoading : knowledgeFile.isLoading
  const error = projectId ? projectFile.error : knowledgeFile.error
  const update = projectId ? updateProject : updateKnowledge

  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('editor')
  const [mode, setMode] = useState<'view' | 'edit'>('view')

  useEffect(() => {
    if (file) { setContent(file.content); setDirty(false); setMode('view') }
  }, [file?.version_id])

  async function save() {
    await update.mutateAsync({ content })
    setDirty(false)
    setMode('view')
  }

  if (isLoading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error) return <div className="p-6 text-red-500 text-sm">File not found.</div>
  if (!file) return null

  const isEditable = 'is_editable' in file ? file.is_editable : true
  const fileType = 'file_type' in file ? file.file_type : 'md'
  const editorFile = {
    path: file.path,
    title: file.title,
    content: file.content,
    file_type: fileType,
    is_editable: isEditable,
  }
  const editorPlugin = getAssetEditorPlugin(editorFile)
  const canEdit = editorPlugin.canEdit(editorFile)

  const tokenCount = file.raw_token_count
  const tokenWarn = tokenCount < 300 || tokenCount > 6000

  return (
    <div className="flex flex-col h-full">
      <EditorWorkspaceTabs
        tabs={FILE_EDITOR_TABS}
        activeTab={tab}
        onTabChange={setTab}
        actions={(
          <>
            <span className={`text-xs ${tokenWarn ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
              {tokenCount} tok{tokenWarn ? ' !' : ''}
            </span>
            {tab === 'editor' && canEdit && mode === 'view' && (
              <Btn size="sm" onClick={() => setMode('edit')}>Edit</Btn>
            )}
            {tab === 'editor' && canEdit && mode === 'edit' && (
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
          </>
        )}
      />

      {/* Panel content */}
      <EditorWorkspaceBody className="overflow-y-auto p-5">
        {tab === 'editor' && (
          <div className="space-y-3">
            {editorPlugin.render({
              file: editorFile,
              mode,
              content,
              dirty,
              isSaving: update.isPending,
              onChange: (next) => {
                setContent(next)
                setDirty(next !== file.content)
              },
              onSave: () => { void save() },
              onDiscard: () => { setContent(file.content); setDirty(false) },
            })}
          </div>
        )}
        {tab === 'history' && <HistoryPanel path={path} workspaceId={workspaceId} projectId={projectId} />}
        {tab === 'usage' && <UsagePanel linkedPaths={file.linked_paths ?? []} />}
      </EditorWorkspaceBody>
    </div>
  )
}
