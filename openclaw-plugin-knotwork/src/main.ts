/* eslint-disable no-console */

import { PLUGIN_ID, PLUGIN_VERSION } from './constants'
import { createPollingComm } from './comm'
import { getPluginConfig, resolvePluginInstanceId } from './config'
import { executeWithOpenClaw } from './execution'
import { handshake } from './handshake'
import type { AnyObj, OpenClawApi, PluginConfig, StatusState } from './types'
import { getRequestPayload, respond, toErrorMessage } from './utils'

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

export function activate(api: OpenClawApi) {
  const statusState: StatusState = {
    plugin_id: PLUGIN_ID,
    plugin_version: PLUGIN_VERSION,
    plugin_instance_id: null,
    integration_secret: null,
    last_handshake_at: null,
    last_handshake_ok: false,
    last_error: null,
    last_response: null,
    last_task_at: null,
    running_task_id: null,
    recent_logs: [],
  }

  let busy = false

  function pushLog(message: string) {
    const line = `${new Date().toISOString()} ${message}`
    statusState.recent_logs = [...statusState.recent_logs, line].slice(-200)
    console.log(`[${PLUGIN_ID}] ${line}`)
  }

  async function runHandshake(overrides: Partial<PluginConfig> = {}) {
    pushLog('handshake:start')
    const result = await handshake(api, overrides)
    statusState.plugin_instance_id = result.pluginInstanceId
    statusState.integration_secret =
      (result.response?.integration_secret as string | undefined) || statusState.integration_secret
    statusState.last_handshake_ok = true
    statusState.last_handshake_at = new Date().toISOString()
    statusState.last_error = null
    statusState.last_response = result.response
    pushLog('handshake:success')
    return result
  }

  async function maybeProcessTask() {
    if (busy) return

    const cfg = getPluginConfig(api)
    const baseUrl = cfg.knotworkBaseUrl
    const pluginInstanceId =
      (statusState.plugin_instance_id as string | null) || resolvePluginInstanceId(cfg)
    const integrationSecret = statusState.integration_secret as string | null

    if (!baseUrl || !pluginInstanceId || !integrationSecret) return

    busy = true
    const comm = createPollingComm(baseUrl, pluginInstanceId, integrationSecret)
    let currentTaskId: string | null = null
    try {
      const task = await comm.pullTask()
      if (!task) return

      const taskId = String(task.task_id)
      currentTaskId = taskId
      const nodeId = String(task.node_id || '')
      const sessionName = String(task.session_name || '')
      statusState.running_task_id = taskId
      statusState.last_task_at = new Date().toISOString()
      pushLog(`task:start id=${taskId} node=${nodeId} session=${sessionName}`)

      await comm.postTaskEvent(taskId, 'log', {
        entry_type: 'action',
        content: 'OpenClaw plugin started task execution',
        metadata: {
          run_id: task.run_id,
          node_id: task.node_id,
          agent_ref: task.agent_ref,
          session_name: task.session_name,
        },
      })

      pushLog(`task:execute begin id=${taskId}`)
      await comm.postTaskEvent(taskId, 'log', {
        entry_type: 'observation',
        content: 'Executing task against OpenClaw runtime',
      })
      const result = await withTimeout(executeWithOpenClaw(api, task), 95_000, 'executeWithOpenClaw')
      pushLog(`task:execute end id=${taskId}`)
      pushLog(`task:result id=${taskId} type=${String(result.type || 'completed')}`)

      if (result.type === 'escalation') {
        await comm.postTaskEvent(taskId, 'escalation', {
          question: result.question || 'Need human input',
          options: Array.isArray(result.options) ? result.options : [],
        })
      } else if (result.type === 'failed') {
        await comm.postTaskEvent(taskId, 'failed', {
          error: result.error || 'execution failed',
        })
      } else {
        await comm.postTaskEvent(taskId, 'completed', {
          output: result.output || '',
          next_branch: result.next_branch || null,
        })
      }

      statusState.running_task_id = null
    } catch (err) {
      statusState.last_error = toErrorMessage(err)
      statusState.last_handshake_ok = false
      statusState.running_task_id = null
      pushLog(`task:error ${statusState.last_error}`)
      if (currentTaskId) {
        try {
          await comm.postTaskEvent(currentTaskId, 'failed', { error: statusState.last_error || 'execution failed' })
        } catch (postErr) {
          pushLog(`task:error-post-failed ${toErrorMessage(postErr)}`)
        }
      }
    } finally {
      busy = false
    }
  }

  function parseHandshakeOverrides(payload: AnyObj): Partial<PluginConfig> {
    return {
      knotworkBaseUrl: typeof payload.knotworkBaseUrl === 'string' ? payload.knotworkBaseUrl : undefined,
      handshakeToken: typeof payload.handshakeToken === 'string' ? payload.handshakeToken : undefined,
      pluginInstanceId: typeof payload.pluginInstanceId === 'string' ? payload.pluginInstanceId : undefined,
    }
  }

  async function onHandshakeRpc(ctx: AnyObj) {
    const payload = getRequestPayload(ctx)
    try {
      const result = await runHandshake(parseHandshakeOverrides(payload))
      respond(ctx, true, {
        ok: true,
        pluginInstanceId: result.pluginInstanceId,
        result: result.response,
      })
    } catch (err) {
      statusState.last_handshake_ok = false
      statusState.last_handshake_at = new Date().toISOString()
      statusState.last_error = toErrorMessage(err)
      respond(ctx, false, {
        ok: false,
        error: statusState.last_error,
      })
    }
  }

  if (api.registerGatewayMethod) {
    api.registerGatewayMethod('knotwork.status', async (ctx: AnyObj) => {
      respond(ctx, true, {
        ...statusState,
        config: {
          knotworkBaseUrl: getPluginConfig(api).knotworkBaseUrl || null,
          autoHandshakeOnStart: getPluginConfig(api).autoHandshakeOnStart ?? true,
          taskPollIntervalMs: getPluginConfig(api).taskPollIntervalMs ?? 2000,
        },
      })
    })
    api.registerGatewayMethod('knotwork.logs', async (ctx: AnyObj) => {
      respond(ctx, true, { logs: statusState.recent_logs })
    })

    api.registerGatewayMethod('knotwork.handshake', onHandshakeRpc)
    api.registerGatewayMethod('knotwork.sync_agents', onHandshakeRpc)

    api.registerGatewayMethod('knotwork.process_once', async (ctx: AnyObj) => {
      try {
        await maybeProcessTask()
        respond(ctx, true, { ok: true })
      } catch (err) {
        respond(ctx, false, { ok: false, error: toErrorMessage(err) })
      }
    })
  }

  const cfg = getPluginConfig(api)

  if (cfg.autoHandshakeOnStart && cfg.knotworkBaseUrl && cfg.handshakeToken) {
    runHandshake()
      .then(() => {
        pushLog('startup:auto-handshake succeeded')
      })
      .catch((err: unknown) => {
        statusState.last_handshake_ok = false
        statusState.last_handshake_at = new Date().toISOString()
        statusState.last_error = toErrorMessage(err)
        pushLog(`startup:auto-handshake failed: ${statusState.last_error}`)
      })
  }

  const pollMs = Math.max(500, cfg.taskPollIntervalMs ?? 2000)
  setInterval(() => {
    void maybeProcessTask()
  }, pollMs)
}
