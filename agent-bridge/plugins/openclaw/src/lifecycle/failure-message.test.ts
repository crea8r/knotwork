import assert from 'node:assert/strict'
import test from 'node:test'

import { buildChannelFailureMessage } from './failure-message.js'

test('buildChannelFailureMessage renders model auth failures with action guidance', () => {
  const message = buildChannelFailureMessage('OAuth token refresh failed for openai-codex')

  assert.match(message, /model provider authentication failed/i)
  assert.match(message, /re-authenticate/i)
})

test('buildChannelFailureMessage renders generic safe failure without runtime wording', () => {
  const message = buildChannelFailureMessage('Insufficient task context and no available Knotwork read actions')

  assert.match(message, /could not complete this task safely/i)
  assert.match(message, /Insufficient task context/)
  assert.match(message, /No Knotwork change was applied\./)
  assert.doesNotMatch(message, /OpenClaw runtime failed before any Knotwork action was taken/i)
})
