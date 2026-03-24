/**
 * HandbookProposalCard — displays an agent-proposed handbook change.
 */
import { useState } from 'react'
import { Ban, Check, FileText, SquarePen } from 'lucide-react'
import { useResolveHandbookProposal } from '@/api/channels'

export type HandbookProposalPayload = {
  proposal_id: string; path: string; reason: string
  proposed_content: string; status: 'pending' | 'approved' | 'aborted'; final_content?: string
}

function statusBadge(status: string) {
  if (status === 'pending') return 'bg-amber-100 text-amber-700'
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (status === 'aborted') return 'bg-rose-100 text-rose-700'
  return 'bg-gray-100 text-gray-700'
}

export default function HandbookProposalCard({
  proposal, workspaceId, channelId, onOpenFile, showRaw,
}: {
  proposal: HandbookProposalPayload; workspaceId: string; channelId: string
  onOpenFile: (path: string) => void; showRaw: boolean
}) {
  const resolve = useResolveHandbookProposal(workspaceId, channelId)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(proposal.proposed_content)
  const pending = proposal.status === 'pending'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">Proposal from Knotwork Agent</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge(proposal.status)}`}>{proposal.status}</span>
      </div>
      <button onClick={() => onOpenFile(proposal.path)}
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800">
        <FileText size={14} />{proposal.path}
      </button>
      <p className="mt-1 text-sm text-gray-700">{proposal.reason}</p>
      {isEditing ? (
        <div className="mt-2 space-y-2">
          <textarea value={editedContent} onChange={e => setEditedContent(e.target.value)}
            rows={10} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-800" />
          <div className="flex items-center gap-2">
            <button onClick={async () => { await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'override_output', final_content: editedContent }); setIsEditing(false) }}
              disabled={!pending || resolve.isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs disabled:opacity-40">
              <Check size={12} />Save & approve
            </button>
            <button onClick={() => setIsEditing(false)} className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-2 text-xs text-gray-700 whitespace-pre-wrap max-h-44 overflow-y-auto">
          {proposal.final_content ?? proposal.proposed_content}
        </div>
      )}
      {showRaw && <pre className="mt-2 rounded-lg border border-gray-200 bg-white p-2 text-[11px] text-gray-700 overflow-x-auto">{JSON.stringify(proposal, null, 2)}</pre>}
      {pending && !isEditing && (
        <div className="mt-2 flex items-center gap-2">
          <button onClick={async () => { await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'accept_output' }) }}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs disabled:opacity-40">
            <Check size={12} />Approve
          </button>
          <button onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 text-xs">
            <SquarePen size={12} />Edit
          </button>
          <button onClick={async () => { await resolve.mutateAsync({ proposalId: proposal.proposal_id, resolution: 'abort_run' }) }}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-700 bg-rose-50 text-xs disabled:opacity-40">
            <Ban size={12} />Abort
          </button>
        </div>
      )}
    </div>
  )
}
