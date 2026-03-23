// plugin.ts — OpenClaw plugin entry point.
// Debug: openclaw gateway call knotwork.status | knotwork.logs | knotwork.handshake | knotwork.execute_task
// All log lines also written to stdout → `docker logs <container> | grep knotwork-bridge`

/* eslint-disable no-console */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getConfig, getGatewayConfig } from './openclaw/bridge'
import { runHandshake, recoverCredentials as _recoverCredentials } from './lifecycle/handshake'
import type { TimerRef } from './lifecycle/handshake'
import { pollAndRun as _pollAndRun, runClaimedTask as _runClaimedTask } from './lifecycle/worker'
import { registerRpcMethods } from './lifecycle/rpc'
import { detectActivationContext, startHydration } from './lifecycle/startup'
import { startTimers } from './lifecycle/timers'
import { SATURATION_RETRY_MS } from './lifecycle/spawn'
import { createTaskLogger } from './state/tasklog'
import type { ExecutionTask, OpenClawApi, PluginConfig, PluginState } from './types'

const PLUGIN_ID = 'knotwork-bridge'
const STATE_FILE = 'knotwork-bridge-state.json'
const RUNTIME_LOCK_FILE = 'runtime.lock'
const CREDENTIALS_FILE = 'credentials.json'

export function activate(api: OpenClawApi): void {
  const activationContext = detectActivationContext()

  // For CLI gateway calls (subprocess invocation), register RPC methods with a
  // minimal context — credentials come in via SubprocessParams, not persisted state.
  if (activationContext === 'cli_gateway_call') {
    console.log(`[${PLUGIN_ID}] activate() cli_gateway_call — registering RPC methods only`)
    const logs: string[] = []
    function log(msg: string): void {
      const line = `${new Date().toISOString()} ${msg}`
      logs.push(line)
      console.log(`[${PLUGIN_ID}] ${line}`)
    }
    function rememberError(error: unknown): string {
      return error instanceof Error ? error.message : String(error)
    }
    const state: PluginState = {
      pluginInstanceId: null, integrationSecret: null, stateFilePath: null, runtimeLockPath: null,
      activationContext, backgroundWorkerEnabled: false, lastHandshakeAt: null,
      lastHandshakeOk: false, lastError: null, lastTaskAt: null,
      runningTaskId: null, runningTasks: [], runtimeLeaseOwnerPid: null, recentTasks: [], logs,
    }
    const taskLog = createTaskLogger(join(__dirname, 'tasks.log'))
    const noopAsync = async (): Promise<void> => { /* no-op */ }
    const wCtx = {
      state, api, log, rememberError,
      persistSnapshot: noopAsync,
      resetPersistedSecret: noopAsync,
      recoverCredentials: async () => false,
      taskLog,
    }
    registerRpcMethods({
      api, state, log, rememberError,
      runHandshake: () => Promise.reject(new Error('handshake not available in subprocess')),
      pollAndRun: () => _pollAndRun(wCtx),
      runClaimedTask: (task: ExecutionTask) => _runClaimedTask(wCtx, task),
      resetPersistedSecret: noopAsync,
      computedLockPath: join(__dirname, RUNTIME_LOCK_FILE),
    })
    return
  }

  console.log(`[${PLUGIN_ID}] activate() runtime`)

  let stateHydrated = false
  let snapshotWrite: Promise<void> = Promise.resolve()
  const timerRef: TimerRef = { current: null }
  const lockOwnerRef = { value: false }
  const activeSpawns = new Map<string, { startedAt: string }>()

  const state: PluginState = {
    pluginInstanceId: null, integrationSecret: null, stateFilePath: null, runtimeLockPath: null,
    activationContext, backgroundWorkerEnabled: false, lastHandshakeAt: null,
    lastHandshakeOk: false, lastError: null, lastTaskAt: null,
    runningTaskId: null, runningTasks: [], runtimeLeaseOwnerPid: null, recentTasks: [], logs: [],
  }

  function getHomeDir(): string { try { return homedir() } catch { return process?.env?.HOME || '.' } }
  function getStateFilePath(): string { return join(getHomeDir(), '.openclaw', STATE_FILE) }
  function getRuntimeLockPath(): string { return join(__dirname, RUNTIME_LOCK_FILE) }
  function getCredentialsFilePath(): string { return join(__dirname, CREDENTIALS_FILE) }
  const taskLogPath = join(__dirname, 'tasks.log')
  const taskLog = createTaskLogger(taskLogPath)

  function log(msg: string): void {
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
        lastHandshakeAt: state.lastHandshakeAt, lastHandshakeOk: state.lastHandshakeOk,
        lastError: state.lastError, lastTaskAt: state.lastTaskAt,
        runtimeLockPath: state.runtimeLockPath, runtimeLeaseOwnerPid: state.runtimeLeaseOwnerPid,
        recentTasks: state.recentTasks,
      }, null, 2))
    })
    return snapshotWrite
  }

  async function persistCredentials(): Promise<void> {
    const path = getCredentialsFilePath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ integrationSecret: state.integrationSecret }, null, 2))
  }

  async function resetPersistedSecret(resetInstanceId = false): Promise<void> {
    if (resetInstanceId) state.pluginInstanceId = null
    state.integrationSecret = null
    await persistSnapshot()
    await persistCredentials()
  }

  const persistState = async (): Promise<void> => { await persistSnapshot(); await persistCredentials() }
  const hCtx = { state, api, log, rememberError, persistState }
  const recoverCredentials = (reason: string) => _recoverCredentials(hCtx, timerRef, reason)
  const wCtx = { state, api, log, rememberError, persistSnapshot, resetPersistedSecret, recoverCredentials, taskLog }

  registerRpcMethods({
    api, state, log, rememberError,
    runHandshake: (overrides?: Partial<PluginConfig>) => runHandshake({ ...hCtx, api }, overrides),
    pollAndRun: () => _pollAndRun(wCtx),
    runClaimedTask: (task: ExecutionTask) => _runClaimedTask(wCtx, task),
    resetPersistedSecret,
    computedLockPath: getRuntimeLockPath(),
  })

  const cfg = getConfig(api)
  const { port, token } = getGatewayConfig(api)
  log(`gateway: ws://127.0.0.1:${port}/ tokenPresent=${token !== null}`)

  startHydration({
    state, cfg, log, rememberError, persistSnapshot, hCtx, timerRef,
    stateFilePath: getStateFilePath(),
    credentialsFilePath: getCredentialsFilePath(),
    lockPath: getRuntimeLockPath(),
    lockOwnerRef,
    onHydrated: () => { stateHydrated = true },
  })

  const maxConcurrent: number = (cfg as any).maxConcurrentTasks ?? 3
  log('startTimer')
  startTimers({
    state, api, log, persistCredentials, recoverCredentials, activeSpawns, lockOwnerRef, taskLog,
    getLockPath: () => state.runtimeLockPath ?? '',
    maxConcurrent,
    pollMs: Math.max(500, cfg.taskPollIntervalMs ?? 2000),
    maxGatewayAttempts: (cfg as any).maxGatewayAttempts ?? 10,
    saturationRetryMs: (cfg as any).saturationRetryMs ?? SATURATION_RETRY_MS,
    spawnTtlMs: (cfg as any).spawnTtlMs ?? 2 * 60 * 60 * 1000,
    taskLogPath,
  })
}
