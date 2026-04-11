import Btn from '@ui/components/Btn'
import MarkdownViewer from '@ui/components/MarkdownViewer'
import MarkdownWysiwygEditor from '@modules/assets/frontend/components/handbook/MarkdownWysiwygEditor'
import type { AssetEditorPlugin } from './types'

export const markdownAssetEditor: AssetEditorPlugin = {
  id: 'markdown',
  label: 'Markdown',
  canHandle: (file) => (file.file_type ?? 'md') === 'md' && file.is_editable !== false,
  canEdit: (file) => file.is_editable !== false,
  render: ({ file, mode, content, dirty, isSaving, onChange, onSave, onDiscard }) => {
    if (mode === 'view') {
      return (
        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <MarkdownViewer content={file.content} />
        </div>
      )
    }

    return (
      <>
        <MarkdownWysiwygEditor
          value={content}
          onChange={onChange}
        />
        {dirty && (
          <div className="flex items-center gap-2">
            <Btn size="sm" loading={isSaving} onClick={onSave}>Save</Btn>
            <Btn size="sm" variant="ghost" onClick={onDiscard}>
              Discard
            </Btn>
          </div>
        )}
      </>
    )
  },
}
