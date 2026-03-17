// Plugin directory — resolves to ~/.openclaw/extensions/knotwork-bridge when loaded by OpenClaw.
declare const __dirname: string

declare const process: {
  env?: Record<string, string | undefined>
  argv?: string[]
  pid?: number
  platform?: string
  kill(pid: number, signal?: number | string): void
  exit(code?: number): never
  once(event: string, listener: (...args: unknown[]) => void): void
  exitCode?: number
}

declare module 'node:fs' {
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void
}

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  export function open(path: string, flags: string): Promise<{
    writeFile(data: string): Promise<void>
    close(): Promise<void>
  }>
  export function readFile(path: string, encoding: string): Promise<string>
  export function rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>
  export function writeFile(path: string, data: string): Promise<void>
}

declare module 'node:os' {
  export function homedir(): string
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...parts: string[]): string
}
