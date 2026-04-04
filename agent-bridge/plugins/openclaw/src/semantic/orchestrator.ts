import type { KnotworkTransport, ThinkingRuntime } from '../transport/contracts'
import { dispatchEnvelope } from './dispatcher'
import { parseActionEnvelope } from './parser'
import { buildSemanticSystemPrompt, buildSemanticUserPrompt } from './prompt-builder'
import type { ActionEnvelope, DispatchResult, SemanticPreparedInput, SemanticTask } from './types'

export type SemanticOrchestratorResult = {
  envelope: ActionEnvelope
  dispatch: DispatchResult
}

export class SemanticOrchestrator {
  constructor(
    private readonly thinkingRuntime: ThinkingRuntime,
    private readonly transport: KnotworkTransport,
  ) {}

  async run(task: SemanticTask, options: { defaultAuthorName: string }): Promise<SemanticOrchestratorResult> {
    const capabilities = await this.transport.getCapabilitySnapshot(task.trigger)
    const context = await this.transport.loadThinkingContext(task.trigger, task.legacyUserPrompt)
    const prepared: SemanticPreparedInput = { task, capabilities, context }
    const systemPrompt = buildSemanticSystemPrompt(prepared)
    const userPrompt = buildSemanticUserPrompt(prepared)
    const thought = await this.thinkingRuntime.think({
      taskId: task.taskId,
      channelId: task.channelId,
      sessionName: task.sessionName,
      systemPrompt,
      userPrompt,
    })
    const defaultKnowledgePath =
      context.assetContext.knowledgeFiles.length === 1
        ? context.assetContext.knowledgeFiles[0]?.path ?? null
        : null
    const envelope = parseActionEnvelope(thought.rawOutput, {
      defaultKnowledgePath,
    })
    const dispatch = await dispatchEnvelope(this.transport, envelope, capabilities, {
      defaultAuthorName: options.defaultAuthorName,
      fallbackRunId: task.runId ?? null,
      fallbackSourceChannelId: task.channelId ?? task.trigger.channel_id ?? null,
    })
    return { envelope, dispatch }
  }
}
