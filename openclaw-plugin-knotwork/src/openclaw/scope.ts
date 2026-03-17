// scope.ts — OpenClaw operator scope error detection.

import type { LooseRecord } from '../types'

const OPERATOR_SCOPES = ['operator.read', 'operator.write']

function collectErrorStrings(error: unknown, seen = new Set<unknown>()): string[] {
  if (error == null || seen.has(error)) return []
  if (typeof error === 'string') return [error]
  if (error instanceof Error) {
    seen.add(error)
    return [error.message, ...collectErrorStrings((error as Error & { cause?: unknown }).cause, seen)]
  }
  if (Array.isArray(error)) {
    seen.add(error)
    return error.flatMap((item) => collectErrorStrings(item, seen))
  }
  if (typeof error === 'object') {
    seen.add(error)
    const obj = error as LooseRecord
    const direct = [obj.message, obj.error, obj.reason, obj.details, obj.payload, obj.data, obj.cause, obj.meta]
    const scopes = Array.isArray(obj.missingScopes)
      ? obj.missingScopes
      : Array.isArray(obj.missing_scopes)
        ? obj.missing_scopes
        : []
    return [
      ...direct.flatMap((item) => collectErrorStrings(item, seen)),
      ...scopes.filter((item): item is string => typeof item === 'string'),
    ]
  }
  return [String(error)]
}

export function missingScope(error: unknown): string | null {
  for (const message of collectErrorStrings(error)) {
    const direct = message.trim()
    if (OPERATOR_SCOPES.includes(direct)) return direct
    const match = direct.match(/missing scope:\s*([A-Za-z0-9._-]+)/i)
    if (match?.[1]) return match[1]
  }
  return null
}

export function isOperatorScopeError(error: unknown): boolean {
  const scope = missingScope(error)
  return scope === 'operator.read' || scope === 'operator.write'
}

export function scopeHelp(scope: string): Error {
  return new Error(
    `OpenClaw gateway denied required scope '${scope}'. ` +
    `The Knotwork plugin requires operator.read and operator.write. ` +
    `Update the OpenClaw plugin installation/approval to grant those scopes, then restart OpenClaw and re-run handshake.`,
  )
}
