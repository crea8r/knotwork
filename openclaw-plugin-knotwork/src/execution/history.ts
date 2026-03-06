import type { AnyObj } from '../types'

export function extractLatestAssistantMessage(history: AnyObj): string {
  const messages = Array.isArray(history.messages) ? history.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (!m || typeof m !== 'object') continue
    const msg = m as AnyObj
    if (String(msg.role || '').toLowerCase() !== 'assistant') continue
    const content = msg.content
    if (typeof content === 'string' && content.trim()) return content
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const p of content) {
        if (!p || typeof p !== 'object') continue
        const part = p as AnyObj
        if (typeof part.text === 'string' && part.text.trim()) parts.push(part.text.trim())
      }
      const merged = parts.join('\n').trim()
      if (merged) return merged
    }
  }
  return ''
}

export function extractLastMessageRole(history: AnyObj): string {
  const messages = Array.isArray(history.messages) ? history.messages : []
  if (messages.length === 0) return ''
  const last = messages[messages.length - 1]
  if (!last || typeof last !== 'object') return ''
  return String((last as AnyObj).role || '').toLowerCase()
}

export function extractHistoryCount(history: AnyObj): number {
  const messages = Array.isArray(history.messages) ? history.messages : []
  return messages.length
}
