/**
 * ProposalsPanel — shows knowledge changes for human review.
 * Left: filterable change list. Right: current vs proposed diff + approve/reject.
 */
import { useState } from 'react'
import {
  useKnowledgeChanges, useApproveKnowledgeChange, useRejectKnowledgeChange,
  useKnowledgeFile, type KnowledgeChange,
} from '@/api/knowledge'

type StatusFilter = 'pending' | 'all'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  needs_revision: 'bg-stone-200 text-stone-700',
}

function ProposalDetail({ proposal }: { proposal: KnowledgeChange }) {
  const { data: current } = useKnowledgeFile(proposal.target_type === 'file' ? proposal.target_path : null)
  const approveMut = useApproveKnowledgeChange()
  const rejectMut = useRejectKnowledgeChange()
  const isPending = proposal.status === 'pending'

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="mb-3 flex-shrink-0">
        <p className="text-xs font-mono text-gray-500">{proposal.target_path}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {proposal.agent_ref} · {new Date(proposal.created_at).toLocaleString()}
        </p>
        <p className="text-sm text-gray-700 mt-1">{proposal.reason}</p>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-3 min-h-0 overflow-hidden">
        <div className="flex flex-col min-h-0">
          <p className="text-xs font-semibold text-gray-400 mb-1 flex-shrink-0">Current</p>
          <div className="flex-1 overflow-y-auto bg-gray-50 rounded border p-2 text-xs font-mono whitespace-pre-wrap">
            {current ? current.content : <span className="text-gray-400 italic">File doesn't exist yet.</span>}
          </div>
        </div>
        <div className="flex flex-col min-h-0">
          <p className="text-xs font-semibold text-blue-600 mb-1 flex-shrink-0">Proposed</p>
          <div className="flex-1 overflow-y-auto bg-blue-50 rounded border border-blue-200 p-2 text-xs font-mono whitespace-pre-wrap">
            {proposal.proposed_content ?? JSON.stringify(proposal.payload, null, 2)}
          </div>
        </div>
      </div>

      {isPending && (
        <div className="flex gap-2 mt-3 flex-shrink-0">
          <button
            onClick={() => approveMut.mutate({ id: proposal.id })}
            disabled={approveMut.isPending}
            className="flex-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => rejectMut.mutate(proposal.id)}
            disabled={rejectMut.isPending}
            className="flex-1 px-3 py-1.5 bg-red-500 text-white text-sm rounded hover:bg-red-600 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}

export default function ProposalsPanel() {
  const [filter, setFilter] = useState<StatusFilter>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: proposals = [], isLoading } = useKnowledgeChanges(filter === 'all' ? undefined : filter)
  const selected = proposals.find(p => p.id === selectedId) ?? null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: proposal list */}
      <div className="w-64 flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Proposals</span>
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value as StatusFilter); setSelectedId(null) }}
            className="text-xs border border-gray-200 rounded px-1 py-0.5 outline-none"
          >
            <option value="pending">Pending</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="text-xs text-gray-400 p-3">Loading…</p>}
          {!isLoading && proposals.length === 0 && (
            <p className="text-xs text-gray-400 p-3 italic">No proposals.</p>
          )}
          {proposals.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 ${selectedId === p.id ? 'bg-brand-50' : ''}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-mono text-gray-600 truncate max-w-[120px]">{p.target_path}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-1 ${STATUS_COLORS[p.status]}`}>{p.status}</span>
              </div>
              <p className="text-xs text-gray-500 truncate">{p.reason}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{p.agent_ref ?? 'unknown'}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <ProposalDetail proposal={selected} />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            Select a knowledge change to review.
          </div>
        )}
      </div>
    </div>
  )
}
