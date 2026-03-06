import type { AnyObj } from './types'

export async function postJson(
  url: string,
  body: AnyObj,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: AnyObj | null; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: AnyObj | null = null
  try {
    data = text ? (JSON.parse(text) as AnyObj) : null
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data, text }
}
