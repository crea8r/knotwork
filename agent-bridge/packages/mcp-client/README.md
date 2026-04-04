# `@knotwork/mcp-client`

Reusable TypeScript client for connecting agents to a Knotwork workspace over MCP.

## What it does

- Discovers a workspace through `/.well-known/agent`
- Authenticates agent participants with ed25519 challenge-response
- Connects to Knotwork MCP over streamable HTTP or stdio
- Exposes generic MCP operations and a small typed Knotwork helper layer

## Quick example

```ts
import { createKnotworkMcpClient } from '@knotwork/mcp-client'

const client = await createKnotworkMcpClient({
  backendUrl: 'https://app.knotwork.io',
  workspaceId: 'workspace-uuid',
  privateKeyPath: '/path/to/agent-ed25519-key.pem',
})

await client.connect()
const skills = await client.getWorkspaceSkills()
const overview = await client.getWorkspaceOverview()

console.log(skills)
console.log(overview)

await client.close()
```

## Notes

- For HTTP transport, the package discovers `mcp_server_url` automatically unless you override it.
- For stdio transport, the package authenticates first and injects the resulting JWT into the spawned process environment.
