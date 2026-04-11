import Btn from '@ui/components/Btn'
import { Download } from 'lucide-react'
import PresentationEditor from '@modules/assets/frontend/components/handbook/PresentationEditor'
import { usePresentationExportUrl } from '@modules/assets/frontend/api/knowledge'
import type { AssetEditorPlugin } from './types'

function ExportPresentationButton({ path }: { path: string }) {
  const url = usePresentationExportUrl(path)
  if (!url) return null
  return (
    <a
      href={url}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
    >
      <Download size={14} />
      Export .pptx
    </a>
  )
}

export const presentationAssetEditor: AssetEditorPlugin = {
  id: 'presentation',
  label: 'Presentation',
  canHandle: (file) => file.file_type === 'presentation',
  canEdit: (file) => file.is_editable !== false,
  render: ({ file, mode, content, dirty, isSaving, onChange, onSave, onDiscard }) => (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ExportPresentationButton path={file.path} />
      </div>
      <PresentationEditor
        value={mode === 'view' ? file.content : content}
        title={file.title}
        mode={mode}
        onChange={onChange}
      />
      {mode === 'edit' && dirty && (
        <div className="flex items-center gap-2">
          <Btn size="sm" loading={isSaving} onClick={onSave}>Save</Btn>
          <Btn size="sm" variant="ghost" onClick={onDiscard}>Discard</Btn>
        </div>
      )}
    </div>
  ),
}
