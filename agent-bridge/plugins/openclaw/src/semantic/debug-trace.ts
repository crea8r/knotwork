import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function sanitize(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_')
  return normalized || 'unknown'
}

function fenced(label: string, body: string, language = 'text'): string {
  return [`### ${label}`, `\`\`\`${language}`, body, '```', ''].join('\n')
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

  async writeSection(label: string, value: unknown, language = 'json'): Promise<void> {
    void label
    void value
    void language
  }

  async writeMarkdownSection(label: string, markdown: string): Promise<void> {
    void label
    void markdown
  }

  async writeError(error: unknown): Promise<void> {
    void error
  }

  private async flushDelivery(): Promise<void> {
    if (!this.enabled) return
    await mkdir(dirname(this.filePath), { recursive: true })
    const deliveryBody = this.deliveries.map((delivery) => {
      const parts: string[] = []
      parts.push(`## ${delivery.iteration}`, '')
      if (delivery.extraSystemPrompt) parts.push(fenced('Agent System Prompt', delivery.extraSystemPrompt, 'markdown'))
      parts.push(fenced('Agent User Prompt', delivery.message, 'markdown'))
      if (delivery.reply !== undefined) parts.push(fenced('Agent Raw Reply', delivery.reply, 'text'))
      return parts.join('\n')
    }).join('\n')
    await writeFile(this.filePath, deliveryBody)
  }
}
