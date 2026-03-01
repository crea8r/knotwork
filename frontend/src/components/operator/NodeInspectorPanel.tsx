import { useState } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { useSubmitRating } from '@/api/ratings'
import StatusBadge from '@/components/shared/StatusBadge'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import type { RunNodeState } from '@/types'

interface Props {
  nodeId: string
  nodeName?: string
  nodeState: RunNodeState | null
  workspaceId: string
  runId: string
  onClose: () => void
}

function StarRating({ workspaceId, runId, nodeState, onRated }: {
  workspaceId: string
  runId: string
  nodeState: RunNodeState
  onRated: (score: number) => void
}) {
  const [hovered, setHovered] = useState(0)
  const submit = useSubmitRating(workspaceId, runId, nodeState.id)

  if (nodeState.status !== 'completed') return null

  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          className={`text-xl leading-none ${s <= hovered ? 'text-amber-400' : 'text-gray-300'}`}
          onMouseEnter={() => setHovered(s)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => submit.mutate({ score: s }, { onSuccess: () => onRated(s) })}
        >
          ★
        </button>
      ))}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="text-gray-300 hover:text-gray-500 ml-1"
      title="Copy to clipboard"
    >
      {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
    </button>
  )
}

export default function NodeInspectorPanel({ nodeId, nodeName, nodeState, workspaceId, runId, onClose }: Props) {
  const [rated, setRated] = useState<number | null>(null)
  const displayName = nodeName ?? nodeId

  return (
    <div
      className="fixed right-0 top-0 h-full w-80 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
      style={{ overflowY: 'auto' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <p className="font-semibold text-sm text-gray-900">{displayName}</p>
          {nodeName && nodeName !== nodeId && (
            <p className="text-xs font-mono text-gray-400">{nodeId}</p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      {nodeState === null ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p className="text-sm text-gray-400">This node hasn't run yet.</p>
            <p className="text-xs text-gray-300 mt-1">Results will appear here once the run reaches this node.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 p-4 space-y-5">
          {/* Status + confidence */}
          <div className="flex items-center gap-3">
            <StatusBadge status={nodeState.status} />
            {nodeState.confidence_score != null && (
              <span className="text-xs text-gray-500">
                {(nodeState.confidence_score * 100).toFixed(0)}% confidence
              </span>
            )}
            {nodeState.resolved_token_count != null && (
              <span className="text-xs text-gray-400">{nodeState.resolved_token_count} tokens</span>
            )}
          </div>

          {/* Error display */}
          {nodeState.status === 'failed' && nodeState.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-700 mb-1">Error</p>
              <pre className="text-xs text-red-600 whitespace-pre-wrap">{nodeState.error}</pre>
            </div>
          )}

          {/* Input — everything sent to the LLM */}
          {nodeState.input != null && (() => {
            const inp = nodeState.input as Record<string, unknown>
            return (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Input to LLM</p>

                {typeof inp.model === 'string' && (
                  <p className="text-[10px] text-gray-400">
                    Model: <span className="font-mono text-gray-600">{inp.model}</span>
                  </p>
                )}

                {typeof inp.system_prompt === 'string' && (
                  <details open>
                    <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                      System prompt
                    </summary>
                    <pre className="mt-1 bg-purple-50 border border-purple-100 rounded-lg p-2.5 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed overflow-auto max-h-64">
                      {inp.system_prompt as string}
                    </pre>
                  </details>
                )}

                {typeof inp.user_prompt === 'string' && (
                  <details open>
                    <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                      User prompt
                    </summary>
                    <pre className="mt-1 bg-blue-50 border border-blue-100 rounded-lg p-2.5 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed overflow-auto max-h-64">
                      {inp.user_prompt as string}
                    </pre>
                  </details>
                )}

                {typeof inp.previous_output === 'string' && !inp.system_prompt && (
                  <details>
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Previous node output</summary>
                    <div className="mt-1 bg-blue-50 border border-blue-100 rounded-lg p-2.5 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed overflow-auto max-h-32">
                      {inp.previous_output as string}
                    </div>
                  </details>
                )}
              </div>
            )
          })()}

          {/* Output */}
          {nodeState.output != null && (
            <div>
              <div className="flex items-center mb-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Output</p>
                {typeof (nodeState.output as Record<string, unknown>).text === 'string' && (
                  <CopyButton text={(nodeState.output as Record<string, unknown>).text as string} />
                )}
              </div>
              {typeof (nodeState.output as Record<string, unknown>).text === 'string' ? (
                <>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <MarkdownViewer
                      content={(nodeState.output as Record<string, unknown>).text as string}
                      maxHeight="16rem"
                    />
                  </div>
                  <details className="mt-2">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Raw output</summary>
                    <pre className="mt-1 bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-32">
                      {JSON.stringify(nodeState.output, null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                <pre className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-48">
                  {JSON.stringify(nodeState.output, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Knowledge used */}
          {nodeState.knowledge_snapshot && Object.keys(nodeState.knowledge_snapshot).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Knowledge Used</p>
              <ul className="space-y-1">
                {Object.entries(nodeState.knowledge_snapshot).map(([path, ver]) => (
                  <li key={path} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-brand-700">{path}</span>
                    <span className="text-gray-400">v{ver.slice(0, 6)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rating */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Rate this output</p>
            {rated !== null ? (
              <span className="text-xs text-green-600">Rated {rated}★ — thank you</span>
            ) : (
              <StarRating
                workspaceId={workspaceId}
                runId={runId}
                nodeState={nodeState}
                onRated={setRated}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
