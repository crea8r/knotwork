import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const CLAIM_TTL_MS = 10 * 60_000

type ClaimData = {
  pid: number
  task_id: string
  delivery_id: string | null
  claimed_at: string
}

type RuntimeLockData = {
  acquired_at?: string
}

function sanitizeTaskId(taskId: string): string {
  return String(taskId).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readClaim(claimPath: string): Promise<ClaimData | null> {
  try {
    const raw = await readFile(claimPath, 'utf8')
    return JSON.parse(raw) as ClaimData
  } catch {
    return null
  }
}

async function claimFileAgeMs(claimPath: string): Promise<number | null> {
  try {
    const info = await stat(claimPath)
    return Date.now() - info.mtimeMs
  } catch {
    return null
  }
}

function claimPathFor(lockRoot: string, taskId: string): string {
  return join(join(dirname(lockRoot), 'task-claims'), `${sanitizeTaskId(taskId)}.json`)
}

function parseTimestamp(value: string | null | undefined): number | null {
  const parsed = new Date(String(value ?? '')).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

async function currentRuntimeStartedAtMs(lockRoot: string): Promise<number | null> {
  try {
    const raw = await readFile(lockRoot, 'utf8')
    const data = JSON.parse(raw) as RuntimeLockData
    return parseTimestamp(data.acquired_at)
  } catch {
    return null
  }
}

export async function claimTask(lockRoot: string, taskId: string, deliveryId?: string | null): Promise<boolean> {
  const claimsDir = join(dirname(lockRoot), 'task-claims')
  const claimPath = claimPathFor(lockRoot, taskId)
  await mkdir(claimsDir, { recursive: true })

  const tryClaim = async (): Promise<boolean> => {
    try {
      const handle = await open(claimPath, 'wx')
      const now = new Date().toISOString()
      const data: ClaimData = {
        pid: process?.pid ?? 0,
        task_id: taskId,
        delivery_id: deliveryId ?? null,
        claimed_at: now,
      }
      await handle.writeFile(JSON.stringify(data, null, 2))
      await handle.close()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/exist/i.test(message)) return false
      const existing = await readClaim(claimPath)
      const currentPid = process?.pid ?? 0
      const ownerPid = Number(existing?.pid ?? 0)

      if (existing) {
        const ownerIsCurrentProcess = ownerPid > 0 && ownerPid === currentPid
        const ownerIsAnotherLiveProcess =
          ownerPid > 0 &&
          ownerPid !== currentPid &&
          isProcessAlive(ownerPid)

        const claimedAtMs = parseTimestamp(existing.claimed_at)
        const runtimeStartedAtMs = ownerIsCurrentProcess ? await currentRuntimeStartedAtMs(lockRoot) : null
        const belongsToPreviousRuntime =
          ownerIsCurrentProcess &&
          claimedAtMs !== null &&
          runtimeStartedAtMs !== null &&
          claimedAtMs < runtimeStartedAtMs

        if (belongsToPreviousRuntime || (!ownerIsCurrentProcess && !ownerIsAnotherLiveProcess)) {
          await rm(claimPath, { force: true })
          return tryClaim()
        }
      }
      if (!existing) {
        const ageMs = await claimFileAgeMs(claimPath)
        if (ageMs !== null && ageMs > CLAIM_TTL_MS) {
          await rm(claimPath, { force: true })
          return tryClaim()
        }
      }
      return false
    }
  }

  return tryClaim()
}

export async function releaseTaskClaim(
  lockRoot: string,
  taskId: string,
  ownerPid: number = process?.pid ?? 0,
): Promise<void> {
  if (!lockRoot) return
  const claimPath = claimPathFor(lockRoot, taskId)
  const existing = await readClaim(claimPath)
  if (existing) {
    const existingPid = Number(existing.pid ?? 0)
    if (existingPid > 0 && existingPid !== ownerPid) return
  }
  await rm(claimPath, { force: true })
}
