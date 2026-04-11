import FileViewer from '@modules/assets/frontend/components/handbook/FileViewer'
import type { AssetEditorPlugin } from './types'

export const fileViewerAssetEditor: AssetEditorPlugin = {
  id: 'file-viewer',
  label: 'File viewer',
  canHandle: () => true,
  canEdit: () => false,
  render: ({ file }) => (
    <div className="h-full min-h-[520px] overflow-hidden rounded-lg border border-gray-200 bg-white">
      <FileViewer path={file.path} file_type={file.file_type ?? 'other'} title={file.title} />
    </div>
  ),
}
