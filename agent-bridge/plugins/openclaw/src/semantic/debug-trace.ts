import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function sanitize(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_')
  return normalized || 'unknown'
}

function codeBlock(label: string, language: string, body: string): string {
  return [
    `## ${label}`,
    `\`\`\`${language}`,
    body,
    '```',
    '',
  ].join('\n')
}

function toPretty(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export class SemanticDebugTrace {
  private readonly sections: string[] = []
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
    this.filePath = join(baseDir, `${taskKey}--${sessionKey}.md`)
    if (!input.enabled) this.filePath = ''
  }

  get enabled(): boolean {
    return this.filePath.length > 0
  }

  async writeSection(label: string, value: unknown, language = 'json'): Promise<void> {
    if (!this.enabled) return
    this.sections.push(codeBlock(label, language, toPretty(value)))
    await this.flush()
  }

  async writeMarkdownSection(label: string, markdown: string): Promise<void> {
    if (!this.enabled) return
    this.sections.push(`## ${label}\n${markdown.trim()}\n`)
    await this.flush()
  }

  async writeError(error: unknown): Promise<void> {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    await this.writeSection('Error', message, 'text')
  }

  private async flush(): Promise<void> {
    if (!this.enabled) return
    const header = [
      '# Knotwork Semantic Session Debug',
      '',
      `- Generated at: ${new Date().toISOString()}`,
      `- File: ${this.filePath}`,
      '',
    ].join('\n')
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${header}${this.sections.join('\n')}`)
  }
}
