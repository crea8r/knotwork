function resolveApiBaseUrl(): string {
  if (typeof window === 'undefined') return 'server'
  const runtimeUrl = (window as unknown as { _env?: { API_URL?: string } })._env?.API_URL
  const raw =
    runtimeUrl && runtimeUrl !== 'RUNTIME_API_URL'
      ? runtimeUrl
      : import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
  return raw.replace(/\/$/, '')
}

function normalizeSegment(value: string, separator: string): string {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[:]/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, separator)
    .replace(new RegExp(`${separator}{2,}`, 'g'), separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, 'g'), '')
}

export function storageScopeLabel(): string {
  try {
    const url = new URL(resolveApiBaseUrl())
    const host = normalizeSegment(url.host, '_') || 'server'
    const path = normalizeSegment(url.pathname, '_')
    return path ? `${host}__${path}` : host
  } catch {
    return normalizeSegment(resolveApiBaseUrl(), '_') || 'server'
  }
}

export function namespacedStorageKey(name: string): string {
  return `knotwork.${storageScopeLabel()}.${name}`
}

export function readNamespacedStorage(name: string, legacyKeys: string[] = []): string | null {
  if (typeof window === 'undefined') return null
  const key = namespacedStorageKey(name)
  const current = window.localStorage.getItem(key)
  if (current !== null) return current

  for (const legacyKey of legacyKeys) {
    const legacyValue = window.localStorage.getItem(legacyKey)
    if (legacyValue !== null) {
      window.localStorage.setItem(key, legacyValue)
      window.localStorage.removeItem(legacyKey)
      return legacyValue
    }
  }

  return null
}

export function writeNamespacedStorage(name: string, value: string, legacyKeys: string[] = []): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(namespacedStorageKey(name), value)
  for (const legacyKey of legacyKeys) {
    window.localStorage.removeItem(legacyKey)
  }
}

export function removeNamespacedStorage(name: string, legacyKeys: string[] = []): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(namespacedStorageKey(name))
  for (const legacyKey of legacyKeys) {
    window.localStorage.removeItem(legacyKey)
  }
}
