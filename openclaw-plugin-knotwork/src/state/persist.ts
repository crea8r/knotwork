// persist.ts — State file read helpers.
//
// Two separate files:
//   ~/.openclaw/knotwork-bridge-state.json          — pluginInstanceId + history (persists across reinstall)
//   ~/.openclaw/extensions/knotwork-bridge/credentials.json — integrationSecret only (auto-cleaned on uninstall)

import { readFile } from 'node:fs/promises'
import type { RecentTask } from '../types'

export const MAX_RECENT_TASKS = 20

export type PersistedPluginState = {
  pluginInstanceId?: string
  lastHandshakeAt?: string
  lastHandshakeOk?: boolean
  lastError?: string | null
  lastTaskAt?: string | null
  runtimeLockPath?: string | null
  runtimeLeaseOwnerPid?: number | null
  recentTasks?: RecentTask[]
  logs?: string[]
}

export type PersistedCredentials = {
  integrationSecret?: string
}

export async function readPersistedState(path: string): Promise<PersistedPluginState> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as PersistedPluginState
    return {
      pluginInstanceId: typeof parsed.pluginInstanceId === 'string' ? parsed.pluginInstanceId.trim() : undefined,
      lastHandshakeAt: typeof parsed.lastHandshakeAt === 'string' ? parsed.lastHandshakeAt : undefined,
      lastHandshakeOk: typeof parsed.lastHandshakeOk === 'boolean' ? parsed.lastHandshakeOk : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      lastTaskAt: typeof parsed.lastTaskAt === 'string' ? parsed.lastTaskAt : null,
      runtimeLockPath: typeof parsed.runtimeLockPath === 'string' ? parsed.runtimeLockPath : null,
      runtimeLeaseOwnerPid: Number.isInteger(parsed.runtimeLeaseOwnerPid) ? parsed.runtimeLeaseOwnerPid : null,
      recentTasks: Array.isArray(parsed.recentTasks) ? parsed.recentTasks.slice(0, MAX_RECENT_TASKS) : [],
      logs: Array.isArray(parsed.logs)
        ? parsed.logs.slice(-200).filter((line): line is string => typeof line === 'string')
        : [],
    }
  } catch {
    return {}
  }
}

export async function readPersistedCredentials(path: string): Promise<PersistedCredentials> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as PersistedCredentials
    return {
      integrationSecret: typeof parsed.integrationSecret === 'string' ? parsed.integrationSecret.trim() : undefined,
    }
  } catch {
    return {}
  }
}
