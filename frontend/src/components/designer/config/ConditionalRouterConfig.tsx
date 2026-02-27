/**
 * Config panel for conditional_router nodes.
 * Fields: routing_rules [{condition, target}], default_target.
 */
import type { EdgeDef, NodeDef } from '@/types'

interface RoutingRule { condition: string; target: string }

interface Props {
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
  /** All nodes in the graph — used to populate target dropdowns. */
  allNodes: NodeDef[]
}

export default function ConditionalRouterConfig({ config, onChange, allNodes }: Props) {
  const rules: RoutingRule[] = (config.routing_rules as RoutingRule[]) ?? []
  const defaultTarget: string = (config.default_target as string) ?? ''

  function addRule() {
    onChange({ routing_rules: [...rules, { condition: '', target: '' }] })
  }
  function removeRule(i: number) {
    onChange({ routing_rules: rules.filter((_, j) => j !== i) })
  }
  function updateRule(i: number, r: RoutingRule) {
    onChange({ routing_rules: rules.map((x, j) => j === i ? r : x) })
  }

  const nodeOptions = allNodes.map(n => (
    <option key={n.id} value={n.id}>{n.name}</option>
  ))

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block text-xs text-gray-500 mb-2">
          Routing rules <span className="text-gray-400">(evaluated top-to-bottom, first match wins)</span>
        </label>
        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <input
                className="border rounded px-2 py-1 text-xs font-mono"
                placeholder="state.score > 0.8"
                value={r.condition}
                onChange={e => updateRule(i, { ...r, condition: e.target.value })}
              />
              <select
                className="border rounded px-2 py-1 text-xs"
                value={r.target}
                onChange={e => updateRule(i, { ...r, target: e.target.value })}
              >
                <option value="">— target —</option>
                {nodeOptions}
              </select>
              <button onClick={() => removeRule(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
            </div>
          ))}
          <button onClick={addRule} className="text-xs text-blue-600 hover:underline">+ Add rule</button>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Default target (no rule matches)</label>
        <select
          className="border rounded px-2 py-1 text-sm w-full"
          value={defaultTarget}
          onChange={e => onChange({ default_target: e.target.value })}
        >
          <option value="">— none (stop) —</option>
          {nodeOptions}
        </select>
      </div>
    </div>
  )
}
