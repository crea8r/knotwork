import type { ReactNode } from 'react'

export interface AssetEditorFile {
  path: string
  title: string
  content: string
  file_type?: string
  is_editable?: boolean
}

export interface AssetEditorPluginContext {
  file: AssetEditorFile
  mode: 'view' | 'edit'
  content: string
  dirty: boolean
  isSaving: boolean
  onChange: (content: string) => void
  onSave: () => void
  onDiscard: () => void
}

export interface AssetEditorPlugin {
  id: string
  label: string
  canHandle: (file: AssetEditorFile) => boolean
  canEdit: (file: AssetEditorFile) => boolean
  render: (context: AssetEditorPluginContext) => ReactNode
}
