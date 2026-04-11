import { fileViewerAssetEditor } from './FileViewerAssetEditor'
import { markdownAssetEditor } from './MarkdownAssetEditor'
import { presentationAssetEditor } from './PresentationAssetEditor'
import type { AssetEditorFile, AssetEditorPlugin } from './types'

export const assetEditorPlugins: AssetEditorPlugin[] = [
  presentationAssetEditor,
  markdownAssetEditor,
  fileViewerAssetEditor,
]

export function getAssetEditorPlugin(file: AssetEditorFile): AssetEditorPlugin {
  return assetEditorPlugins.find((plugin) => plugin.canHandle(file)) ?? fileViewerAssetEditor
}
