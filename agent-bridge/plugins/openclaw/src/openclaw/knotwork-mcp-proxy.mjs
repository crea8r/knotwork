#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import process from 'node:process';

import { createKnotworkMcpClient } from '@knotwork/mcp-client';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const LOG_PATH = process.env.KNOTWORK_MCP_PROXY_LOG_PATH || '/tmp/knotwork-mcp-proxy.log';
const BACKEND_URL = requireEnv('KNOTWORK_BACKEND_URL');
const WORKSPACE_ID = requireEnv('KNOTWORK_WORKSPACE_ID');
const PRIVATE_KEY_PATH = String(process.env.KNOTWORK_PRIVATE_KEY_PATH || '').trim();
const BEARER_TOKEN = String(process.env.KNOTWORK_BEARER_TOKEN || '').trim();

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function log(event, payload = {}) {
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`);
  } catch {
    // Best-effort file logging only. Never write to stdout in a stdio MCP server.
  }
}

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return args;
  const summary = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      summary[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
      continue;
    }
    summary[key] = value;
  }
  return summary;
}

function asText(value) {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value, null, 2);
    if (typeof json === 'string') return json;
  } catch {
    // Fall through to String(value).
  }
  return String(value);
}

function buildToolResult(value) {
  const content = [{ type: 'text', text: asText(value) }];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { content, structuredContent: value };
  }
  return { content };
}

async function main() {
  log('startup', {
    backendUrl: BACKEND_URL,
    workspaceId: WORKSPACE_ID,
    authMode: BEARER_TOKEN ? 'bearer' : PRIVATE_KEY_PATH ? 'private_key' : 'missing',
  });

  const client = await createKnotworkMcpClient({
    backendUrl: BACKEND_URL,
    workspaceId: WORKSPACE_ID,
    ...(BEARER_TOKEN ? { bearerToken: BEARER_TOKEN } : { privateKeyPath: PRIVATE_KEY_PATH }),
    clientInfo: {
      name: 'openclaw-knotwork-global-proxy',
      version: '0.1.0',
    },
  });
  await client.connect();
  log('connected', {
    mcpServerUrl: client.discovery?.mcp_server_url ?? null,
  });

  const server = new Server(
    {
      name: 'knotwork',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await client.listTools();
    log('tools/list', {
      count: tools.length,
      names: tools.map((tool) => tool.name),
    });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = String(request.params?.name || '');
    const args = request.params?.arguments ?? {};
    log('tools/call:start', {
      name,
      args: summarizeArgs(args),
    });
    try {
      const result = await client.callTool(name, args);
      log('tools/call:ok', {
        name,
        resultType: Array.isArray(result) ? 'array' : typeof result,
      });
      return buildToolResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('tools/call:error', {
        name,
        error: message,
      });
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const shutdown = (signal) => {
    log('shutdown', { signal });
    void client.close().finally(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('ready');
}

main().catch((error) => {
  log('fatal', {
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
