/**
 * Config panel for the unified 'agent' node type (S7).
 * Also handles legacy llm_agent / human_checkpoint / conditional_router nodes.
 *
 * Fields: agent_ref, trust_level, system_prompt, knowledge_paths,
 *         input_sources, confidence_threshold, confidence_rules, checkpoints.
 *
 * S7.1: agent dropdown is populated from workspace registered agents.
 *       Both registered_agent_id (credential lookup) and agent_ref (routing)
 *       are stored on the node.
 */
import { useKnowledgeFiles } from '@/api/knowledge'
import { useRegisteredAgents } from '@/api/agents'
import type { TrustLevel } from '@/types'
import { CheckpointsEditor, RulesEditor } from './RulesEditor'
import type { Checkpoint, Rule } from './RulesEditor'

interface Props {
  node: {
    agent_ref?: string
    trust_level?: TrustLevel
    registered_agent_id?: string | null
    config: Record<string, unknown>
  }
  onChange: (nodeFieldsPatch: Record<string, unknown>, configPatch?: Record<string, unknown>) => void
  predecessorNodes: { id: string; name: string }[]
}

const TRUST_LEVELS: { value: TrustLevel; label: string }[] = [
  { value: 'user_controlled', label: 'User controlled' },
  { value: 'supervised',      label: 'Supervised' },
  { value: 'autonomous',      label: 'Autonomous' },
]

export default function AgentNodeConfig({ node, onChange, predecessorNodes }: Props) {
  const { data: files = [] } = useKnowledgeFiles()
  const { data: agents = [] } = useRegisteredAgents()
  const config = node.config

  const registeredAgentId = node.registered_agent_id ?? null
  const agentRef = node.agent_ref ?? ''
  const isHuman = agentRef === 'human'
  const trustLevel: TrustLevel = node.trust_level ?? 'supervised'

  const paths: string[] = (config.knowledge_paths as string[]) ?? []
  const rules: Rule[] = (config.confidence_rules as Rule[]) ?? []
  const checkpoints: Checkpoint[] = (config.checkpoints as Checkpoint[]) ?? []
  const allSourceIds = ['run_input', ...predecessorNodes.map(n => n.id)]
  const explicitSources = config.input_sources as string[] | undefined
  const activeSources = new Set(explicitSources ?? allSourceIds)

  const setField = (patch: Record<string, unknown>) => onChange(patch)
  const setConfig = (patch: Record<string, unknown>) => onChange({}, patch)

  function toggleSource(id: string) {
    const next = activeSources.has(id)
      ? allSourceIds.filter(s => s !== id && activeSources.has(s))
      : [...allSourceIds.filter(s => activeSources.has(s)), id]
    setConfig({ input_sources: next.length === allSourceIds.length ? undefined : next })
  }

  // Determine the current select value
  const selectValue = isHuman ? 'human' : (registeredAgentId ?? '')

  // Detect stale reference — registered_agent_id set but agent deleted/not found
  const selectedAgent = registeredAgentId
    ? agents.find(a => a.id === registeredAgentId)
    : undefined
  const agentNotFound = !!registeredAgentId && !selectedAgent && !isHuman
  const selectableAgents = agents.filter((a) => {
    if (a.status === 'active') return true
    return !!registeredAgentId && a.id === registeredAgentId
  })

  function handleAgentSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === 'human') {
      setField({ agent_ref: 'human', registered_agent_id: null })
    } else if (val === '') {
      setField({ agent_ref: '', registered_agent_id: null })
    } else {
      const agent = agents.find(a => a.id === val)
      if (agent) {
        setField({ agent_ref: agent.agent_ref, registered_agent_id: agent.id })
      }
    }
  }

  return (
    <div className="space-y-4 text-sm">
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
            <option key={a.id} value={a.id}>{a.display_name}</option>
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
            <span className="text-brand-500">Go to Settings → Agents to add one.</span>
          </p>
        )}
      </div>

      {!isHuman && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Trust level</label>
          <div className="flex rounded border overflow-hidden text-xs">
            {TRUST_LEVELS.map(t => (
              <button key={t.value} onClick={() => setField({ trust_level: t.value })}
                className={`flex-1 px-2 py-1 transition-colors ${trustLevel === t.value ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isHuman
        ? <div><label className="block text-xs text-gray-500 mb-1">System prompt</label>
            <textarea className="border rounded px-2 py-1 text-sm w-full h-24 resize-y"
              value={(config.system_prompt as string) ?? ''}
              onChange={e => setConfig({ system_prompt: e.target.value })} /></div>
        : <div><label className="block text-xs text-gray-500 mb-1">Question for operator</label>
            <textarea className="border rounded px-2 py-1 text-sm w-full h-16 resize-y" placeholder="Awaiting human review."
              value={(config.question as string) ?? ''}
              onChange={e => setConfig({ question: e.target.value })} /></div>
      }

      {!isHuman && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Knowledge paths (Handbook)</label>
          <div className="max-h-28 overflow-y-auto border rounded p-1 space-y-0.5">
            {files.length === 0 && <p className="text-xs text-gray-400 p-1">No files yet.</p>}
            {files.map(f => (
              <label key={f.path} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 rounded">
                <input type="checkbox" checked={paths.includes(f.path)}
                  onChange={() => setConfig({ knowledge_paths: paths.includes(f.path) ? paths.filter(p => p !== f.path) : [...paths, f.path] })} />
                <span className="font-mono">{f.path}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {!isHuman && allSourceIds.length > 1 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Input sources {explicitSources === undefined && <span className="text-gray-400">(all)</span>}
          </label>
          <div className="space-y-0.5">
            {allSourceIds.map(id => (
              <label key={id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 rounded">
                <input type="checkbox" checked={activeSources.has(id)} onChange={() => toggleSource(id)} />
                <span className="font-mono">{id === 'run_input' ? 'Run input' : predecessorNodes.find(n => n.id === id)?.name ?? id}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {!isHuman && <>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Confidence threshold</label>
          <input type="number" min={0} max={1} step={0.05} className="border rounded px-2 py-1 text-sm w-32"
            value={(config.confidence_threshold as number) ?? 0.7}
            onChange={e => setConfig({ confidence_threshold: parseFloat(e.target.value) })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Confidence rules</label>
          <RulesEditor rules={rules} onChange={r => setConfig({ confidence_rules: r })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-2">Checkpoints</label>
          <CheckpointsEditor checkpoints={checkpoints} onChange={c => setConfig({ checkpoints: c })} />
        </div>
      </>}
    </div>
  )
}
