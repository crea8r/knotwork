type GraphNode = {
  id: string
  type: string
  name: string
  config?: Record<string, unknown>
  note?: string | null
  agent_ref?: string | null
  trust_level?: number
  registered_agent_id?: string | null
  operator_id?: string | null
  supervisor_id?: string | null
}

type GraphEdge = {
  id: string
  source: string
  target: string
  type?: string
  condition_label?: string | null
}

type GraphInputField = {
  name: string
  label: string
  description?: string
  required?: boolean
  type?: 'text' | 'textarea' | 'number'
}

type GraphDefinition = {
  nodes?: GraphNode[]
  edges?: GraphEdge[]
  entry_point?: string | null
  input_schema?: GraphInputField[]
}

export type GraphDelta = {
  add_nodes?: GraphNode[]
  update_nodes?: Array<Partial<GraphNode> & { id: string }>
  remove_nodes?: string[]
  add_edges?: GraphEdge[]
  remove_edges?: string[]
  set_entry_point?: string | null
  set_input_schema?: GraphInputField[]
}

function normalizeNode(node: GraphNode): GraphNode {
  return {
    ...node,
    config: typeof node.config === 'object' && node.config && !Array.isArray(node.config)
      ? { ...node.config }
      : {},
  }
}

function normalizeEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    type: typeof edge.type === 'string' && edge.type.trim() ? edge.type : 'direct',
    condition_label: typeof edge.condition_label === 'string' && edge.condition_label.trim()
      ? edge.condition_label.trim()
      : undefined,
  }
}

function normalizeInputField(field: GraphInputField): GraphInputField {
  return {
    name: field.name,
    label: field.label,
    description: typeof field.description === 'string' ? field.description : '',
    required: typeof field.required === 'boolean' ? field.required : true,
    type: field.type === 'textarea' || field.type === 'number' ? field.type : 'text',
  }
}

function cloneDefinition(definition: Record<string, unknown> | null | undefined): Required<GraphDefinition> {
  const base = (definition && typeof definition === 'object' && !Array.isArray(definition))
    ? definition as GraphDefinition
    : {}
  return {
    nodes: Array.isArray(base.nodes) ? base.nodes.map((node) => normalizeNode(node)) : [],
    edges: Array.isArray(base.edges) ? base.edges.map((edge) => normalizeEdge(edge)) : [],
    entry_point: typeof base.entry_point === 'string' ? base.entry_point : null,
    input_schema: Array.isArray(base.input_schema) ? base.input_schema.map((field) => normalizeInputField(field)) : [],
  }
}

function ensureBoundaryNodes(definition: Required<GraphDefinition>): Required<GraphDefinition> {
  const hasStart = definition.nodes.some((node) => node.type === 'start' && node.id === 'start')
  const hasEnd = definition.nodes.some((node) => node.type === 'end' && node.id === 'end')
  const workNodes = definition.nodes.filter((node) => node.type !== 'start' && node.type !== 'end')

  if (workNodes.length === 0) {
    return definition
  }

  if (!hasStart) {
    definition.nodes.unshift({ id: 'start', type: 'start', name: 'Start', config: {} })
  }
  if (!hasEnd) {
    definition.nodes.push({ id: 'end', type: 'end', name: 'End', config: {} })
  }

  const edgeExists = (source: string, target: string) =>
    definition.edges.some((edge) => edge.source === source && edge.target === target)

  const firstWorkNode = workNodes[0]?.id ?? null
  if (firstWorkNode && !definition.edges.some((edge) => edge.source === 'start')) {
    definition.edges.unshift({
      id: `e-start-${firstWorkNode}`,
      source: 'start',
      target: firstWorkNode,
      type: 'direct',
    })
  }

  const endIncoming = new Set(
    definition.edges
      .filter((edge) => edge.target === 'end')
      .map((edge) => edge.source),
  )
  const workOutgoing = new Map<string, number>()
  for (const edge of definition.edges) {
    if (edge.source !== 'start' && edge.source !== 'end') {
      workOutgoing.set(edge.source, (workOutgoing.get(edge.source) ?? 0) + 1)
    }
  }
  for (const node of definition.nodes) {
    if (node.type === 'start' || node.type === 'end') continue
    if ((workOutgoing.get(node.id) ?? 0) === 0 && !endIncoming.has(node.id)) {
      definition.edges.push({
        id: `e-${node.id}-end`,
        source: node.id,
        target: 'end',
        type: 'direct',
      })
    }
  }

  return definition
}

export function applyGraphDelta(
  currentDefinition: Record<string, unknown> | null | undefined,
  deltaInput: Record<string, unknown>,
): Record<string, unknown> {
  const definition = cloneDefinition(currentDefinition)
  const delta = deltaInput as GraphDelta

  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]))
  const edgesById = new Map(definition.edges.map((edge) => [edge.id, edge]))

  for (const nodeId of Array.isArray(delta.remove_nodes) ? delta.remove_nodes : []) {
    nodesById.delete(nodeId)
  }

  for (const node of Array.isArray(delta.add_nodes) ? delta.add_nodes : []) {
    nodesById.set(node.id, normalizeNode(node))
  }

  for (const update of Array.isArray(delta.update_nodes) ? delta.update_nodes : []) {
    const existing = nodesById.get(update.id) ?? {
      id: update.id,
      type: 'agent',
      name: update.id,
      config: {},
    }
    const next: GraphNode = {
      ...existing,
      config: { ...(existing.config ?? {}) },
    }
    if (typeof update.name === 'string') next.name = update.name
    if (typeof update.type === 'string') next.type = update.type
    if ('note' in update) next.note = update.note ?? null
    if ('agent_ref' in update) next.agent_ref = update.agent_ref ?? null
    if ('trust_level' in update && typeof update.trust_level === 'number') next.trust_level = update.trust_level
    if ('registered_agent_id' in update) next.registered_agent_id = update.registered_agent_id ?? null
    if ('operator_id' in update) next.operator_id = update.operator_id ?? null
    if ('supervisor_id' in update) next.supervisor_id = update.supervisor_id ?? null
    if (typeof update.config === 'object' && update.config && !Array.isArray(update.config)) {
      next.config = { ...(existing.config ?? {}), ...update.config }
    }
    nodesById.set(update.id, next)
  }

  for (const edgeId of Array.isArray(delta.remove_edges) ? delta.remove_edges : []) {
    edgesById.delete(edgeId)
  }

  for (const edge of Array.isArray(delta.add_edges) ? delta.add_edges : []) {
    edgesById.set(edge.id, normalizeEdge(edge))
  }

  definition.nodes = Array.from(nodesById.values())
  definition.edges = Array.from(edgesById.values()).filter((edge) => (
    nodesById.has(edge.source) && nodesById.has(edge.target)
  ))

  if ('set_entry_point' in delta) {
    definition.entry_point = typeof delta.set_entry_point === 'string' ? delta.set_entry_point : null
  }

  if (Array.isArray(delta.set_input_schema)) {
    definition.input_schema = delta.set_input_schema.map((field) => normalizeInputField(field))
  }

  const normalized = ensureBoundaryNodes(definition)
  return {
    nodes: normalized.nodes,
    edges: normalized.edges,
    entry_point: normalized.entry_point,
    input_schema: normalized.input_schema,
  }
}
