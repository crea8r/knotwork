import test from 'node:test'
import assert from 'node:assert/strict'

import { applyGraphDelta } from './graph-delta.js'

test('applyGraphDelta adds workflow nodes and wires start/end when missing', () => {
  const next = applyGraphDelta(
    { nodes: [], edges: [], input_schema: [] },
    {
      add_nodes: [
        { id: 'review-brief', type: 'agent', name: 'Review Brief', config: {} },
      ],
      set_input_schema: [
        { name: 'topic', label: 'Topic', description: '', required: true, type: 'text' },
      ],
    },
  ) as {
    nodes: Array<{ id: string; type: string }>
    edges: Array<{ source: string; target: string }>
    input_schema: Array<{ name: string }>
  }

  assert.deepEqual(
    next.nodes.map((node) => node.id),
    ['start', 'review-brief', 'end'],
  )
  assert.deepEqual(
    next.edges.map((edge) => [edge.source, edge.target]),
    [['start', 'review-brief'], ['review-brief', 'end']],
  )
  assert.equal(next.input_schema[0]?.name, 'topic')
})

test('applyGraphDelta merges node config and removes dangling edges', () => {
  const next = applyGraphDelta(
    {
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: {} },
        { id: 'writer', type: 'agent', name: 'Writer', config: { system_prompt: 'old' } },
        { id: 'end', type: 'end', name: 'End', config: {} },
      ],
      edges: [
        { id: 'e-start-writer', source: 'start', target: 'writer', type: 'direct' },
        { id: 'e-writer-end', source: 'writer', target: 'end', type: 'direct' },
      ],
      input_schema: [],
    },
    {
      update_nodes: [
        { id: 'writer', config: { system_prompt: 'new', model: 'openai/gpt-4o' } },
      ],
      remove_nodes: ['end'],
    },
  ) as {
    nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>
    edges: Array<{ source: string; target: string }>
  }

  const writer = next.nodes.find((node) => node.id === 'writer')
  assert.ok(writer)
  assert.equal(writer?.config.system_prompt, 'new')
  assert.equal(writer?.config.model, 'openai/gpt-4o')
  assert.ok(next.nodes.some((node) => node.id === 'end'))
  assert.deepEqual(
    next.edges.map((edge) => [edge.source, edge.target]),
    [['start', 'writer'], ['writer', 'end']],
  )
})
