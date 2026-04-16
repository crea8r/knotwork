import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getSemanticDebugRoot } from '../openclaw/bridge'
import type { MCPContractManifest, PluginConfig } from '../types'

const CACHE_META_OPEN = '<!-- knotwork-mcp-contract-cache'
const CACHE_META_CLOSE = '-->'

function sanitize(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function cacheDir(cfg?: PluginConfig): string {
  return join(getSemanticDebugRoot(cfg ?? {}), 'contract-cache')
}

function cachePath(cfg: PluginConfig | undefined, contractId: string, checksum: string): string {
  return join(cacheDir(cfg), `${sanitize(contractId)}@${sanitize(checksum)}.md`)
}

function serializeContract(mcpContract: MCPContractManifest): string {
  return [
    `${CACHE_META_OPEN}`,
    JSON.stringify(mcpContract, null, 2),
    `${CACHE_META_CLOSE}`,
    '',
    mcpContract.markdown.trim(),
    '',
  ].join('\n')
}

function parseContract(raw: string): MCPContractManifest | null {
  const start = raw.indexOf(CACHE_META_OPEN)
  if (start !== 0) return null
  const end = raw.indexOf(CACHE_META_CLOSE, CACHE_META_OPEN.length)
  if (end === -1) return null
  const jsonText = raw.slice(CACHE_META_OPEN.length, end).trim()
  try {
    return JSON.parse(jsonText) as MCPContractManifest
  } catch {
    return null
  }
}

export async function readCachedContract(
  cfg: PluginConfig | undefined,
  contractId: string,
  checksum: string,
): Promise<MCPContractManifest | null> {
  try {
    const raw = await readFile(cachePath(cfg, contractId, checksum), 'utf8')
    const parsed = parseContract(raw)
    if (!parsed) return null
    if (parsed.id !== contractId) return null
    if (parsed.checksum !== checksum) return null
    return parsed
  } catch {
    return null
  }
}

export async function persistCachedContract(
  cfg: PluginConfig | undefined,
  mcpContract: MCPContractManifest,
): Promise<void> {
  const path = cachePath(cfg, mcpContract.id, mcpContract.checksum)
  await mkdir(cacheDir(cfg), { recursive: true })
  await writeFile(path, serializeContract(mcpContract))
}
