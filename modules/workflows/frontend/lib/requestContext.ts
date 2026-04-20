export type RequestTargetRole = 'operator' | 'supervisor' | 'participant'

export interface RequestContextEntry {
  path: string
  content: string
}

export interface RequestContextSection {
  title: string
  content: string
}

export interface ParsedRequestContext {
  raw: string
  taskBrief: string
  previewText: string
  handbookEntries: RequestContextEntry[]
  missingHandbookFiles: string[]
  extraSections: RequestContextSection[]
}

function splitByHeading(markdown: string, headingPattern: RegExp): Array<{ heading: string | null; content: string }> {
  const sections: Array<{ heading: string | null; content: string }> = []
  let currentHeading: string | null = null
  let currentLines: string[] = []

  const flush = () => {
    const content = currentLines.join('\n').trim()
    if (currentHeading !== null || content) sections.push({ heading: currentHeading, content })
    currentLines = []
  }

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(headingPattern)
    if (match) {
      flush()
      currentHeading = match[1]?.trim() || null
      continue
    }
    currentLines.push(line)
  }

  flush()
  return sections
}

function isLikelyHandbookPath(value: string): boolean {
  const heading = value.trim()
  return /(^|\/)[^/\s]+\.(md|markdown|txt|json|ya?ml)$/i.test(heading)
}

function parseHandbookEntries(markdown: string): RequestContextEntry[] {
  const entries: RequestContextEntry[] = []
  let currentPath: string | null = null
  let currentLines: string[] = []

  const flush = () => {
    const content = currentLines.join('\n').trim()
    if (currentPath && content) entries.push({ path: currentPath, content })
    currentLines = []
  }

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^###\s+(.+?)\s*$/)
    const heading = match?.[1]?.trim() ?? null
    if (heading && isLikelyHandbookPath(heading)) {
      flush()
      currentPath = heading
      continue
    }
    currentLines.push(line)
  }

  flush()
  return entries
}

function parseMissingFiles(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseRequestContext(markdown?: string | null): ParsedRequestContext {
  const raw = typeof markdown === 'string' ? markdown.trim() : ''
  if (!raw) {
    return {
      raw: '',
      taskBrief: '',
      previewText: '',
      handbookEntries: [],
      missingHandbookFiles: [],
      extraSections: [],
    }
  }

  const sections = splitByHeading(raw, /^##\s+(.+?)\s*$/)
  const intro = sections.find((section) => section.heading === null)?.content.trim() ?? ''
  const handbookSection = sections.find((section) => section.heading?.toLowerCase() === 'handbook context')
  const missingSection = sections.find((section) => section.heading?.toLowerCase() === 'missing handbook files')
  const extraSections = sections
    .filter((section) => {
      const heading = section.heading?.toLowerCase()
      return !!section.heading && heading !== 'handbook context' && heading !== 'missing handbook files'
    })
    .map((section) => ({
      title: section.heading ?? 'Context',
      content: section.content.trim(),
    }))
    .filter((section) => !!section.content)

  const taskBrief = intro || extraSections[0]?.content || raw

  return {
    raw,
    taskBrief,
    previewText: stripMarkdown(taskBrief || raw),
    handbookEntries: handbookSection ? parseHandbookEntries(handbookSection.content) : [],
    missingHandbookFiles: missingSection ? parseMissingFiles(missingSection.content) : [],
    extraSections,
  }
}

export function getRequestTargetRoleLabel(role?: RequestTargetRole | null): string {
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'participant') return 'Participant'
  return 'Operator'
}
