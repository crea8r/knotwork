// plugin.ts — OpenClaw plugin entry point.
// Debug: openclaw gateway call knotwork.status | knotwork.logs | knotwork.auth | knotwork.execute_task
// All log lines also written to stdout → `docker logs <container> | grep knotwork-bridge`

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getConfig, getGatewayConfig, getSemanticSessionsDir, getSemanticTaskLogPath } from './openclaw/bridge'
import { runAuth, recoverAuth as _recoverAuth } from './lifecycle/auth'
import type { TimerRef } from './lifecycle/auth'
import { pollAndRun as _pollAndRun, runClaimedTask as _runClaimedTask } from './lifecycle/worker'
import { registerRpcMethods } from './lifecycle/rpc'
import { detectActivationContext, startHydration } from './lifecycle/startup'
import { startTimers } from './lifecycle/timers'
import { SATURATION_RETRY_MS } from './lifecycle/spawn'
import { createTaskLogger } from './state/tasklog'
import type { ActiveSpawnInfo, ExecutionTask, OpenClawApi, PluginState } from './types'

const PLUGIN_ID = 'knotwork-bridge'
const STATE_FILE = 'knotwork-bridge-state.json'
const RUNTIME_LOCK_FILE = 'runtime.lock'
export function activate(api: OpenClawApi): void {
  const cfg = getConfig(api)
  const debugEnabled = Boolean(cfg.semanticProtocolDebug)
  const activationContext = detectActivationContext()
  const pid = process?.pid ?? null
  const startupTaskLog = createTaskLogger(getSemanticTaskLogPath(cfg), debugEnabled)
  const apiKeys = Object.keys((api ?? {}) as object).join(',')
  const hasRegisterGatewayMethod = typeof api?.registerGatewayMethod === 'function'
  const hasSubagentRun = typeof (api as any)?.runtime?.subagent?.run === 'function'
  const argv = Array.isArray(process?.argv) ? process.argv.map((part) => String(part)) : []

  function startupLog(phase: string, extra?: Record<string, string>): void {
    startupTaskLog(`startup:${phase}`, 'system', {
      context: activationContext,
      pid: String(pid ?? 'unknown'),
      hasRegisterGatewayMethod: String(hasRegisterGatewayMethod),
      hasSubagentRun: String(hasSubagentRun),
      // apiKeys,
      argv: argv.join(' '),
      ...(extra ?? {}),
    })
  }

  // For CLI gateway calls (subprocess invocation), register RPC methods with a
  // minimal context — credentials come in via SubprocessParams, not persisted state.
  if (activationContext === 'cli_gateway_call') {
    if (debugEnabled) {
      console.log(`[${PLUGIN_ID}] activate() cli_gateway_call pid=${pid ?? 'unknown'} — registering RPC methods only`)
    }
    const logs: string[] = []
    function log(msg: string): void {
      if (!debugEnabled) return
      const line = `${new Date().toISOString()} ${msg}`
      logs.push(line)
      console.log(`[${PLUGIN_ID}] ${line}`)
    }
    function rememberError(error: unknown): string {
      return error instanceof Error ? error.message : String(error)
    }
    const state: PluginState = {
      pluginInstanceId: null, jwt: null, jwtExpiresAt: null,
      guideContent: null, guideVersion: null,
      stateFilePath: null, runtimeLockPath: null,
      activationContext, backgroundWorkerEnabled: false,
      lastAuthAt: null, lastAuthOk: false, lastError: null, lastTaskAt: null,
      runningTaskId: null, runningTasks: [], runtimeLeaseOwnerPid: null, recentTasks: [], logs,
    }
    const noopAsync = async (): Promise<void> => { /* no-op */ }
    const wCtx = {
      state, api, log, rememberError,
      persistSnapshot: noopAsync,
      resetAuth: noopAsync,
      recoverAuth: async () => false,
      taskLog: startupTaskLog,
    }
    startupLog('activate')
    registerRpcMethods({
      api, state, log, rememberError,
      runAuth: () => Promise.reject(new Error('auth not available in subprocess')),
      pollAndRun: () => _pollAndRun(wCtx),
      runClaimedTask: (task: ExecutionTask) => _runClaimedTask(wCtx, task),
      resetAuth: noopAsync,
      computedLockPath: join(__dirname, RUNTIME_LOCK_FILE),
    })
    startupLog('rpc-registered')
    return
  }

  if (debugEnabled) {
    console.log(`[${PLUGIN_ID}] activate() ${activationContext} pid=${pid ?? 'unknown'} hasRegisterGatewayMethod=${hasRegisterGatewayMethod} hasSubagentRun=${hasSubagentRun}`)
  }
  startupLog('activate')

  let stateHydrated = false
  let snapshotWrite: Promise<void> = Promise.resolve()
  const timerRef: TimerRef = { current: null }
  const lockOwnerRef = { value: false }
  const activeSpawns = new Map<string, ActiveSpawnInfo>()

  const state: PluginState = {
    pluginInstanceId: null, jwt: null, jwtExpiresAt: null,
    guideContent: null, guideVersion: null,
    stateFilePath: null, runtimeLockPath: null,
    activationContext, backgroundWorkerEnabled: false,
    lastAuthAt: null, lastAuthOk: false, lastError: null, lastTaskAt: null,
    runningTaskId: null, runningTasks: [], runtimeLeaseOwnerPid: null, recentTasks: [], logs: [],
  }

  function getHomeDir(): string { try { return homedir() } catch { return process?.env?.HOME || '.' } }
  function getStateFilePath(): string { return join(getHomeDir(), '.openclaw', STATE_FILE) }
  function getRuntimeLockPath(): string { return join(__dirname, RUNTIME_LOCK_FILE) }
  function getTaskLogPath(): string { return getSemanticTaskLogPath(cfg) }
  const taskLogPath = getTaskLogPath()
  const taskLog = createTaskLogger(taskLogPath, debugEnabled)

  function log(msg: string): void {
    if (!debugEnabled) return
    const line = `${new Date().toISOString()} ${msg}`
    state.logs = [...state.logs, line].slice(-200)
    console.log(`[${PLUGIN_ID}] ${line}`)
    if (stateHydrated) void persistSnapshot()
  }

  function rememberError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error)
    state.lastError = text
    return text
  }

  async function persistSnapshot(): Promise<void> {
    const path = state.stateFilePath ?? getStateFilePath()
    state.stateFilePath = path
    snapshotWrite = snapshotWrite.catch(() => {}).then(async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify({
        pluginInstanceId: state.pluginInstanceId,
        jwt: state.jwt,
        jwtExpiresAt: state.jwtExpiresAt,
        guideVersion: state.guideVersion,
        lastAuthAt: state.lastAuthAt,
        lastAuthOk: state.lastAuthOk,
        lastError: state.lastError,
        lastTaskAt: state.lastTaskAt,
        runtimeLockPath: state.runtimeLockPath,
        runtimeLeaseOwnerPid: state.runtimeLeaseOwnerPid,
        recentTasks: state.recentTasks,
      }, null, 2))
    })
    return snapshotWrite
  }

  async function resetAuth(): Promise<void> {
    state.jwt = null
    state.jwtExpiresAt = null
    await persistSnapshot()
  }

  const persistState = persistSnapshot
  const hCtx = { state, api, log, rememberError, persistState }
  const recoverAuth = (reason: string) => _recoverAuth(hCtx, timerRef, reason)
  const wCtx = { state, api, log, rememberError, persistSnapshot, resetAuth, recoverAuth, taskLog }

  registerRpcMethods({
    api, state, log, rememberError,
    runAuth: () => runAuth(hCtx),
    pollAndRun: () => _pollAndRun(wCtx),
    runClaimedTask: (task: ExecutionTask) => _runClaimedTask(wCtx, task),
    resetAuth,
    computedLockPath: getRuntimeLockPath(),
  })
      
  log(`rpc:registered context=${activationContext}`)
  startupLog('rpc-registered')

  if (activationContext !== 'runtime') {
    log(`startup:background-disabled context=${activationContext}`)
    startupLog('background-disabled', { reason: `context_${activationContext}` })
    return
  }

  if (!hasSubagentRun) {
    log('startup:background-disabled runtime_subagent=missing')
    startupLog('background-disabled', { reason: 'subagent_missing' })
    return
  }

  const { port, token } = getGatewayConfig(api)
  log(`gateway: ws://127.0.0.1:${port}/ tokenPresent=${token !== null}`)

  startHydration({
    state, cfg, log, rememberError, persistSnapshot, hCtx, timerRef,
    stateFilePath: getStateFilePath(),
    lockPath: getRuntimeLockPath(),
    lockOwnerRef,
    onHydrated: () => { stateHydrated = true },
  })

  const maxConcurrent: number = (cfg as any).maxConcurrentTasks ?? 3
  log('startTimer')
  startTimers({
    state, api, log, persistSnapshot, recoverAuth, activeSpawns, lockOwnerRef, taskLog,
    getLockPath: () => state.runtimeLockPath ?? '',
    maxConcurrent,
    pollMs: Math.max(500, cfg.taskPollIntervalMs ?? 30000),
    maxGatewayAttempts: (cfg as any).maxGatewayAttempts ?? 10,
    saturationRetryMs: (cfg as any).saturationRetryMs ?? SATURATION_RETRY_MS,
    spawnTtlMs: (cfg as any).spawnTtlMs ?? 2 * 60 * 60 * 1000,
    taskLogPath,
  })
}
