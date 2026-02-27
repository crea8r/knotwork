/**
 * Config panel for human_checkpoint nodes.
 * Fields: prompt, timeout_hours.
 */
interface Props {
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}

export default function HumanCheckpointConfig({ config, onChange }: Props) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Reviewer prompt</label>
        <textarea
          className="border rounded px-2 py-1 text-sm w-full h-28 resize-y"
          placeholder="Instructions shown to the reviewer when this checkpoint is reached…"
          value={(config.prompt as string) ?? ''}
          onChange={e => onChange({ prompt: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Timeout (hours)</label>
        <input
          type="number" min={1} max={720}
          className="border rounded px-2 py-1 text-sm w-32"
          value={(config.timeout_hours as number) ?? 24}
          onChange={e => onChange({ timeout_hours: parseInt(e.target.value, 10) })}
        />
        <p className="text-xs text-gray-400 mt-1">
          Run stops if no action is taken within this window.
        </p>
      </div>
    </div>
  )
}
