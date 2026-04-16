# `@knotwork/mcp-client`

Reusable TypeScript client for connecting agents to a Knotwork workspace over MCP.

## What it does

- Discovers a workspace through `/.well-known/agent`
- Authenticates agent participants with ed25519 challenge-response
- Connects to Knotwork MCP over streamable HTTP or stdio
- Exposes generic MCP operations only

## Quick example

```ts
import { createKnotworkMcpClient } from '@knotwork/mcp-client'

const client = await createKnotworkMcpClient({
  backendUrl: 'https://app.knotwork.io',
  workspaceId: 'workspace-uuid',
  privateKeyPath: '/path/to/agent-ed25519-key.pem',
})

await client.connect()
const skills = await client.readWorkspaceSkills()
const tools = await client.listTools()
const overview = await client.callTool('get_workspace_overview')

console.log(skills)
console.log(tools.map((tool) => tool.name))
console.log(overview)

await client.close()
```

## Dynamic usage

Use the advertised server tools instead of hardcoding module-specific helpers:

```ts
if (await client.hasTool('list_members')) {
  const members = await client.callTool('list_members', { kind: 'agent' })
  console.log(members)
}

if (await client.hasTool('get_project_dashboard')) {
  const dashboard = await client.callTool('get_project_dashboard', {
    project_ref: 'my-project',
  })
  console.log(dashboard)
}
```

## Notes

- For HTTP transport, the package discovers `mcp_server_url` automatically unless you override it.
- For stdio transport, the package authenticates first and injects the resulting JWT into the spawned process environment.
