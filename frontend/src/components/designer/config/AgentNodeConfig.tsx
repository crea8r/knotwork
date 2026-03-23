/**
 * Config panel for the unified 'agent' node type.
 * trust_level is now a float 0.0–1.0 (shown as a slider).
 * Confidence threshold, confidence rules, and checkpoints have been removed.
 */
import { useKnowledgeFiles } from '@/api/knowledge'
import { useRegisteredAgents } from '@/api/agents'

interface Props {
  node: {
    agent_ref?: string
    trust_level?: number
    registered_agent_id?: string | null
    config: Record<string, unknown>
  }
  onChange: (nodeFieldsPatch: Record<string, unknown>, configPatch?: Record<string, unknown>) => void
  predecessorNodes: { id: string; name: string }[]
}

const TRUST_LABELS: [number, string][] = [
  [0.0, 'Always ask'],
  [0.5, 'Supervised'],
  [1.0, 'Fully autonomous'],
]

function trustLabel(val: number): string {
  if (val <= 0.1) return 'Always ask'
  if (val >= 0.9) return 'Fully autonomous'
  if (val <= 0.4) return 'Low autonomy'
  if (val <= 0.6) return 'Supervised'
  return 'High autonomy'
}

export default function AgentNodeConfig({ node, onChange }: Props) {
  const { data: files = [] } = useKnowledgeFiles()
  const { data: agents = [] } = useRegisteredAgents()
  const config = node.config

  const registeredAgentId = node.registered_agent_id ?? null
  const agentRef = node.agent_ref ?? ''
  const isHuman = agentRef === 'human'
  const trustLevel: number = typeof node.trust_level === 'number' ? node.trust_level : 0.5

  const paths: string[] = (config.knowledge_paths as string[]) ?? []

  const setField = (patch: Record<string, unknown>) => onChange(patch)
  const setConfig = (patch: Record<string, unknown>) => onChange({}, patch)

  const selectValue = isHuman ? 'human' : (registeredAgentId ?? '')
  const selectedAgent = registeredAgentId ? agents.find(a => a.id === registeredAgentId) : undefined
  const agentNotFound = !!registeredAgentId && !selectedAgent && !isHuman
  const selectableAgents = agents.filter((a) => a.status !== 'archived')

  function handleAgentSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === 'human') {
      setField({ agent_ref: 'human', registered_agent_id: null })
    } else if (val === '') {
      setField({ agent_ref: '', registered_agent_id: null })
    } else {
      const agent = agents.find(a => a.id === val)
      if (agent) setField({ agent_ref: 'openclaw', registered_agent_id: agent.id })
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Agent selector */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Agent</label>
        <select
          className="border rounded px-2 py-1 text-sm w-full bg-white"
          value={selectValue}
          onChange={handleAgentSelect}
        >
          <option value="">— Select agent —</option>
          <option value="human">Human (always ask)</option>
          {selectableAgents.map(a => (
            <option key={a.id} value={a.id}>
              {a.display_name}{a.status !== 'active' ? ` (${a.status})` : ''}
            </option>
          ))}
        </select>
        {agentNotFound && (
          <p className="text-xs text-amber-600 mt-1">
            The previously selected agent was removed. Please select a new one.
          </p>
        )}
        {selectableAgents.length === 0 && (
          <p className="text-xs text-gray-400 mt-1">
            No agents registered yet.{' '}
            <a href="/settings?tab=agents" className="text-brand-500 hover:underline">
              Go to Settings → Agents to add one.
            </a>
          </p>
        )}
      </div>

      {/* Trust level slider (not shown for human nodes) */}
      {!isHuman && (
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs text-gray-500">Autonomy level</label>
            <span className="text-xs font-medium text-gray-700">
              {trustLevel.toFixed(1)} — {trustLabel(trustLevel)}
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.1}
            className="w-full accent-brand-500"
            value={trustLevel}
            onChange={e => setField({ trust_level: parseFloat(e.target.value) })}
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5">
            {TRUST_LABELS.map(([v, label]) => (
              <span key={v}>{label}</span>
            ))}
          </div>
        </div>
      )}

      {/* System prompt / question */}
      {!isHuman
        ? <div>
            <label className="block text-xs text-gray-500 mb-1">System prompt</label>
            <textarea className="border rounded px-2 py-1 text-sm w-full h-24 resize-y"
              value={(config.system_prompt as string) ?? ''}
              onChange={e => setConfig({ system_prompt: e.target.value })} />
          </div>
        : <div>
            <label className="block text-xs text-gray-500 mb-1">Question for operator</label>
            <textarea className="border rounded px-2 py-1 text-sm w-full h-16 resize-y"
              placeholder="Awaiting human review."
              value={(config.question as string) ?? ''}
              onChange={e => setConfig({ question: e.target.value })} />
          </div>
      }

      {/* Knowledge paths */}
      {!isHuman && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Knowledge paths (Handbook)</label>
          <div className="max-h-28 overflow-y-auto border rounded p-1 space-y-0.5">
            {files.length === 0 && <p className="text-xs text-gray-400 p-1">No files yet.</p>}
            {files.map(f => (
              <label key={f.path} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 rounded">
                <input type="checkbox" checked={paths.includes(f.path)}
                  onChange={() => setConfig({
                    knowledge_paths: paths.includes(f.path)
                      ? paths.filter(p => p !== f.path)
                      : [...paths, f.path]
                  })} />
                <span className="font-mono">{f.path}</span>
              </label>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
