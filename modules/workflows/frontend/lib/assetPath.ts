import type { Graph } from '@data-models'

export function normalizeAssetPath(path: string | null | undefined): string {
  return String(path ?? '')
    .split('/')
    .filter(Boolean)
    .join('/')
}

export function getGraphAssetPath(graph: Pick<Graph, 'name' | 'path' | 'asset_path'>): string {
  return normalizeAssetPath(graph.asset_path || [graph.path, graph.name].filter(Boolean).join('/'))
}

export function getAssetParentFolder(assetPath: string): string {
  const normalizedPath = normalizeAssetPath(assetPath)
  return normalizedPath.split('/').slice(0, -1).join('/')
}

export function findGraphByAssetPath<T extends Pick<Graph, 'name' | 'path' | 'asset_path'>>(
  graphs: T[],
  assetPath: string | null | undefined,
): T | null {
  const normalizedPath = normalizeAssetPath(assetPath)
  if (!normalizedPath) return null
  return graphs.find((graph) => getGraphAssetPath(graph) === normalizedPath) ?? null
}
