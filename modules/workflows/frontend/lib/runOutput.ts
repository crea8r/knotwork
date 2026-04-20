import type { Run } from '@data-models'

export function coerceRunOutputText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>
    for (const key of ['text', 'final_output', 'output', 'result']) {
      const candidate = src[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function getRunFinalOutput(run: Pick<Run, 'output'> | null | undefined): string | null {
  return coerceRunOutputText(run?.output)
}
