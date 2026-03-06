import { postJson } from './http'
import type { AnyObj } from './types'

export async function postTaskEvent(
  baseUrl: string,
  pluginInstanceId: string,
  integrationSecret: string,
  taskId: string,
  eventType: string,
  payload: AnyObj,
) {
  const url = `${baseUrl.replace(/\/$/, '')}/openclaw-plugin/tasks/${taskId}/event`
  const resp = await postJson(
    url,
    {
      plugin_instance_id: pluginInstanceId,
      event_type: eventType,
      payload,
    },
    {
      'X-Knotwork-Integration-Secret': integrationSecret,
    },
  )
  if (!resp.ok) {
    throw new Error(`Task event failed (${resp.status}): ${resp.text.slice(0, 240)}`)
  }
}

export async function pullTask(
  baseUrl: string,
  pluginInstanceId: string,
  integrationSecret: string,
): Promise<AnyObj | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/openclaw-plugin/pull-task`
  const resp = await postJson(
    url,
    { plugin_instance_id: pluginInstanceId },
    {
      'X-Knotwork-Integration-Secret': integrationSecret,
    },
  )
  if (!resp.ok) {
    throw new Error(`Pull task failed (${resp.status}): ${resp.text.slice(0, 240)}`)
  }
  const task = (resp.data?.task as AnyObj | undefined) || null
  return task
}
