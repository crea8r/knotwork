import type { AnyObj } from '../types'
import { pick } from '../utils'

export function extractOutputText(resp: AnyObj): string {
  const direct =
    pick(resp, ['output_text', 'text', 'message']) ||
    pick((resp.output as AnyObj) || {}, ['text', 'output_text'])
  if (typeof direct === 'string' && direct.trim()) return direct

  const arr = (resp.output as unknown[]) || (resp.items as unknown[]) || []
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const obj = item as AnyObj
      const t = pick(obj, ['text', 'output_text'])
      if (typeof t === 'string' && t.trim()) return t
      const content = obj.content as unknown[]
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== 'object') continue
          const p = part as AnyObj
          const pt = pick(p, ['text'])
          if (typeof pt === 'string' && pt.trim()) return pt
        }
      }
    }
  }
  return JSON.stringify(resp)
}

export function normalizeExecutionResult(raw: unknown): AnyObj {
  if (typeof raw === 'string') {
    return { type: 'completed', output: raw }
  }

  if (!raw || typeof raw !== 'object') {
    return { type: 'completed', output: JSON.stringify(raw) }
  }

  const r = raw as AnyObj

  if (r.type === 'escalation' || r.needs_human === true) {
    return {
      type: 'escalation',
      question: String(pick(r, ['question', 'message']) || 'Need human input'),
      options: (pick(r, ['options']) as string[] | undefined) || [],
    }
  }

  if (r.type === 'failed' || r.error) {
    return {
      type: 'failed',
      error: String(pick(r, ['error', 'message']) || 'execution failed'),
    }
  }

  return {
    type: 'completed',
    output: String(pick(r, ['output', 'text', 'message']) || JSON.stringify(r)),
    next_branch: (pick(r, ['next_branch', 'nextBranch']) as string | undefined) || null,
  }
}
