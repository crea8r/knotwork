import { fileViewerAssetEditor } from './FileViewerAssetEditor'
import { markdownAssetEditor } from './MarkdownAssetEditor'
import type { AssetEditorFile, AssetEditorPlugin } from './types'

export const assetEditorPlugins: AssetEditorPlugin[] = [
  markdownAssetEditor,
  fileViewerAssetEditor,
]

export function getAssetEditorPlugin(file: AssetEditorFile): AssetEditorPlugin {
  return assetEditorPlugins.find((plugin) => plugin.canHandle(file)) ?? fileViewerAssetEditor
}
