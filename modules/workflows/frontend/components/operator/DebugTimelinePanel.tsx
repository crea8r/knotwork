import type { DebugTimelineRow } from '@modules/workflows/frontend/hooks/useRunDebugTimeline'

interface Props {
  debugTimeline: DebugTimelineRow[]
}

export default function DebugTimelinePanel({ debugTimeline }: Props) {
  return (
    <div className="px-4 md:px-5 pt-3">
      <details className="rounded-xl border border-gray-200 bg-white max-h-[80vh] overflow-hidden">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs text-gray-700 font-medium flex items-center justify-between">
          <span>OpenClaw Debug ({debugTimeline.length} events)</span>
          <span className="text-[11px] text-gray-400">Expand</span>
        </summary>
        <div className="px-3 pb-3 border-t border-gray-100 max-h-[calc(80vh-2.25rem)] overflow-y-auto">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mt-2 mb-2">Timeline</p>
          <div className="space-y-2">
            {debugTimeline.map((entry) => {
              const kindStyle = entry.kind === 'in'
                ? 'border-green-200 bg-green-50 text-green-700'
                : entry.kind === 'out'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              return (
                <div key={entry.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded-full border text-[10px] uppercase tracking-wide ${kindStyle}`}>
                        {entry.kind}
                      </span>
                      <span className="text-[11px] text-gray-700 truncate">{entry.nodeName} • {entry.label}</span>
                      {entry.visitIndex && entry.maxVisits && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                          Visit {entry.visitIndex} of {entry.maxVisits}
                        </span>
                      )}
                      {entry.branchTarget && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
                          {entry.branchLabel ? `${entry.branchLabel} -> ${entry.branchTarget}` : `Branch -> ${entry.branchTarget}`}
                        </span>
                      )}
                      {entry.loopBack && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          Loop back
                        </span>
                      )}
                      {entry.heartbeatCount && entry.heartbeatCount > 1 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          merged x{entry.heartbeatCount}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {entry.iso ? new Date(entry.iso).toLocaleTimeString() : '-'}
                    </span>
                  </div>
                  <pre className="bg-black text-gray-100 rounded-lg p-2.5 text-[10px] overflow-auto max-h-56 whitespace-pre-wrap">
                    {entry.heartbeatCount && entry.heartbeatCount > 1
                      ? `Heartbeat updates merged (${entry.heartbeatCount})\nLatest: ${entry.content}`
                      : entry.content}
                  </pre>
                </div>
              )
            })}
            {debugTimeline.length === 0 && (
              <p className="text-[11px] text-gray-400 italic">No debug events yet.</p>
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
