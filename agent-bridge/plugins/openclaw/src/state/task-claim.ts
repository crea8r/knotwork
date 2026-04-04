import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const CLAIM_TTL_MS = 10 * 60_000

type ClaimData = {
  pid: number
  task_id: string
  delivery_id: string | null
  claimed_at: string
}

function sanitizeTaskId(taskId: string): string {
  return String(taskId).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function isStale(data: ClaimData): boolean {
  const claimedAt = new Date(data.claimed_at).getTime()
  return !Number.isFinite(claimedAt) || Date.now() - claimedAt > CLAIM_TTL_MS
}

async function readClaim(claimPath: string): Promise<ClaimData | null> {
  try {
    const raw = await readFile(claimPath, 'utf8')
    return JSON.parse(raw) as ClaimData
  } catch {
    return null
  }
}

export async function claimTask(lockRoot: string, taskId: string, deliveryId?: string | null): Promise<boolean> {
  const claimsDir = join(dirname(lockRoot), 'task-claims')
  const claimPath = join(claimsDir, `${sanitizeTaskId(taskId)}.json`)
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
      if (existing && isStale(existing)) {
        await rm(claimPath, { force: true })
        return tryClaim()
      }
      return false
    }
  }

  return tryClaim()
}
