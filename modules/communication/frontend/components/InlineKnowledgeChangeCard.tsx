import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, FileText, Send } from 'lucide-react'
import Btn from '@ui/components/Btn'
import MarkdownViewer from '@ui/components/MarkdownViewer'
import { useReviewChannelKnowledgeChange } from '@modules/communication/frontend/api/channels'

type Props = {
  workspaceId: string
  channelId: string
  createdAt: string
  metadata: Record<string, unknown>
}

function statusLabel(status: string): string {
  switch (status) {
    case 'approved':
      return 'Approved'
    case 'needs_revision':
      return 'Edit requested'
    case 'rejected':
      return 'Rejected'
    default:
      return 'Pending review'
  }
}

function statusTone(status: string): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-700'
    case 'needs_revision':
      return 'bg-stone-200 text-stone-700'
    case 'rejected':
      return 'bg-rose-100 text-rose-700'
    default:
      return 'bg-amber-100 text-amber-700'
  }
}

export default function InlineKnowledgeChangeCard({ workspaceId, channelId, createdAt, metadata }: Props) {
  const review = useReviewChannelKnowledgeChange(workspaceId, channelId)
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState('')

  const proposalId = String(metadata.proposal_id ?? '').trim()
  const path = String(metadata.path ?? '').trim()
  const reason = String(metadata.reason ?? '').trim()
  const proposedContent = String(metadata.proposed_content ?? '').trim()
  const status = String(metadata.status ?? 'pending').trim()
  const revisionRequestComment = String(metadata.revision_request_comment ?? '').trim()
  const interactive = status === 'pending' && !!proposalId

  return (
    <div data-ui="channel.knowledge-change" className="max-w-[92%] mr-auto rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
      <div data-ui="channel.knowledge-change.header" className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-amber-700">Knowledge change</p>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <FileText size={14} className="shrink-0 text-amber-700" />
            <p className="truncate text-sm font-medium text-amber-950 font-mono">{path || 'Untitled target'}</p>
          </div>
          {reason ? <p className="mt-1 text-sm text-amber-900 whitespace-pre-wrap">{reason}</p> : null}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusTone(status)}`}>
          {statusLabel(status)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        data-ui="channel.knowledge-change.expand"
        className="inline-flex items-center gap-1 text-xs text-amber-800 hover:text-amber-950"
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Hide proposed change' : 'View proposed change'}
      </button>

      {expanded ? (
        <div data-ui="channel.knowledge-change.preview" className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-stone-800">
          <MarkdownViewer content={proposedContent || '*No proposed content provided.*'} compact />
        </div>
      ) : null}

      {status === 'needs_revision' && revisionRequestComment ? (
        <div data-ui="channel.knowledge-change.revision-request" className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-stone-500">Requested edit</p>
          <p className="mt-1 text-sm text-stone-700 whitespace-pre-wrap">{revisionRequestComment}</p>
        </div>
      ) : null}

      {interactive ? (
        <div data-ui="channel.knowledge-change.review" className="rounded-xl border border-amber-200 bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-amber-100">
            <p className="text-xs font-medium text-amber-900">Review this proposed change</p>
            <p className="mt-0.5 text-[11px] text-stone-500">
              Created {new Date(createdAt).toLocaleString()}
            </p>
          </div>
          <textarea
            data-ui="channel.knowledge-change.comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Request an edit with specific guidance…"
            rows={3}
            className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none"
          />
          <div data-ui="channel.knowledge-change.actions" className="flex items-center justify-between gap-2 border-t border-amber-100 bg-amber-50/60 px-3 py-2">
            <Btn
              size="sm"
              loading={review.isPending}
              onClick={() => review.mutate({ proposalId, resolution: 'approve' })}
            >
              <Check size={14} />
              Approve
            </Btn>
            <button
              type="button"
              disabled={!comment.trim() || review.isPending}
              onClick={() => review.mutate({ proposalId, resolution: 'request_edit', comment: comment.trim() }, {
                onSuccess: () => setComment(''),
              })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={12} />
              Request edit
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
