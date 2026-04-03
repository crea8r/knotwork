// persist.ts — State file read helpers.
// State is persisted to a single file: ~/.openclaw/knotwork-bridge-state.json
// (JWT token included — it is a bearer credential and expires in 30 days)

import { readFile } from 'node:fs/promises'
import type { RecentTask } from '../types'

export const MAX_RECENT_TASKS = 20

export type PersistedPluginState = {
  pluginInstanceId?: string
  jwt?: string
  jwtExpiresAt?: string | null
  guideVersion?: number | null
  lastAuthAt?: string
  lastAuthOk?: boolean
  lastError?: string | null
  lastTaskAt?: string | null
  runtimeLockPath?: string | null
  runtimeLeaseOwnerPid?: number | null
  recentTasks?: RecentTask[]
  // logs intentionally not persisted — each session starts fresh so knotwork.logs always shows current session
}

export async function readPersistedState(path: string): Promise<PersistedPluginState> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as PersistedPluginState
    return {
      pluginInstanceId: typeof parsed.pluginInstanceId === 'string' ? parsed.pluginInstanceId.trim() : undefined,
      jwt: typeof parsed.jwt === 'string' ? parsed.jwt.trim() : undefined,
      jwtExpiresAt: typeof parsed.jwtExpiresAt === 'string' ? parsed.jwtExpiresAt : null,
      guideVersion: typeof parsed.guideVersion === 'number' ? parsed.guideVersion : null,
      lastAuthAt: typeof parsed.lastAuthAt === 'string' ? parsed.lastAuthAt : undefined,
      lastAuthOk: typeof parsed.lastAuthOk === 'boolean' ? parsed.lastAuthOk : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      lastTaskAt: typeof parsed.lastTaskAt === 'string' ? parsed.lastTaskAt : null,
      runtimeLockPath: typeof parsed.runtimeLockPath === 'string' ? parsed.runtimeLockPath : null,
      runtimeLeaseOwnerPid: Number.isInteger(parsed.runtimeLeaseOwnerPid) ? parsed.runtimeLeaseOwnerPid : null,
      recentTasks: Array.isArray(parsed.recentTasks) ? parsed.recentTasks.slice(0, MAX_RECENT_TASKS) : [],
    }
  } catch {
    return {}
  }
}
