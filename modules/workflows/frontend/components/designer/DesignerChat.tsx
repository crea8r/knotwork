import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import WorkflowAgentZeroConsultationPanel from '@modules/communication/frontend/components/consultation/WorkflowAgentZeroConsultationPanel'
import { useGraph } from "@modules/workflows/frontend/api/graphs"
import { useAuthStore } from '@auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

interface Props {
  active?: boolean
  graphId: string
  sessionId: string
  initialConsultationChannelId?: string | null
  onBeforeApplyDelta?: () => void
  shellClassName?: string
}

export default function DesignerChat({ active = true, graphId, initialConsultationChannelId, shellClassName }: Props) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const qc = useQueryClient()
  const [latestAssistantMessageId, setLatestAssistantMessageId] = useState<string | null>(null)
  const { data: graph } = useGraph(workspaceId, graphId)

  useEffect(() => {
    if (!latestAssistantMessageId) return
    qc.invalidateQueries({ queryKey: ['graph', graphId] })
    qc.invalidateQueries({ queryKey: ['graph-versions', graphId] })
  }, [graphId, latestAssistantMessageId, qc])

  return (
    <WorkflowAgentZeroConsultationPanel
      active={active}
      workspaceId={workspaceId}
      graphId={graphId}
      graphName={graph?.name}
      initialConsultationChannelId={initialConsultationChannelId}
      shellClassName={shellClassName}
      onLatestAgentMessageIdChange={setLatestAssistantMessageId}
    />
  )
}
