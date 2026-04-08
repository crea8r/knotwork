import {
  authenticateKnotworkAgent,
  createPemFileSigner,
  McpClient,
  StreamableHttpMcpTransport,
} from '../agent-bridge/packages/mcp-client/dist/index.js'

const workspaceId = '1bc45fc5-74c7-435e-96f9-0881ea49a24f'
const backendUrl = 'http://127.0.0.1:8000'
const keyPath =
  '/Users/hieu/Work/crea8r/knotwork/agent-bridge/packages/test-mcp-client/codex-knotwork-test.key'

const CHANNELS = {
  test: 'd7c2e4b0-225e-48fa-b267-3b5c709acbd1',
  file: '07c1a79a-118d-4b5f-95e5-11a6454eaad8',
  folder: 'd46c4d20-fe6e-4c3a-9fe7-c5bd60f0c1bd',
  run: '9e77de7c-f9f0-4b1c-80c3-5ba345906106',
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseTool(raw) {
  if (raw?.structuredContent !== undefined) return raw.structuredContent
  if (!raw?.content || !Array.isArray(raw.content)) return raw
  if (raw.content.length === 0) return []
  if (raw.content.length === 1 && raw.content[0]?.type === 'text') {
    try {
      return JSON.parse(raw.content[0].text)
    } catch {
      return raw.content[0].text
    }
  }
  return raw.content.map((item) => {
    if (item?.type !== 'text') return item
    try {
      return JSON.parse(item.text)
    } catch {
      return item.text
    }
  })
}

async function connectClient() {
  const auth = await authenticateKnotworkAgent(backendUrl, createPemFileSigner(keyPath))
  const client = new McpClient({
    transport: new StreamableHttpMcpTransport({
      url: `${backendUrl}/mcp/`,
      bearerToken: auth.accessToken,
      headers: { 'X-Knotwork-Workspace-Id': workspaceId },
    }),
  })
  await client.connect()
  return client
}

async function tool(client, name, args = {}) {
  const raw = await client.request('tools/call', { name, arguments: args })
  return parseTool(raw)
}

async function messages(client, channelId) {
  const out = await tool(client, 'list_channel_messages', { channel_ref: channelId })
  return Array.isArray(out) ? out : []
}

async function knowledgeChanges(client) {
  const out = await tool(client, 'list_knowledge_changes')
  return Array.isArray(out) ? out : []
}

async function post(client, channelId, content) {
  return tool(client, 'post_channel_message', {
    channel_ref: channelId,
    content,
    author_name: 'codex',
    role: 'user',
    author_type: 'human',
  })
}

async function waitForFreshMessages(client, channelId, beforeIds, timeoutMs = 40000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const current = await messages(client, channelId)
    const fresh = current.filter((msg) => !beforeIds.has(msg.id))
    if (fresh.length > 0) return fresh
    await sleep(2500)
  }
  return []
}

async function waitForMatchingAgentMessages(
  client,
  channelId,
  beforeIds,
  matcher,
  timeoutMs = 40000,
) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const current = await messages(client, channelId)
    const fresh = current.filter((msg) => !beforeIds.has(msg.id))
    const hits = fresh.filter(
      (msg) => msg.author_type === 'agent' && matcher(msg),
    )
    if (hits.length > 0) return hits
    await sleep(2500)
  }
  return []
}

async function waitForFreshKnowledgeChange(client, beforeIds, matcher, timeoutMs = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const current = await knowledgeChanges(client)
    const fresh = current.filter((item) => !beforeIds.has(item.id))
    const hit = fresh.find(matcher)
    if (hit) return hit
    await sleep(2500)
  }
  return null
}

async function runF(client) {
  const summary = {}

  {
    const token = `RF1-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.test)).map((msg) => msg.id))
    await post(
      client,
      CHANNELS.test,
      `@agent Retest ${token}. Respond using a full json-action envelope for channel.post_message. Visible text must be exactly '${token} PASS'.`,
    )
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.test,
      before,
      (msg) => String(msg.content).includes(`${token} PASS`),
    )
    summary.F1 = {
      token,
      pass: hits.length === 1 && !String(hits[0].content).includes('json-action'),
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  {
    const token = `RF2-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.test)).map((msg) => msg.id))
    await post(
      client,
      CHANNELS.test,
      `@agent Retest ${token}. Use shorthand json-action only: action=channel.post_message, channel_id=this channel, payload.content='${token} PASS'. No prose outside the action.`,
    )
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.test,
      before,
      (msg) => String(msg.content).includes(`${token} PASS`),
    )
    summary.F2 = {
      token,
      pass: hits.length === 1 && !String(hits[0]?.content ?? '').includes('json-action'),
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  {
    const token = `RF3-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.test)).map((msg) => msg.id))
    await post(
      client,
      CHANNELS.test,
      `@agent Retest ${token}. Return control.noop only. Do not post any visible channel message.`,
    )
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.test,
      before,
      () => true,
      18000,
    )
    summary.F3 = {
      token,
      pass: hits.length === 0,
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  {
    const token = `RF4-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.test)).map((msg) => msg.id))
    await post(
      client,
      CHANNELS.test,
      `@agent Retest ${token}. This should be handled by @hieu. Ask @hieu to take a look in a normal visible channel message and include token ${token}.`,
    )
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.test,
      before,
      (msg) =>
        String(msg.content).includes('@hieu') &&
        String(msg.content).includes(token),
    )
    summary.F4 = {
      token,
      pass: hits.length === 1,
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  return summary
}

async function runJ(client) {
  const summary = {}

  {
    const token = `RJ1-${Date.now()}`
    const before = new Set((await knowledgeChanges(client)).map((item) => item.id))
    await post(
      client,
      CHANNELS.file,
      `@agent Retest ${token}. Propose a knowledge change for this file. Add one bullet under Purpose saying Codex and Knotwork can coordinate through MCP. Put ${token} in the reason.`,
    )
    const hit = await waitForFreshKnowledgeChange(
      client,
      before,
      (item) =>
        String(item.path ?? item.target_path).includes('writing/codex-mcp-note.md') &&
        JSON.stringify(item).includes(token),
    )
    summary.J1 = {
      token,
      pass: Boolean(hit),
      proposal: hit,
    }
  }

  {
    const token = `RJ2-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.folder)).map((msg) => msg.id))
    await post(
      client,
      CHANNELS.folder,
      `@agent Retest ${token}. Based on the attached skills folder, recommend one skill to audit first and mention at least two real folder names from that folder. Include token ${token}.`,
    )
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.folder,
      before,
      (msg) =>
        String(msg.content).includes(token) &&
        (String(msg.content).includes('build-landing-page') ||
          String(msg.content).includes('document-text-extract')),
    )
    summary.J2 = {
      token,
      pass: hits.length >= 1,
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  {
    const token = `RJ3-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.run)).map((msg) => msg.id))
    await post(
      client,
      CHANNELS.run,
      `@agent Retest ${token}. What happened in this run? Mention the run status and whether there was an escalation. Include token ${token}.`,
    )
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.run,
      before,
      (msg) =>
        String(msg.content).includes(token) &&
        (String(msg.content).toLowerCase().includes('completed') ||
          String(msg.content).toLowerCase().includes('resolved') ||
          String(msg.content).toLowerCase().includes('escalation')),
    )
    summary.J3 = {
      token,
      pass: hits.length >= 1,
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  summary.J4 = {
    blocked: true,
    reason: 'No open escalation available in workspace during retest.',
  }

  return summary
}

async function runL(client) {
  const summary = {}

  {
    const token = `RL1-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.test)).map((msg) => msg.id))
    await post(client, CHANNELS.test, `@agent Retest ${token}. Reply with exactly '${token} mention'.`)
    await sleep(1500)
    await post(client, CHANNELS.test, `Retest ${token}. This is a normal non-mention follow-up in the same channel.`)
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.test,
      before,
      (msg) => String(msg.content).includes(token),
      25000,
    )
    summary.L1 = {
      token,
      pass: hits.length <= 2,
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  {
    const token = `RL3-${Date.now()}`
    const before = new Set((await messages(client, CHANNELS.test)).map((msg) => msg.id))
    await post(client, CHANNELS.test, `@agent Retest ${token}. Give me one short sentence about software testing and include token ${token}.`)
    const hits = await waitForMatchingAgentMessages(
      client,
      CHANNELS.test,
      before,
      (msg) => String(msg.content).includes(token),
    )
    summary.L3 = {
      token,
      pass: hits.length >= 1,
      hitCount: hits.length,
      contents: hits.map((msg) => msg.content),
    }
  }

  return summary
}

const client = await connectClient()
const command = process.argv[2]
let result
if (command === 'F') result = await runF(client)
else if (command === 'J') result = await runJ(client)
else if (command === 'L') result = await runL(client)
else throw new Error(`Unknown command: ${command}`)
console.log(JSON.stringify(result, null, 2))
await client.close()
