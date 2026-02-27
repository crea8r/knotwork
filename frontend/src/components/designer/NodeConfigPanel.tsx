/**
 * NodeConfigPanel — dispatches to the correct per-type config form.
 * Shown in the right sidebar when a node is selected on the canvas.
 */
import type { NodeDef } from '@/types'
import LlmAgentConfig from './config/LlmAgentConfig'
import HumanCheckpointConfig from './config/HumanCheckpointConfig'
import ConditionalRouterConfig from './config/ConditionalRouterConfig'
import ToolExecutorConfig from './config/ToolExecutorConfig'

interface Props {
  node: NodeDef
  allNodes: NodeDef[]
  onConfigChange: (nodeId: string, patch: Record<string, unknown>) => void
  onRemove: (nodeId: string) => void
}

const TYPE_LABEL: Record<string, string> = {
  llm_agent: 'LLM Agent',
  human_checkpoint: 'Human Checkpoint',
  conditional_router: 'Conditional Router',
  tool_executor: 'Tool Executor',
}

export default function NodeConfigPanel({ node, allNodes, onConfigChange, onRemove }: Props) {
  function handleChange(patch: Record<string, unknown>) {
    onConfigChange(node.id, patch)
  }

  const otherNodes = allNodes.filter(n => n.id !== node.id)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-medium text-gray-900 text-sm">{node.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{TYPE_LABEL[node.type] ?? node.type}</p>
            <p className="text-xs font-mono text-gray-300 mt-0.5">{node.id}</p>
          </div>
          <button
            onClick={() => onRemove(node.id)}
            className="text-xs text-red-400 hover:text-red-600 mt-0.5"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Config form */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {node.type === 'llm_agent' && (
          <LlmAgentConfig config={node.config} onChange={handleChange} />
        )}
        {node.type === 'human_checkpoint' && (
          <HumanCheckpointConfig config={node.config} onChange={handleChange} />
        )}
        {node.type === 'conditional_router' && (
          <ConditionalRouterConfig
            config={node.config}
            onChange={handleChange}
            allNodes={otherNodes}
          />
        )}
        {node.type === 'tool_executor' && (
          <ToolExecutorConfig config={node.config} onChange={handleChange} />
        )}
      </div>
    </div>
  )
}
