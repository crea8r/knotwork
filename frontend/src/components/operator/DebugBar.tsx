import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import StatusBadge from '@/components/shared/StatusBadge'
import type { Run } from '@/types'

interface Props {
  lastRun: Run | null
  inputJson: string
  onInputChange: (v: string) => void
  onTrigger: () => void
  isTriggerPending: boolean
  inputError: string
}

export default function DebugBar({
  lastRun,
  inputJson,
  onInputChange,
  onTrigger,
  isTriggerPending,
  inputError,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-t border-gray-200 bg-white" style={{ flexShrink: 0 }}>
      {/* Collapsed bar */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
      >
        <span className="font-medium text-gray-700">▶ Debug</span>
        {lastRun && <StatusBadge status={lastRun.status} />}
        <span className="ml-auto">{expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
      </button>

      {expanded && (
        <div className="flex gap-4 px-6 py-4 border-t border-gray-100">
          {/* Left: input + trigger */}
          <div className="flex-1 space-y-2">
            <label className="text-xs text-gray-500">Run input (JSON)</label>
            <textarea
              value={inputJson}
              onChange={(e) => onInputChange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono h-24 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {inputError && <p className="text-xs text-red-500">{inputError}</p>}
            <button
              onClick={onTrigger}
              disabled={isTriggerPending}
              className="px-4 py-1.5 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600 disabled:opacity-50"
            >
              {isTriggerPending ? 'Triggering…' : 'Trigger run'}
            </button>
          </div>

          {/* Right: last run output */}
          <div className="flex-1">
            <label className="text-xs text-gray-500">Last run output</label>
            <pre className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50 h-24 overflow-auto">
              {lastRun?.output != null
                ? JSON.stringify(lastRun.output, null, 2)
                : '—'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
