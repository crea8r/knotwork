import { PLUGIN_ID, PLUGIN_VERSION } from './constants'
import { getPluginConfig, resolvePluginInstanceId } from './config'
import { extractAgents } from './agents'
import { postJson } from './http'
import type { AnyObj, OpenClawApi, PluginConfig } from './types'

export async function handshake(api: OpenClawApi, overrides: Partial<PluginConfig> = {}) {
  const base = getPluginConfig(api)
  const cfg: PluginConfig = {
    ...base,
    ...overrides,
  }

  if (!cfg.knotworkBaseUrl || !cfg.handshakeToken) {
    throw new Error('Missing knotworkBaseUrl or handshakeToken')
  }

  const pluginInstanceId = resolvePluginInstanceId(cfg)
  const payload: AnyObj = {
    token: cfg.handshakeToken,
    plugin_instance_id: pluginInstanceId,
    plugin_version: PLUGIN_VERSION,
    metadata: {
      plugin_id: PLUGIN_ID,
      started_at: new Date().toISOString(),
    },
    agents: await extractAgents(api),
  }

  const baseUrl = cfg.knotworkBaseUrl.replace(/\/$/, '')
  const resp = await postJson(`${baseUrl}/openclaw-plugin/handshake`, payload)
  if (!resp.ok) {
    throw new Error(`Handshake failed (${resp.status}): ${resp.text.slice(0, 300)}`)
  }

  return {
    pluginInstanceId,
    response: resp.data,
  }
}
