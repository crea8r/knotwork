import type { Graph } from '@data-models'
import { knowledgeWorkflowPath, projectAssetWorkflowPath } from '@app-shell/paths'
import { getGraphAssetPath, normalizeAssetPath } from './assetPath'

type WorkflowAssetLinkOptions = {
  assetChat?: boolean
}

export function workflowAssetLink(
  assetPath: string,
  projectSlug?: string | null,
  options: WorkflowAssetLinkOptions = {},
): string {
  const normalizedPath = normalizeAssetPath(assetPath)
  return projectSlug
    ? projectAssetWorkflowPath(projectSlug, normalizedPath, options)
    : knowledgeWorkflowPath(normalizedPath, options)
}

export function workflowAssetLinkForGraph(
  graph: Pick<Graph, 'asset_path' | 'path' | 'name' | 'project_slug'>,
  options: WorkflowAssetLinkOptions = {},
): string {
  return workflowAssetLink(getGraphAssetPath(graph), graph.project_slug, options)
}
