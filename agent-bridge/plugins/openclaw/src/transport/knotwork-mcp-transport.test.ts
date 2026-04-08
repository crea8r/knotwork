import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMessageResponsePolicy } from './knotwork-mcp-transport.js'
import type { ChannelMessage, ParticipantInfo, TaskTrigger, WorkspaceMemberInfo } from '../types'

const self: WorkspaceMemberInfo = {
  id: 'agent-self',
  user_id: 'user-self',
  participant_id: 'agent:agent-self',
  name: 'OpenClaw Agent',
  email: null,
  role: 'operator',
  kind: 'agent',
  avatar_url: null,
  bio: null,
  agent_zero_role: false,
  contribution_brief: 'Landing page agent.',
  joined_at: '2026-04-08T00:00:00Z',
  access_disabled_at: null,
}

const participants: ParticipantInfo[] = [
  {
    participant_id: 'agent:agent-self',
    display_name: 'OpenClaw Agent',
    mention_handle: 'agent',
    kind: 'agent',
    contribution_brief: 'Landing page agent.',
  },
  {
    participant_id: 'agent:codex',
    display_name: 'codex',
    mention_handle: 'codex',
    kind: 'agent',
    contribution_brief: 'Coding assistant.',
  },
]

function trigger(subtitle: string): TaskTrigger {
  return {
    type: 'message_posted',
    channel_id: 'channel-1',
    delivery_id: 'delivery-1',
    run_id: null,
    escalation_id: null,
    proposal_id: null,
    title: 'New message',
    subtitle,
  }
}

function message(id: string, content: string, metadata: Record<string, unknown> = {}): ChannelMessage {
  return {
    id,
    channel_id: 'channel-1',
    role: 'user',
    author_type: 'human',
    author_name: 'Hieu',
    content,
    metadata_: metadata,
    created_at: '2026-04-08T00:00:00Z',
  }
}

test('message_posted directly mentioning this agent must answer', () => {
  const policy = buildMessageResponsePolicy({
    trigger: trigger('@agent can you review this?'),
    agentSelf: self,
    participants,
    messages: [message('m1', '@agent can you review this?')],
  })

  assert.equal(policy?.decision, 'must_answer')
  assert.equal(policy?.directlyMentionedSelf, true)
  assert.deepEqual(policy?.mentionedOtherParticipantIds, [])
})

test('message_posted mentioning another member must no-op', () => {
  const policy = buildMessageResponsePolicy({
    trigger: trigger('@codex can you review this?'),
    agentSelf: self,
    participants,
    messages: [message('m1', '@codex can you review this?')],
  })

  assert.equal(policy?.decision, 'must_noop')
  assert.equal(policy?.directlyMentionedSelf, false)
  assert.deepEqual(policy?.mentionedOtherParticipantIds, ['agent:codex'])
})

test('unmentioned message lets model decide and records recent involvement', () => {
  const policy = buildMessageResponsePolicy({
    trigger: trigger('what is the landing page status?'),
    agentSelf: self,
    participants,
    messages: [
      message('m0', 'I can take the landing page.', {
        author_participant_id: 'agent:agent-self',
      }),
      message('m1', 'what is the landing page status?'),
    ],
  })

  assert.equal(policy?.decision, 'model_decides')
  assert.equal(policy?.recentlyInvolved, true)
  assert.equal(policy?.mentionedParticipantIds.length, 0)
})

test('mentioned participant metadata takes precedence over text aliases', () => {
  const policy = buildMessageResponsePolicy({
    trigger: trigger('@random review this'),
    agentSelf: self,
    participants,
    messages: [
      message('m1', '@random review this', {
        mentioned_participant_ids: ['agent:codex'],
      }),
    ],
  })

  assert.equal(policy?.decision, 'must_noop')
  assert.deepEqual(policy?.mentionedParticipantIds, ['agent:codex'])
})
