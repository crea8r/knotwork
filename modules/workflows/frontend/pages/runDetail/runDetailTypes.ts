export type ChatRole = 'assistant' | 'user' | 'system'

export type RequestResponseSchema = {
  resolution_options?: string[]
  supports_guidance?: boolean
  supports_answers?: boolean
  supports_override_output?: boolean
  supports_next_branch?: boolean
}

export type RequestTargetRole = 'operator' | 'supervisor' | 'participant'

export type RequestPayload = {
  type?: string
  status?: string
  questions?: string[]
  context_markdown?: string
  assigned_to?: string[]
  options?: string[]
  escalation_id?: string
  timeout_at?: string
  target_role?: RequestTargetRole
  response_schema?: RequestResponseSchema
}

export type ChatItem = {
  id: string
  role: ChatRole
  kind?: 'message' | 'decision_confident' | 'request' | 'loading'
  speaker: string
  speakerAgentId?: string
  nodeId?: string
  nodeName?: string
  text: string
  preText?: string
  markdown?: boolean
  raw: unknown
  ts?: string | null
  answerDurationMs?: number | null
  requestMessageId?: string
  request?: RequestPayload
}

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?(#.*)?$/i

export type ExtractedImage = { src: string; inlineSvg: boolean }

export function normalizeCandidateUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?]+$/, '')
}

export function isImageSource(url: string): boolean {
  if (!url) return false
  if (/^data:image\//i.test(url)) return true
  return IMAGE_EXT_RE.test(url)
}

export function extractImageSources(text: string): ExtractedImage[] {
  const found = new Map<string, ExtractedImage>()

  const mdImageRe = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of text.matchAll(mdImageRe)) {
    const url = normalizeCandidateUrl(match[1] ?? '')
    if (isImageSource(url)) found.set(url, { src: url, inlineSvg: false })
  }

  const mdLinkRe = /\[[^\]]+]\((https?:\/\/[^)\s]+)\)/g
  for (const match of text.matchAll(mdLinkRe)) {
    const url = normalizeCandidateUrl(match[1] ?? '')
    if (isImageSource(url)) found.set(url, { src: url, inlineSvg: false })
  }

  const plainUrlRe = /(https?:\/\/[^\s<>"')\]]+)/g
  for (const match of text.matchAll(plainUrlRe)) {
    const url = normalizeCandidateUrl(match[1] ?? '')
    if (isImageSource(url)) found.set(url, { src: url, inlineSvg: false })
  }

  const svgBlocks = text.match(/<svg[\s\S]*?<\/svg>/gi) ?? []
  for (const svg of svgBlocks) {
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
    found.set(src, { src, inlineSvg: true })
  }

  return Array.from(found.values()).slice(0, 6)
}

export function stripInlineSvg(text: string): string {
  return text.replace(/<svg[\s\S]*?<\/svg>/gi, '').trim()
}

export function hashString(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) - h + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function friendlyProgressText(messageId: string, progress: string, phrases: string[]): string {
  const phrase = phrases[hashString(messageId) % phrases.length] ?? 'Agent is working…'
  const clean = progress.trim()
  if (!clean) return phrase
  return `${phrase} • ${clean}`
}

export const THINKING_PREFIXES = [
  'Checking context',
  'Reviewing prior steps',
  'Mapping the workflow path',
  'Validating assumptions',
  'Comparing alternatives',
  'Synthesizing evidence',
  'Refining the response',
  'Verifying constraints',
  'Cross-checking details',
  'Preparing the final output',
]

export const THINKING_ACTIONS = [
  'to avoid missing edge cases',
  'to keep the result consistent',
  'to improve answer quality',
  'to keep the run aligned',
  'to reduce rework later',
  'to catch conflicts early',
  'to make the next step clear',
  'to keep decisions traceable',
  'to ensure clean handoff',
  'to maintain reliable output',
]

export function buildThinkingPhrases(): string[] {
  const phrases: string[] = []
  for (const prefix of THINKING_PREFIXES) {
    for (const action of THINKING_ACTIONS) {
      phrases.push(`${prefix} ${action}…`)
    }
  }
  return phrases
}

export function pickRandomPhrase(phrases: string[], previous?: string): string {
  if (phrases.length === 0) return 'Agent is working…'
  if (phrases.length === 1) return phrases[0]
  let next = phrases[Math.floor(Math.random() * phrases.length)]
  while (next === previous) next = phrases[Math.floor(Math.random() * phrases.length)]
  return next
}

export function isHeartbeatProgress(text: string): boolean {
  return /(heartbeat|still working|still running)/i.test(text)
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
