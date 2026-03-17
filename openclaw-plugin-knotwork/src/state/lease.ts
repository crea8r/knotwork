// lease.ts — Runtime lease: ensures only one process runs the poll loop.
// File lock at ~/.openclaw/knotwork-bridge-runtime.lock.
// If the lock file exists but its pid is dead, it is stolen.

import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { dirname } from 'node:path'

const PLUGIN_ID = 'knotwork-bridge'

export type LeaseResult = { acquired: boolean; pid: number | null }

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

export async function acquireRuntimeLease(
  lockPath: string, onAcquired: () => void,
): Promise<LeaseResult> {
  await mkdir(dirname(lockPath), { recursive: true })

  const tryAcquire = async (): Promise<LeaseResult> => {
    try {
      const handle = await open(lockPath, 'wx')
      const pid = process?.pid ?? null
      await handle.writeFile(JSON.stringify(
        { pid, acquired_at: new Date().toISOString(), plugin_id: PLUGIN_ID }, null, 2,
      ))
      await handle.close()
      onAcquired()
      return { acquired: true, pid }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/exist/i.test(msg)) return { acquired: false, pid: null }
      try {
        const raw = await readFile(lockPath, 'utf8')
        const parsed = JSON.parse(raw) as { pid?: number }
        if (!isProcessAlive(Number(parsed.pid ?? 0))) {
          await rm(lockPath, { force: true })
          return tryAcquire()
        }
      } catch {
        await rm(lockPath, { force: true })
        return tryAcquire()
      }
      return { acquired: false, pid: null }
    }
  }

  return tryAcquire()
}

export async function releaseRuntimeLease(lockPath: string, isOwner: boolean): Promise<void> {
  if (!isOwner || !lockPath) return
  try { await rm(lockPath, { force: true }) } catch { /* ignore */ }
}

export function releaseRuntimeLeaseSync(lockPath: string, isOwner: boolean): void {
  if (!isOwner || !lockPath) return
  try { rmSync(lockPath, { force: true }) } catch { /* ignore */ }
}
