import { executeTaskRaw } from '../openclaw/session'
import type { ThinkingRuntime, SemanticThinkInput } from './contracts'
import type { OpenClawApi } from '../types'

export class OpenClawThinkingRuntime implements ThinkingRuntime {
  constructor(private readonly api: OpenClawApi) {}

  async think(input: SemanticThinkInput): Promise<{ rawOutput: string; deliveredSystemPrompt?: string }> {
    const result = await executeTaskRaw(this.api, {
      task_id: input.taskId,
      channel_id: input.channelId,
      session_name: input.sessionName,
      system_prompt: input.systemPrompt,
      user_prompt: input.userPrompt,
    })
    if (result.type === 'failed') throw new Error(result.error)
    return { rawOutput: result.output, deliveredSystemPrompt: result.deliveredSystemPrompt }
  }
}
