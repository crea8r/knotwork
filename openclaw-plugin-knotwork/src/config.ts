import { PLUGIN_ID } from './constants'
import type { AnyObj, OpenClawApi, PluginConfig } from './types'
import { readEnv } from './utils'

export function getPluginConfig(api: OpenClawApi): PluginConfig {
  const candidates: Array<AnyObj | undefined> = [
    api.pluginConfig,
    ((api.config as AnyObj | undefined)?.plugins as AnyObj | undefined)?.entries as AnyObj | undefined,
  ]

  let entryConfig: AnyObj | undefined
  const entries = candidates[1]
  if (entries && typeof entries === 'object') {
    const direct = entries[PLUGIN_ID] as AnyObj | undefined
    const alias = entries.knotwork as AnyObj | undefined
    entryConfig = (direct?.config as AnyObj | undefined) || (alias?.config as AnyObj | undefined)
  }

  const directCfg = (api.pluginConfig as AnyObj | undefined) || {}
  const merged = {
    ...entryConfig,
    ...directCfg,
  } as PluginConfig

  return {
    knotworkBaseUrl: merged.knotworkBaseUrl || readEnv('KNOTWORK_BASE_URL'),
    handshakeToken: merged.handshakeToken || readEnv('KNOTWORK_HANDSHAKE_TOKEN'),
    pluginInstanceId: merged.pluginInstanceId || readEnv('KNOTWORK_PLUGIN_INSTANCE_ID'),
    autoHandshakeOnStart:
      typeof merged.autoHandshakeOnStart === 'boolean'
        ? merged.autoHandshakeOnStart
        : (readEnv('KNOTWORK_AUTO_HANDSHAKE_ON_START') ?? 'true') !== 'false',
    taskPollIntervalMs:
      typeof merged.taskPollIntervalMs === 'number'
        ? merged.taskPollIntervalMs
        : parseInt(readEnv('KNOTWORK_TASK_POLL_INTERVAL_MS') ?? '2000', 10),
  }
}

export function resolvePluginInstanceId(cfg: PluginConfig): string {
  if (cfg.pluginInstanceId && cfg.pluginInstanceId.trim()) return cfg.pluginInstanceId.trim()
  return `knotwork-${Math.random().toString(36).slice(2, 12)}`
}
