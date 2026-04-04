import { KnotworkMcpError } from './errors.js'
import type { KnotworkAgentDiscovery } from './types.js'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function normalizeEndpointUrl(endpoint: string): string {
  return endpoint.replace(/^[A-Z]+\s+/, '').trim()
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new KnotworkMcpError(`HTTP ${response.status}: ${text.slice(0, 240)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new KnotworkMcpError(`Expected JSON response, received: ${text.slice(0, 240)}`, {
      cause: error,
    })
  }
}

export async function discoverKnotworkWorkspace(
  backendUrl: string,
  workspaceId: string,
): Promise<KnotworkAgentDiscovery> {
  const response = await fetch(
    `${normalizeBaseUrl(backendUrl)}/api/v1/workspaces/${workspaceId}/.well-known/agent`,
  )
  return parseJsonResponse<KnotworkAgentDiscovery>(response)
}

export async function fetchWorkspaceSkills(
  skillsEndpoint: string,
  bearerToken: string,
): Promise<string> {
  const response = await fetch(normalizeEndpointUrl(skillsEndpoint), {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'text/markdown',
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new KnotworkMcpError(`HTTP ${response.status}: ${text.slice(0, 240)}`)
  }
  return text
}
