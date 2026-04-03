// spawn.ts — Gateway subprocess spawn: retry logic, backoff, output capture.
//
// Two distinct gateway-unavailable modes:
//   Saturation  — activeSpawns >= maxConcurrent: gateway busy with long-lived sessions.
//                 Retry every SATURATION_RETRY_MS, unlimited attempts. Will resolve when a session ends.
//   Unavailable — activeSpawns < maxConcurrent but still can't connect: gateway genuinely down.
//                 Exponential backoff, give up after maxGatewayAttempts.

import { spawn } from 'node:child_process'
import { addRunningTask, removeRunningTask, upsertRecentTask } from './worker'
import type { TaskLogger } from '../state/tasklog'
import type { ExecutionTask, OpenClawApi, PluginState, RecentTask, RunningTaskInfo } from '../types'

const GATEWAY_CONN_PATTERNS = [
  /cannot connect/i, /econnrefused/i, /gateway not available/i,
  /connection refused/i, /Error: gateway closed \(1000 normal closure\): no close reason/,
  /gateway timeout after 10000ms/
]
export const SATURATION_RETRY_MS = 15_000
const GATEWAY_CALL_TIMEOUT_MS = 20 * 60 * 1000

export function isGatewayConnectionError(exitCode: number | null, output: string): boolean {
  if (exitCode === 0) return false
  return GATEWAY_CONN_PATTERNS.some((p) => p.test(output))
}

export function backoffDelay(attempt: number): number {
  const base = Math.min(60_000, 2_000 * Math.pow(2, attempt))
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.round(base + jitter)
}

export type SpawnDeps = {
  state: PluginState
  log: (msg: string) => void
  api: OpenClawApi
  activeSpawns: Map<string, { startedAt: string }>
  taskLog: TaskLogger
  persistSnapshot?: () => Promise<void>
  maxConcurrent: number
  maxGatewayAttempts: number   // max genuine-unavailable retries before giving up
  saturationRetryMs: number    // interval between saturation retries (ms)
  jwt: string
  workspaceId: string
  knotworkUrl: string
  taskLogPath: string
}

function extractGatewayPayload(output: string): { ok?: boolean; recentTask?: RecentTask | null } | null {
  const gatewayMarker = output.lastIndexOf('Gateway call:')
  const start = output.indexOf('{', gatewayMarker >= 0 ? gatewayMarker : 0)
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(output.slice(start, end + 1)) as { ok?: boolean; recentTask?: RecentTask | null }
  } catch {
    return null
  }
}

export function spawnExecuteTask(deps: SpawnDeps, task: ExecutionTask, spawnContext: 'poll' | 'rpc'): void {
  const { state, log, activeSpawns, taskLog, persistSnapshot, maxConcurrent, maxGatewayAttempts, saturationRetryMs, jwt, workspaceId, knotworkUrl, taskLogPath } = deps
  const taskId = String(task.task_id)
  if (activeSpawns.has(taskId)) {
    log(`spawn:dedupe-skip id=${taskId} context=${spawnContext} reason=already_active`)
    taskLog('spawn:dedupe-skip', taskId, { context: spawnContext, reason: 'already_active' })
    return
  }
  const startedAt = new Date().toISOString()
  const pluginInstanceId = state.pluginInstanceId ?? ''
  addRunningTask(state, {
    taskId,
    nodeId: task.node_id ? String(task.node_id) : null,
    runId: task.run_id ? String(task.run_id) : null,
    sessionName: task.session_name ? String(task.session_name) : null,
    startedAt, spawnContext,
  } as RunningTaskInfo)
  activeSpawns.set(taskId, { startedAt })
  log(`spawn:start id=${taskId} context=${spawnContext} concurrent=${activeSpawns.size}`)

  // genuineAttempt counts only non-saturation retries toward the give-up budget.
  let genuineAttempt = 0
  let saturationAttempt = 0

  const trySpawn = (retryReason?: string, retryDelayMs?: number): void => {
    const attempt = genuineAttempt + saturationAttempt
    if (retryReason !== undefined) {
      log(`subagent:retry attempt=${attempt} delay=${retryDelayMs ?? 0}ms reason=${retryReason}`)
    }
    const subprocessParams = { task, pluginInstanceId, jwt, workspaceId, knotworkUrl, taskLogPath }
    const buf: Buffer[] = []
    const p = spawn('openclaw', [
      'gateway', 'call', 'knotwork.execute_task',
      '--timeout', String(GATEWAY_CALL_TIMEOUT_MS),
      '--params', JSON.stringify(subprocessParams),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    log(`subagent:spawned attempt=${attempt} id=${taskId} pid=${p.pid ?? 'unknown'}`)
    taskLog('subagent:spawned', taskId, { pid: String(p.pid ?? 'unknown'), context: spawnContext, attempt: String(attempt) })
    p.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) taskLog('subagent:stdout', taskId, { msg: msg.slice(0, 500) })
      buf.push(d)
    })
    p.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) taskLog('subagent:stderr', taskId, { msg: msg.slice(0, 500) })
      buf.push(d)
    })

    p.on('close', (code) => {
      const output = Buffer.concat(buf).toString().trim()

      if (isGatewayConnectionError(code, output)) {
        const saturated = activeSpawns.size >= maxConcurrent
        if (saturated) {
          // Gateway busy with long-lived sessions — wait and retry indefinitely.
          saturationAttempt += 1
          taskLog('spawn:retry-saturation', taskId, { saturationAttempt: String(saturationAttempt), activeSpawns: String(activeSpawns.size), maxConcurrent: String(maxConcurrent), retryInMs: String(saturationRetryMs) })
          log(`spawn:saturation id=${taskId} saturationAttempt=${saturationAttempt} activeSpawns=${activeSpawns.size}/${maxConcurrent} retryIn=${saturationRetryMs}ms`)
          setTimeout(() => trySpawn('saturation', saturationRetryMs), saturationRetryMs)
        } else {
          // Gateway genuinely unavailable — count against budget.
          genuineAttempt += 1
          const delay = backoffDelay(genuineAttempt)
          taskLog('spawn:retry-unavailable', taskId, { genuineAttempt: String(genuineAttempt), maxAttempts: String(maxGatewayAttempts), retryInMs: String(delay) })
          log(`spawn:gateway-unavailable id=${taskId} genuineAttempt=${genuineAttempt}/${maxGatewayAttempts} retryIn=${delay}ms`)
          if (genuineAttempt >= maxGatewayAttempts) {
            taskLog('spawn:give-up', taskId, { reason: 'max_genuine_attempts', genuineAttempt: String(genuineAttempt), saturationAttempt: String(saturationAttempt) })
            log(`spawn:gateway-retry-exhausted id=${taskId} genuineAttempts=${genuineAttempt} saturationAttempts=${saturationAttempt}`)
            activeSpawns.delete(taskId)
            removeRunningTask(state, taskId)
            return
          }
          setTimeout(() => trySpawn('gateway_unavailable', delay), delay)
        }
        return
      }

      // Normal close (success or non-gateway error).
      activeSpawns.delete(taskId)
      removeRunningTask(state, taskId)
      taskLog('subagent:released', taskId, { code: String(code ?? 'null'), genuineAttempt: String(genuineAttempt), saturationAttempt: String(saturationAttempt) })
      if (code !== 0) {
        const snippet = output ? ` output=${output.slice(0, 1200)}` : ' output=(empty)'
        log(`spawn:exit-nonzero id=${taskId} code=${code}${snippet}`)
      } else {
        const payload = extractGatewayPayload(output)
        if (payload?.ok && payload.recentTask) {
          upsertRecentTask(state, () => { void persistSnapshot?.() }, payload.recentTask)
        }
        if (output) log(`spawn:output id=${taskId} ${output.slice(0, 600)}`)
        log(`spawn:done id=${taskId} concurrent=${activeSpawns.size}`)
      }
    })

    p.on('error', (e: Error) => {
      log(`spawn:error id=${taskId} ${e.message}`)
      activeSpawns.delete(taskId)
      removeRunningTask(state, taskId)
      taskLog('subagent:killed', taskId, { error: e.message.slice(0, 200) })
    })
  }

  trySpawn()
}
