/** Reusable confidence rules and checkpoint editors for AgentNodeConfig. */
export interface Rule { condition: string; set: number }
export interface Checkpoint { type: 'expression' | 'human'; expression?: string }

export function RulesEditor({ rules, onChange }: {
  rules: Rule[]
  onChange: (rules: Rule[]) => void
}) {
  function update(i: number, r: Rule) { onChange(rules.map((x, j) => j === i ? r : x)) }
  return (
    <div className="space-y-1">
      {rules.map((r, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input className="border rounded px-2 py-1 text-xs flex-1 font-mono" placeholder="output.score < 0.7"
            value={r.condition} onChange={e => update(i, { ...r, condition: e.target.value })} />
          <input type="number" min={0} max={1} step={0.05} className="border rounded px-2 py-1 text-xs w-16"
            value={r.set} onChange={e => update(i, { ...r, set: parseFloat(e.target.value) })} />
          <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs">✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...rules, { condition: '', set: 0.5 }])} className="text-xs text-blue-600 hover:underline">+ Add rule</button>
    </div>
  )
}

export function CheckpointsEditor({ checkpoints, onChange }: {
  checkpoints: Checkpoint[]
  onChange: (cps: Checkpoint[]) => void
}) {
  return (
    <div className="space-y-1">
      {checkpoints.map((c, i) => (
        <div key={i} className="flex gap-2 items-center">
          {c.type === 'human'
            ? <span className="text-xs text-amber-600 flex-1">Human review required</span>
            : <input className="border rounded px-2 py-1 text-xs flex-1 font-mono" placeholder="output.score >= 0.8"
                value={c.expression ?? ''} onChange={e => {
                  const next = [...checkpoints]; next[i] = { ...c, expression: e.target.value }
                  onChange(next)
                }} />
          }
          <button onClick={() => onChange(checkpoints.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs">✕</button>
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => onChange([...checkpoints, { type: 'expression', expression: '' }])} className="text-xs text-blue-600 hover:underline">+ Expression</button>
        <button onClick={() => onChange([...checkpoints, { type: 'human' }])} className="text-xs text-amber-600 hover:underline">+ Human</button>
      </div>
    </div>
  )
}
