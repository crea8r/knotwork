export function projectPath(projectSlug: string) {
  return `/projects/${projectSlug}`
}

export function projectAssetsPath(projectSlug: string) {
  return `/projects/${projectSlug}/assets`
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
