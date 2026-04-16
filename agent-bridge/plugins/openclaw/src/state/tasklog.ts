// tasklog.ts — Persistent task lifecycle log written to the plugin root at tasks.log
// Each line: ISO-timestamp event task=<id> [key=value ...]

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type TaskLogger = (event: string, taskId: string, extra?: Record<string, string>) => void

export function createTaskLogger(logPath: string, enabled = true): TaskLogger {
  if (!enabled) {
    return () => { /* debug logging disabled */ }
  }

  function write(line: string): void {
    void appendFile(logPath, line).catch(async () => {
      try {
        await mkdir(dirname(logPath), { recursive: true })
        await appendFile(logPath, line)
      } catch { /* ignore — log is best-effort */ }
    })
  }

  return (event: string, taskId: string, extra: Record<string, string> = {}): void => {
    const pairs = Object.entries(extra).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
    // shorten the taskId
    const shortenTaskId = taskId.split('-')[0] || taskId;
    write(`${new Date().toISOString()} ${event} task=${shortenTaskId}${pairs ? ' ' + pairs : ''}\n`)
  }
}
