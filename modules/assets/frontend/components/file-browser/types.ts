/**
 * Shared types for the reusable file-browser shell.
 */
import type { UploadPreview } from "@modules/assets/frontend/api/knowledge"
import type { KnowledgeFile } from "@modules/assets/frontend/api/knowledge"

export type BrowserFile = KnowledgeFile & {
  entryKind?: 'knowledge' | 'workflow'
  sourceScope?: 'project' | 'knowledge'
  description?: string | null
  graphId?: string
}

export type RightPanel =
  | { kind: 'folder' }
  | { kind: 'file'; path: string }
  | { kind: 'knowledge-file'; path: string }
  | { kind: 'workflow'; graphId: string; path: string }
  | { kind: 'new-text'; folder: string }
  | { kind: 'new-presentation'; folder: string }
  | { kind: 'new-workflow'; folder: string }
  | { kind: 'new-folder'; parentPath: string }
  | { kind: 'upload'; preview: UploadPreview; folder: string }
  | { kind: 'video'; filename: string }
  | { kind: 'error'; message: string }
