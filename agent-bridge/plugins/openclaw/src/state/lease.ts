// lease.ts — Runtime lease: ensures only one process runs the poll loop.
// Resilient heartbeat design: the lease holder renews a timestamp every RENEW_INTERVAL_MS.
// If the timestamp is older than LEASE_TTL_MS the lease is considered stale and stolen,
// even if the previous PID is still alive (e.g. after a gateway restart that recycled PIDs).
//
// Invariants:
//   RENEW_INTERVAL_MS < LEASE_TTL_MS / 2   (holder renews at least 2× per TTL window)
//   On graceful shutdown process.once('exit') deletes the file immediately.

import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { dirname } from 'node:path'

const PLUGIN_ID = 'knotwork-bridge'
// How long a lease is valid without a heartbeat renewal.
const LEASE_TTL_MS = 30_000
// How often the holder should call renewRuntimeLease().
export const LEASE_RENEW_INTERVAL_MS = 10_000
const LOCK_WRITE_GRACE_MS = 1_000

export type LeaseResult = { acquired: boolean; pid: number | null }

type LockData = { pid: number; acquired_at: string; renewed_at: string; plugin_id: string }

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function isStale(data: LockData): boolean {
  const renewedAt = new Date(data.renewed_at || data.acquired_at).getTime()
  return Date.now() - renewedAt > LEASE_TTL_MS
}

function makeLockData(): LockData {
  const now = new Date().toISOString()
  return { pid: process?.pid ?? 0, acquired_at: now, renewed_at: now, plugin_id: PLUGIN_ID }
}

export async function acquireRuntimeLease(
  lockPath: string, onAcquired: () => void,
): Promise<LeaseResult> {
  await mkdir(dirname(lockPath), { recursive: true })

  const tryAcquire = async (): Promise<LeaseResult> => {
    try {
      const handle = await open(lockPath, 'wx')
      const data = makeLockData()
      await handle.writeFile(JSON.stringify(data, null, 2))
      await handle.close()
      onAcquired()
      return { acquired: true, pid: data.pid }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/exist/i.test(msg)) return { acquired: false, pid: null }
      // Lock file exists — inspect it.
      try {
        const raw = await readFile(lockPath, 'utf8')
        const data = JSON.parse(raw) as LockData
        const lockedPid = Number(data.pid ?? 0)
        const isSelf = lockedPid === (process?.pid ?? -1)
        // Dead process: stale lock from a previous process that is no longer alive.
        const isDead = !isProcessAlive(lockedPid)
        // Heartbeat timeout: holder has stopped renewing (crashed or hung).
        const isHeartbeatStale = isStale(data)
        // If the same process hits activate() twice, treat the existing lease as still
        // owned rather than stealing it and starting duplicate poll loops.
        if (isSelf && !isHeartbeatStale) {
          return { acquired: false, pid: lockedPid || null }
        }
        if (isDead || isHeartbeatStale) {
          await rm(lockPath, { force: true })
          return tryAcquire()
        }
      } catch {
        // A freshly created lock file may still be in the middle of being written
        // by another activation. Treat it as busy unless it has been malformed for
        // longer than a short grace period.
        try {
          const info = await stat(lockPath)
          if (Date.now() - info.mtimeMs <= LOCK_WRITE_GRACE_MS) {
            return { acquired: false, pid: null }
          }
        } catch {
          return { acquired: false, pid: null }
        }
        await rm(lockPath, { force: true })
        return tryAcquire()
      }
      return { acquired: false, pid: null }
    }
  }

  return tryAcquire()
}

/** Call this periodically (every LEASE_RENEW_INTERVAL_MS) while holding the lease. */
export async function renewRuntimeLease(lockPath: string, isOwner: boolean): Promise<void> {
  if (!isOwner || !lockPath) return
  try {
    const raw = await readFile(lockPath, 'utf8')
    const data = JSON.parse(raw) as LockData
    data.renewed_at = new Date().toISOString()
    await writeFile(lockPath, JSON.stringify(data, null, 2))
  } catch { /* ignore — lease may have been stolen */ }
}

export async function releaseRuntimeLease(lockPath: string, isOwner: boolean): Promise<void> {
  if (!isOwner || !lockPath) return
  try { await rm(lockPath, { force: true }) } catch { /* ignore */ }
}

export function releaseRuntimeLeaseSync(lockPath: string, isOwner: boolean): void {
  if (!isOwner || !lockPath) return
  try { rmSync(lockPath, { force: true }) } catch { /* ignore */ }
}
