// plugin.ts — OpenClaw plugin entry point.
// Debug: openclaw gateway call knotwork.status | knotwork.logs | knotwork.handshake | knotwork.process_once
// All log lines also written to stdout → `docker logs <container> | grep knotwork-bridge`

/* eslint-disable no-console */
import { discoverAgents, doHandshake, getConfig, getGatewayConfig, postEvent, pullTask, resolveInstanceId } from './bridge'
import { executeTask } from './session'
import type { AnyObj, OpenClawApi, PluginConfig, PluginState } from './types'

const PLUGIN_ID = 'knotwork-bridge'

export function activate(api: OpenClawApi): void {
  const state: PluginState = {
    pluginInstanceId: null,
    integrationSecret: null,
    lastHandshakeAt: null,
    lastHandshakeOk: false,
    lastError: null,
    lastTaskAt: null,
    runningTaskId: null,
    logs: [],
  }

  // ── Logging ─────────────────────────────────────────────────────────────────
  // Each line goes to: stdout (Docker-visible) + in-memory ring buffer (RPC-accessible)

  function log(msg: string): void {
    const line = `${new Date().toISOString()} ${msg}`
    state.logs = [...state.logs, line].slice(-200)
    console.log(`[${PLUGIN_ID}] ${line}`)
  }

  // ── Handshake ────────────────────────────────────────────────────────────────

  async function runHandshake(overrides: Partial<PluginConfig> = {}): Promise<AnyObj> {
    const cfg = { ...getConfig(api), ...overrides }
    if (!cfg.knotworkBaseUrl || !cfg.handshakeToken) {
      throw new Error('Missing knotworkBaseUrl or handshakeToken in plugin config')
    }
    const instanceId = state.pluginInstanceId ?? resolveInstanceId(cfg)
    const agents = await discoverAgents(api)
    log(`handshake:start instanceId=${instanceId} agents=${agents.length}`)
    const resp = await doHandshake(cfg.knotworkBaseUrl, cfg.handshakeToken, instanceId, agents)
    state.pluginInstanceId = (resp.plugin_instance_id as string | undefined) ?? instanceId
    state.integrationSecret = (resp.integration_secret as string | undefined) ?? state.integrationSecret
    state.lastHandshakeOk = true
    state.lastHandshakeAt = new Date().toISOString()
    state.lastError = null
    log(`handshake:ok secret=...${String(state.integrationSecret ?? '').slice(-4)}`)
    return resp
  }

  // ── Task execution ───────────────────────────────────────────────────────────

  async function pollAndRun(): Promise<void> {
    const cfg = getConfig(api)
    const baseUrl = cfg.knotworkBaseUrl
    const instanceId = state.pluginInstanceId
    const secret = state.integrationSecret
    if (!baseUrl || !instanceId || !secret) return

    const task = await pullTask(baseUrl, instanceId, secret)
    if (!task) return

    const taskId = String(task.task_id)
    state.runningTaskId = taskId
    state.lastTaskAt = new Date().toISOString()
    log(`task:start id=${taskId} node=${task.node_id} session=${task.session_name}`)

    // Notify Knotwork we've claimed the task (visible in debug panel)
    await postEvent(baseUrl, instanceId, secret, taskId, 'log', {
      entry_type: 'action',
      content: 'Plugin started task execution',
      metadata: { node_id: task.node_id, run_id: task.run_id, session_name: task.session_name },
    }).catch(() => { /* non-fatal — don't let a log failure abort the task */ })

    let heartbeat: ReturnType<typeof setInterval> | null = null
    try {
      let heartbeatCount = 0
      heartbeat = setInterval(() => {
        heartbeatCount += 1
        postEvent(baseUrl, instanceId, secret, taskId, 'log', {
          entry_type: 'progress',
          content: `OpenClaw is still working (heartbeat ${heartbeatCount})`,
          metadata: { heartbeat: heartbeatCount, node_id: task.node_id, run_id: task.run_id },
        }).catch(() => { /* non-fatal heartbeat */ })
      }, 15000)

      const result = await executeTask(api, task)
      if (heartbeat) clearInterval(heartbeat)
      log(`task:done id=${taskId} type=${result.type}`)

      if (result.type === 'escalation') {
        await postEvent(baseUrl, instanceId, secret, taskId, 'escalation', {
          question: result.question,
          options: result.options,
          message: result.message,
        })
      } else if (result.type === 'failed') {
        await postEvent(baseUrl, instanceId, secret, taskId, 'failed', { error: result.error })
      } else {
        await postEvent(baseUrl, instanceId, secret, taskId, 'completed', {
          output: result.output,
          next_branch: result.next_branch,
        })
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log(`task:error id=${taskId} ${error}`)
      await postEvent(baseUrl, instanceId, secret, taskId, 'failed', { error }).catch(() => {})
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      state.runningTaskId = null
    }
  }

  // ── Gateway RPC methods ───────────────────────────────────────────────────────
  // These are callable from any terminal: `openclaw gateway call knotwork.<method>`

  if (typeof api.registerGatewayMethod === 'function') {
    const rpc = api.registerGatewayMethod.bind(api)

    rpc('knotwork.status', async (ctx: AnyObj) => {
      const cfg = getConfig(api)
      ok(ctx, {
        ...state,
        runtime: {
          gatewayCallAvailable: typeof api.gateway?.call === 'function',
        },
        config: {
          knotworkBaseUrl: cfg.knotworkBaseUrl ?? null,
          autoHandshakeOnStart: cfg.autoHandshakeOnStart ?? true,
          taskPollIntervalMs: cfg.taskPollIntervalMs ?? 2000,
        },
      })
    })

    rpc('knotwork.logs', async (ctx: AnyObj) => {
      // Returns the in-memory log buffer. For persistent logs use `docker logs`.
      ok(ctx, { logs: state.logs, count: state.logs.length })
    })

    const handleHandshake = async (ctx: AnyObj): Promise<void> => {
      const payload = getPayload(ctx)
      try {
        const resp = await runHandshake({
          knotworkBaseUrl: payload.knotworkBaseUrl as string | undefined,
          handshakeToken: payload.handshakeToken as string | undefined,
          pluginInstanceId: payload.pluginInstanceId as string | undefined,
        })
        ok(ctx, { ok: true, pluginInstanceId: state.pluginInstanceId, result: resp })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        state.lastHandshakeOk = false
        state.lastHandshakeAt = new Date().toISOString()
        state.lastError = error
        ok(ctx, { ok: false, error })
      }
    }

    rpc('knotwork.handshake', handleHandshake)
    rpc('knotwork.sync_agents', handleHandshake) // alias — re-handshake re-syncs agents

    rpc('knotwork.process_once', async (ctx: AnyObj) => {
      try {
        await pollAndRun()
        ok(ctx, { ok: true })
      } catch (err) {
        ok(ctx, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  // ── Startup ───────────────────────────────────────────────────────────────────

  const cfg = getConfig(api)

  if (cfg.autoHandshakeOnStart && cfg.knotworkBaseUrl && cfg.handshakeToken) {
    runHandshake().catch((err: unknown) => {
      state.lastHandshakeOk = false
      state.lastHandshakeAt = new Date().toISOString()
      state.lastError = err instanceof Error ? err.message : String(err)
      log(`startup:handshake-failed ${state.lastError}`)
    })
  }

  // Startup diagnostic — confirm WebSocket gateway config is readable
  const { port, token } = getGatewayConfig(api)
  log(`gateway: ws://127.0.0.1:${port}/ tokenPresent=${token !== null}`)

  // Poll loop — busy flag prevents concurrent execution
  let busy = false
  const pollMs = Math.max(500, cfg.taskPollIntervalMs ?? 2000)
  setInterval(() => {
    if (busy) return
    busy = true
    pollAndRun()
      .catch((err) => log(`poll:error ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => { busy = false })
  }, pollMs)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPayload(ctx: AnyObj): AnyObj {
  return (ctx.request?.payload ?? ctx.payload ?? {}) as AnyObj
}

function ok(ctx: AnyObj, payload: AnyObj): void {
  if (typeof ctx.respond === 'function') ctx.respond(true, payload)
}
