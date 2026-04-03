import { useState } from 'react'
import { CheckCircle, FileText } from 'lucide-react'
import {
  useKnowledgeChanges,
  useApproveKnowledgeChange,
  useRejectKnowledgeChange,
  type KnowledgeChange,
} from '@/api/knowledge'
import Spinner from '@/components/shared/Spinner'
import Btn from '@/components/shared/Btn'

function ProposalCard({ proposal }: { proposal: KnowledgeChange }) {
  const approve = useApproveKnowledgeChange()
  const reject = useRejectKnowledgeChange()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <FileText size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 font-mono truncate">{proposal.target_path}</p>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{proposal.reason}</p>
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-brand-600 hover:text-brand-700"
      >
        {expanded ? 'Hide proposed content' : 'View proposed content'}
      </button>

      {expanded && (
        <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48">
          {proposal.proposed_content ?? JSON.stringify(proposal.payload, null, 2)}
        </pre>
      )}

      <div className="flex gap-2">
        <Btn
          size="sm"
          loading={approve.isPending}
          onClick={() => approve.mutate({ id: proposal.id, final_content: proposal.proposed_content ?? undefined })}
        >
          Approve
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          loading={reject.isPending}
          onClick={() => reject.mutate(proposal.id)}
        >
          Reject
        </Btn>
      </div>
    </div>
  )
}

export default function ReviewQueue() {
  const { data: proposals = [], isLoading } = useKnowledgeChanges('pending')

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  if (proposals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 min-h-[300px]">
        <CheckCircle size={40} className="text-green-500 mb-3" />
        <p className="text-lg font-medium text-gray-900">All caught up</p>
        <p className="text-sm text-gray-500 mt-1 max-w-sm">
          No strategic work pending. The agent will surface improvements as your workflows run.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <p className="text-sm text-gray-500">
        {proposals.length} knowledge change{proposals.length !== 1 ? 's' : ''} to review
      </p>
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  )
}
