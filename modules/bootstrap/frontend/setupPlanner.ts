export type InstallMode = 'dev' | 'prod'
export type CleanupMode = 'runtime' | 'full'

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function isValidDomain(value: string) {
  const trimmed = value.trim()
  if (trimmed === 'localhost') return true
  if (!trimmed || trimmed.length > 253) return false
  if (trimmed.startsWith('.') || trimmed.endsWith('.')) return false
  if (trimmed.includes('..')) return false
  if (!/^[A-Za-z0-9.-]+$/.test(trimmed)) return false

  const labels = trimmed.split('.')
  if (labels.length < 2) return false
  if (!/^[A-Za-z][A-Za-z0-9-]{1,62}$/.test(labels[labels.length - 1])) return false

  return labels.every((label) => {
    if (!label || label.length > 63) return false
    return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
  })
}

export function isValidPort(value: string) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

export function buildInstallPreflight(isPublic: boolean) {
  const items = [
    'Docker is installed and the daemon is running.',
    'Docker Compose plugin is available as `docker compose`.',
    'The repository root is writable because the scripts create `.env`, runtime data, and install metadata there.',
  ]
  if (isPublic) {
    items.push('`nginx` is installed on the host.')
    items.push('`certbot` is installed on the host.')
    items.push('Ports 80 and 443 are available for nginx/TLS.')
    items.push('Public DNS already points the chosen domain at this machine.')
  }
  return items
}
