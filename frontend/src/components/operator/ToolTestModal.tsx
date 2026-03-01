/**
 * ToolTestModal — schema-driven test form for built-in and custom tools.
 * Follows fixed-header/scrollable-body/fixed-footer pattern.
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import Btn from '@/components/shared/Btn'
import Spinner from '@/components/shared/Spinner'
import { useTestBuiltin, useTestTool, type BuiltinTool, type ToolTestResponse } from '@/api/tools'

interface Props {
  workspaceId: string
  tool: BuiltinTool | { id: string; name: string; slug: string; description: string }
  isBuiltin: boolean
  onClose: () => void
}

function BuiltinInputForm({
  slug,
  input,
  onChange,
}: {
  slug: string
  input: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  const base = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'

  if (slug === 'web.search') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Search query</label>
        <input className={base} value={input.query ?? ''} onChange={e => onChange('query', e.target.value)} placeholder="e.g. latest AI news" />
      </div>
    )
  }
  if (slug === 'web.fetch') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
        <input className={base} value={input.url ?? ''} onChange={e => onChange('url', e.target.value)} placeholder="https://example.com" />
      </div>
    )
  }
  if (slug === 'calc') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Expression</label>
        <input className={base} value={input.expression ?? ''} onChange={e => onChange('expression', e.target.value)} placeholder="e.g. 2 + 2 * 10" />
      </div>
    )
  }
  if (slug === 'http.request') {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="w-24">
            <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
            <select
              className={base}
              value={input.method ?? 'GET'}
              onChange={e => onChange('method', e.target.value)}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
            <input className={base} value={input.url ?? ''} onChange={e => onChange('url', e.target.value)} placeholder="https://api.example.com/endpoint" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Headers (JSON)</label>
          <textarea className={`${base} h-16 font-mono text-xs resize-none`} value={input.headers ?? '{}'} onChange={e => onChange('headers', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Body (JSON, optional)</label>
          <textarea className={`${base} h-16 font-mono text-xs resize-none`} value={input.body ?? ''} onChange={e => onChange('body', e.target.value)} placeholder="{}" />
        </div>
      </div>
    )
  }
  // Generic fallback — JSON textarea
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Input (JSON)</label>
      <textarea className={`${base} h-28 font-mono text-xs resize-y`} value={input.__raw ?? '{}'} onChange={e => onChange('__raw', e.target.value)} />
    </div>
  )
}

export default function ToolTestModal({ workspaceId, tool, isBuiltin, onClose }: Props) {
  const [input, setInput] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ToolTestResponse | null>(null)
  const testBuiltin = useTestBuiltin(workspaceId, tool.slug)
  const testWorkspace = useTestTool(workspaceId, 'id' in tool ? tool.id : '')

  function setField(key: string, value: string) {
    setInput(prev => ({ ...prev, [key]: value }))
  }

  function buildInput(): Record<string, unknown> {
    if (input.__raw !== undefined) {
      try { return JSON.parse(input.__raw) } catch { return {} }
    }
    // Parse JSON fields for http.request
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      if ((k === 'headers' || k === 'body') && v) {
        try { out[k] = JSON.parse(v) } catch { out[k] = v }
      } else if (v !== '') {
        out[k] = v
      }
    }
    return out
  }

  async function handleTest() {
    const payload = buildInput()
    const mutation = isBuiltin ? testBuiltin : testWorkspace
    const res = await mutation.mutateAsync(payload)
    setResult(res)
  }

  const isPending = isBuiltin ? testBuiltin.isPending : testWorkspace.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Fixed header */}
        <div className="px-6 pt-5 pb-4 border-b flex-shrink-0 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Test: {tool.name}</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{tool.slug}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isBuiltin ? (
            <BuiltinInputForm slug={tool.slug} input={input} onChange={setField} />
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Input (JSON)</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono h-28 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={input.__raw ?? '{}'}
                onChange={e => setField('__raw', e.target.value)}
              />
            </div>
          )}

          {result && (
            <div className={`rounded-lg border p-3 ${result.error ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-xs font-semibold uppercase ${result.error ? 'text-red-700' : 'text-green-700'}`}>
                  {result.error ? 'Error' : 'Result'}
                </p>
                <span className="text-xs text-gray-400">{result.duration_ms}ms</span>
              </div>
              <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-48 font-mono text-gray-700">
                {result.error ?? JSON.stringify(result.output, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Fixed footer */}
        <div className="px-6 pt-4 pb-5 border-t flex-shrink-0 flex justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
          <Btn size="sm" loading={isPending} onClick={handleTest}>
            {isPending ? <Spinner size="sm" /> : 'Run test'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
