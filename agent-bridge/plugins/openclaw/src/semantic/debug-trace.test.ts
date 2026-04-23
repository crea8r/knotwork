import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SemanticDebugTrace } from './debug-trace.js'

test('SemanticDebugTrace persists only delivered prompts and replies', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'knotwork-debug-trace-'))
  try {
    const trace = new SemanticDebugTrace({
      enabled: true,
      rootDir,
      taskId: 'delivery:test-debug',
      sessionName: 'channel:test',
    })

    await trace.writeSection('Knotwork Work Packet', { task_id: 'delivery:test-debug', trigger: { type: 'mentioned_message' } })
    await trace.writeMarkdownSection('Knotwork MCP Contract Markdown', '# Contract\n\nBody')
    await trace.writeDelivery({
      iteration: 'Task Phase 1',
      message: 'User prompt body',
      extraSystemPrompt: 'System prompt body',
    })
    await trace.writeReply({
      iteration: 'Task Phase 1',
      reply: '{"type":"fail","error":"Insufficient task context"}',
    })
    await trace.writeError(new Error('boom'))

    const body = await readFile(trace.filePath, 'utf8')
    assert.match(body, /## Task Phase 1/)
    assert.match(body, /### Agent System Prompt/)
    assert.match(body, /System prompt body/)
    assert.match(body, /### Agent User Prompt/)
    assert.match(body, /User prompt body/)
    assert.match(body, /### Agent Raw Reply/)
    assert.match(body, /Insufficient task context/)
    assert.doesNotMatch(body, /Knotwork Work Packet/)
    assert.doesNotMatch(body, /Knotwork MCP Contract Markdown/)
    assert.doesNotMatch(body, /boom/)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
