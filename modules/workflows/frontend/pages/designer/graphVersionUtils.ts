import type { GraphVersion, Run } from '@data-models'
import { isDraftRun } from '@data-models'
import type { NodeType } from '@data-models'

export const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: 'agent', label: 'Agent' },
]

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error'
export type WorkflowTab = 'graph' | 'history' | 'usage'
export type HistorySelection =
  | { kind: 'root-draft'; id: string }
  | { kind: 'version'; id: string }
  | { kind: 'draft'; id: string; parentVersionId: string | null }

export function formatVersionName(version: GraphVersion | null | undefined): string {
  if (!version) return 'root draft'
  if (version.version_name) return version.version_name
  if (version.version_id) return version.version_id
  return 'draft'
}

export function formatVersionStamp(iso: string | null | undefined): string {
  if (!iso) return 'just now'
  return new Date(iso).toLocaleString()
}

export function compareUpdatedDesc(a: GraphVersion, b: GraphVersion): number {
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
}

export function compareRunsDesc(a: Run, b: Run): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

export function formatRunVersionLabel(run: Run, versionNameById: Map<string, string>): string {
  if (isDraftRun(run) || run.graph_version_id === null) {
    if (run.draft_parent_version_id) {
      return `Draft from ${versionNameById.get(run.draft_parent_version_id) ?? 'version'}`
    }
    return 'Draft'
  }
  return versionNameById.get(run.graph_version_id) ?? run.graph_version_id
}

export function getRunSearchText(run: Run): string {
  return [
    run.id,
    run.name,
    run.status,
    run.output_summary,
    run.error,
    JSON.stringify(run.input ?? {}),
    JSON.stringify(run.output ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
