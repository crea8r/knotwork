import type { AnyObj } from './types'

export function readEnv(name: string): string | undefined {
  try {
    const val = process.env[name]
    return val && val.trim() ? val.trim() : undefined
  } catch {
    return undefined
  }
}

export function pick(obj: AnyObj, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  }
  return undefined
}

export function getRequestPayload(ctx: AnyObj): AnyObj {
  const req = (ctx.request as AnyObj | undefined) || {}
  const payload =
    (req.payload as AnyObj | undefined) ||
    (req.params as AnyObj | undefined) ||
    (ctx.payload as AnyObj | undefined)
  return payload || {}
}

export function respond(ctx: AnyObj, ok: boolean, payload: AnyObj) {
  const fn = ctx.respond as ((status: boolean, data: AnyObj) => void) | undefined
  if (fn) fn(ok, payload)
}

export function toErrorMessage(err: unknown): string {
  return String((err as Error)?.message || err || 'unknown error')
}
