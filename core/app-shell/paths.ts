type AssetUrlOptions = {
  assetChat?: boolean
}

function buildAssetSearch(name: 'path' | 'folder', value: string, options: AssetUrlOptions = {}) {
  const params = new URLSearchParams()
  params.set(name, value)
  if (options.assetChat) params.set('assetChat', '1')
  return params.toString()
}

export function projectPath(projectSlug: string) {
  return `/projects/${projectSlug}`
}

export function projectAssetsPath(projectSlug: string) {
  return `/projects/${projectSlug}/assets`
}

export function projectAssetFilePath(projectSlug: string, path: string, options: AssetUrlOptions = {}) {
  return `${projectAssetsPath(projectSlug)}?${buildAssetSearch('path', path, options)}`
}

export function projectAssetFolderPath(projectSlug: string, folder = '', options: AssetUrlOptions = {}) {
  return `${projectAssetsPath(projectSlug)}?${buildAssetSearch('folder', folder, options)}`
}

export function projectAssetWorkflowPath(projectSlug: string, path: string, options: AssetUrlOptions = {}) {
  return `${projectAssetsPath(projectSlug)}?${buildAssetSearch('path', path, options)}`
}

export function projectObjectivePath(projectSlug: string, objectiveSlug: string) {
  return `/projects/${projectSlug}/objectives/${objectiveSlug}`
}

export function projectChannelPath(projectSlug: string, channelSlug: string) {
  return `/projects/${projectSlug}/channels/${channelSlug}`
}

export function channelPath(channelSlug: string) {
  return `/channels/${channelSlug}`
}

export function knowledgeFilePath(path: string, options: AssetUrlOptions = {}) {
  return `/knowledge?${buildAssetSearch('path', path, options)}`
}

export function knowledgeFolderPath(folder = '', options: AssetUrlOptions = {}) {
  return `/knowledge?${buildAssetSearch('folder', folder, options)}`
}

export function knowledgeWorkflowPath(path: string, options: AssetUrlOptions = {}) {
  return `/knowledge?${buildAssetSearch('path', path, options)}`
}
