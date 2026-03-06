import { pullTask, postTaskEvent } from '../taskBridge'
import type { AnyObj } from '../types'
import type { CommChannel, TaskEventType } from './types'

export function createPollingComm(baseUrl: string, pluginInstanceId: string, integrationSecret: string): CommChannel {
  return {
    pullTask: async () => await pullTask(baseUrl, pluginInstanceId, integrationSecret),
    postTaskEvent: async (taskId: string, eventType: TaskEventType, payload: AnyObj) => {
      await postTaskEvent(baseUrl, pluginInstanceId, integrationSecret, taskId, eventType, payload)
    },
  }
}
