/**
 * Config panel for tool_executor nodes.
 * Fields: tool_id, tool_config (free-form JSON).
 */
import { useState } from 'react'

interface Props {
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}

export default function ToolExecutorConfig({ config, onChange }: Props) {
  const [jsonError, setJsonError] = useState('')
  const toolConfig = config.tool_config as Record<string, unknown> | undefined

  const jsonStr = toolConfig !== undefined
    ? JSON.stringify(toolConfig, null, 2)
    : ''
  const [draft, setDraft] = useState(jsonStr)

  function handleJsonChange(value: string) {
    setDraft(value)
    if (!value.trim()) {
      setJsonError('')
      onChange({ tool_config: {} })
      return
    }
    try {
      onChange({ tool_config: JSON.parse(value) })
      setJsonError('')
    } catch {
      setJsonError('Invalid JSON')
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Tool ID</label>
        <input
          className="border rounded px-2 py-1 text-sm w-full font-mono"
          placeholder="web.search"
          value={(config.tool_id as string) ?? ''}
          onChange={e => onChange({ tool_id: e.target.value })}
        />
        <p className="text-xs text-gray-400 mt-1">
          Tool slug or UUID from the Tool Registry.
        </p>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Tool config (JSON)</label>
        <textarea
          className={`border rounded px-2 py-1 text-xs font-mono w-full h-32 resize-y ${jsonError ? 'border-red-400' : ''}`}
          value={draft}
          onChange={e => handleJsonChange(e.target.value)}
          placeholder='{"max_results": 5}'
        />
        {jsonError && <p className="text-xs text-red-500 mt-0.5">{jsonError}</p>}
      </div>
    </div>
  )
}
