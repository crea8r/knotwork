import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function sanitize(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_')
  return normalized || 'unknown'
}

function fenced(label: string, body: string): string {
  return [`## ${label}`, '```text', body, '```', ''].join('\n')
}

export class SemanticDebugTrace {
  private readonly deliveries: Array<{
    iteration: string
    message: string
    extraSystemPrompt?: string
    reply?: string
  }> = []
  readonly filePath: string

  constructor(input: {
    enabled: boolean
    rootDir?: string
    taskId: string
    sessionName?: string
  }) {
    const baseDir = input.rootDir?.trim() || join(homedir(), '.openclaw', 'knotwork-debug', 'sessions')
    const sessionKey = sanitize(input.sessionName)
    const taskKey = sanitize(input.taskId)
    this.filePath = join(baseDir, `delivery_${taskKey}--${sessionKey}.md`)
    if (!input.enabled) {
      this.filePath = ''
    }
  }

  get enabled(): boolean {
    return this.filePath.length > 0
  }

  async writeDelivery(input: { iteration: string; message: string; extraSystemPrompt?: string | null }): Promise<void> {
    if (!this.enabled) return
    const record: { iteration: string; message: string; extraSystemPrompt?: string; reply?: string } = {
      iteration: input.iteration,
      message: String(input.message ?? ''),
    }
    const systemPrompt = String(input.extraSystemPrompt ?? '')
    if (systemPrompt) record.extraSystemPrompt = systemPrompt
    this.deliveries.push(record)
    await this.flushDelivery()
  }

  async writeReply(input: { iteration: string; reply: string | null | undefined }): Promise<void> {
    if (!this.enabled) return
    const reply = String(input.reply ?? '')
    const delivery = this.deliveries.find((item) => item.iteration === input.iteration)
    if (!delivery) return
    delivery.reply = reply
    await this.flushDelivery()
  }

  async writeSection(_label: string, _value: unknown, _language = 'json'): Promise<void> {}

  async writeMarkdownSection(_label: string, _markdown: string): Promise<void> {}

  async writeError(error: unknown): Promise<void> {
    void error
  }

  private async flushDelivery(): Promise<void> {
    if (!this.enabled) return
    await mkdir(dirname(this.filePath), { recursive: true })
    const body = this.deliveries.map((delivery) => {
      const parts: string[] = []
      if (this.deliveries.length > 1) parts.push(`# Delivery ${delivery.iteration}`, '')
      if (delivery.extraSystemPrompt) parts.push(fenced('extraSystemPrompt', delivery.extraSystemPrompt))
      parts.push(fenced('message', delivery.message))
      if (delivery.reply !== undefined) parts.push(fenced('reply', delivery.reply))
      return parts.join('\n')
    }).join('\n')
    await writeFile(this.filePath, `${body}`)
  }
}
