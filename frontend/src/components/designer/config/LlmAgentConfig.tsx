/**
 * Config panel for llm_agent nodes.
 * Fields: model, system_prompt, knowledge_paths, confidence_threshold,
 *         fail_safe, confidence_rules, checkpoints.
 */
import { useKnowledgeFiles } from '@/api/knowledge'

interface Rule { condition: string; set: number }
interface Checkpoint { type: 'expression' | 'human'; expression?: string }

interface Props {
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
  predecessorNodes: { id: string; name: string }[]
}

function RuleList({
  rules, onAdd, onRemove, onChange,
}: {
  rules: Rule[]
  onAdd: () => void
  onRemove: (i: number) => void
  onChange: (i: number, r: Rule) => void
}) {
  return (
    <div className="space-y-1">
      {rules.map((r, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            className="border rounded px-2 py-1 text-xs flex-1 font-mono"
            placeholder="output.score < 0.7"
            value={r.condition}
            onChange={e => onChange(i, { ...r, condition: e.target.value })}
          />
          <input
            type="number" min={0} max={1} step={0.05}
            className="border rounded px-2 py-1 text-xs w-16"
            value={r.set}
            onChange={e => onChange(i, { ...r, set: parseFloat(e.target.value) })}
          />
          <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
        </div>
      ))}
      <button onClick={onAdd} className="text-xs text-blue-600 hover:underline">+ Add rule</button>
    </div>
  )
}

export default function LlmAgentConfig({ config, onChange, predecessorNodes }: Props) {
  const { data: files = [] } = useKnowledgeFiles()

  const paths: string[] = (config.knowledge_paths as string[]) ?? []
  const rules: Rule[] = (config.confidence_rules as Rule[]) ?? []
  const checkpoints: Checkpoint[] = (config.checkpoints as Checkpoint[]) ?? []

  // input_sources: undefined = all (default), string[] = explicit selection
  const allSourceIds = ['run_input', ...predecessorNodes.map(n => n.id)]
  const explicitSources = config.input_sources as string[] | undefined
  const activeSources = new Set(explicitSources ?? allSourceIds)

  function toggleSource(id: string) {
    const next = activeSources.has(id)
      ? allSourceIds.filter(s => s !== id && activeSources.has(s))
      : [...allSourceIds.filter(s => activeSources.has(s)), id]
    // If user selected everything back, revert to implicit default (undefined)
    onChange({ input_sources: next.length === allSourceIds.length ? undefined : next })
  }

  function togglePath(path: string) {
    const next = paths.includes(path) ? paths.filter(p => p !== path) : [...paths, path]
    onChange({ knowledge_paths: next })
  }

  function addRule() { onChange({ confidence_rules: [...rules, { condition: '', set: 0.5 }] }) }
  function removeRule(i: number) { onChange({ confidence_rules: rules.filter((_, j) => j !== i) }) }
  function updateRule(i: number, r: Rule) {
    onChange({ confidence_rules: rules.map((x, j) => j === i ? r : x) })
  }

  function addCheckpoint() {
    onChange({ checkpoints: [...checkpoints, { type: 'expression', expression: '' }] })
  }
  function addHumanCheckpoint() {
    onChange({ checkpoints: [...checkpoints, { type: 'human' }] })
  }
  function removeCheckpoint(i: number) {
    onChange({ checkpoints: checkpoints.filter((_, j) => j !== i) })
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Model</label>
        <input className="border rounded px-2 py-1 text-sm w-full"
          value={(config.model as string) ?? ''}
          placeholder="openai/gpt-4o"
          onChange={e => onChange({ model: e.target.value })} />
      </div>
      {allSourceIds.length > 1 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Input sources
            {explicitSources === undefined && (
              <span className="ml-1 text-gray-400">(all)</span>
            )}
          </label>
          <div className="space-y-0.5">
            <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 rounded">
              <input
                type="checkbox"
                checked={activeSources.has('run_input')}
                onChange={() => toggleSource('run_input')}
              />
              <span>Run input</span>
            </label>
            {predecessorNodes.map(n => (
              <label key={n.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 rounded">
                <input
                  type="checkbox"
                  checked={activeSources.has(n.id)}
                  onChange={() => toggleSource(n.id)}
                />
                <span className="font-mono">{n.name}</span>
                <span className="text-gray-400">output</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 mb-1">System prompt</label>
        <textarea className="border rounded px-2 py-1 text-sm w-full h-24 resize-y"
          value={(config.system_prompt as string) ?? ''}
          onChange={e => onChange({ system_prompt: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Knowledge paths (Handbook)</label>
        <div className="max-h-28 overflow-y-auto border rounded p-1 space-y-0.5">
          {files.length === 0 && <p className="text-xs text-gray-400 p-1">No files yet.</p>}
          {files.map(f => (
            <label key={f.path} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 rounded">
              <input type="checkbox" checked={paths.includes(f.path)} onChange={() => togglePath(f.path)} />
              <span className="font-mono">{f.path}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Confidence threshold</label>
          <input type="number" min={0} max={1} step={0.05}
            className="border rounded px-2 py-1 text-sm w-full"
            value={(config.confidence_threshold as number) ?? 0.7}
            onChange={e => onChange({ confidence_threshold: parseFloat(e.target.value) })} />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Fail safe</label>
          <select className="border rounded px-2 py-1 text-sm w-full"
            value={(config.fail_safe as string) ?? 'escalate'}
            onChange={e => onChange({ fail_safe: e.target.value })}>
            <option value="escalate">Escalate</option>
            <option value="retry">Retry</option>
            <option value="stop">Stop</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Confidence rules <span className="text-gray-400">(condition → set score)</span>
        </label>
        <RuleList rules={rules} onAdd={addRule} onRemove={removeRule} onChange={updateRule} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-2">Checkpoints</label>
        <div className="space-y-1">
          {checkpoints.map((c, i) => (
            <div key={i} className="flex gap-2 items-center">
              {c.type === 'human'
                ? <span className="text-xs text-amber-600 flex-1">Human review required</span>
                : <input className="border rounded px-2 py-1 text-xs flex-1 font-mono"
                    placeholder="output.score >= 0.8"
                    value={c.expression ?? ''}
                    onChange={e => {
                      const next = [...checkpoints]
                      next[i] = { ...c, expression: e.target.value }
                      onChange({ checkpoints: next })
                    }} />
              }
              <button onClick={() => removeCheckpoint(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={addCheckpoint} className="text-xs text-blue-600 hover:underline">+ Expression</button>
            <button onClick={addHumanCheckpoint} className="text-xs text-amber-600 hover:underline">+ Human</button>
          </div>
        </div>
      </div>
    </div>
  )
}
