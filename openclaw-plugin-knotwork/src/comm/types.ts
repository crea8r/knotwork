import type { AnyObj } from '../types'

export type TaskEventType = 'log' | 'completed' | 'failed' | 'escalation'

export type CommChannel = {
  pullTask: () => Promise<AnyObj | null>
  postTaskEvent: (taskId: string, eventType: TaskEventType, payload: AnyObj) => Promise<void>
}
