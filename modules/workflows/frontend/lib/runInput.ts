function titleCaseKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\./g, ' / ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function formatScalar(value: unknown): string {
  if (value == null) return 'Not provided'
  if (typeof value === 'string') return value.trim() || 'Not provided'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatNested(value: unknown, depth = 0): string[] {
  const indent = '  '.repeat(depth)
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [`${indent}- ${formatScalar(value)}`]
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}- None`]
    if (value.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map((item) => `${indent}- ${formatScalar(item)}`)
    }
    return value.flatMap((item, index) => [
      `${indent}- Item ${index + 1}`,
      ...formatNested(item, depth + 1),
    ])
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
  if (entries.length === 0) return [`${indent}- None`]
  return entries.flatMap(([key, item]) => {
    if (item == null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      return [`${indent}- **${titleCaseKey(key)}:** ${formatScalar(item)}`]
    }
    return [
      `${indent}- **${titleCaseKey(key)}**`,
      ...formatNested(item, depth + 1),
    ]
  })
}

export function humanizeRunInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return 'No input was provided to the start node.'
  return entries.flatMap(([key, value]) => {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [`- **${titleCaseKey(key)}:** ${formatScalar(value)}`]
    }
    return [
      `- **${titleCaseKey(key)}**`,
      ...formatNested(value, 1),
    ]
  }).join('\n')
}
