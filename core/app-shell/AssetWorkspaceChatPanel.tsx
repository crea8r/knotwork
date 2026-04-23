import { useRef, useState } from 'react'
import { useProjectDashboard } from '@modules/projects/frontend/api/projects'
import { useGraphs } from '@modules/workflows/frontend/api/graphs'
import { useAssetChatChannel, usePostChannelMessage } from '@modules/communication/frontend/api/channels'
import { ChannelTimeline } from '@modules/communication/frontend/components/ChannelFrame'
import ChannelParticipantsPanel from '@modules/communication/frontend/components/ChannelParticipantsPanel'
import WorkflowSlashComposer from '@modules/communication/frontend/components/WorkflowSlashComposer'
import { useChannelTimeline } from '@modules/communication/frontend/components/useChannelTimeline'
import { useMentionDetection } from '@modules/communication/frontend/components/useMentionDetection'
import Spinner from '@ui/components/Spinner'
import { useAssetWorkspaceStore } from '@app-shell/state/assetWorkspace'

export default function AssetWorkspaceChatPanel() {
  const scope = useAssetWorkspaceStore((state) => state.scope)
  const selection = useAssetWorkspaceStore((state) => state.selection)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const { data: projectDashboard, isLoading: loadingProject } = useProjectDashboard(
    scope?.kind === 'project' ? scope.workspaceId : '',
    scope?.kind === 'project' ? scope.projectSlug : '',
  )
  const projectId = scope?.kind === 'project' ? (projectDashboard?.project.id ?? '') : ''
  const { data: projectWorkflows = [] } = useGraphs(scope?.kind === 'project' ? scope.workspaceId : '', projectId)
  const { data: knowledgeWorkflows = [] } = useGraphs(scope?.kind === 'knowledge' ? scope.workspaceId : '')
  const workflows = scope?.kind === 'project' ? projectWorkflows : knowledgeWorkflows
  const project = scope?.kind === 'project' ? (projectDashboard?.project ?? null) : null
  const assetChatType = selection?.assetType === 'folder'
    ? 'folder'
    : selection?.assetType === 'workflow'
      ? 'workflow'
      : 'file'
  const assetChatProjectId = scope?.kind === 'project' && selection?.assetType !== 'knowledge-file'
    ? (projectId || null)
    : null

  const { data: channel = null } = useAssetChatChannel(
    scope?.workspaceId ?? '',
    assetChatType,
    {
      path: selection?.path ?? '',
      asset_id: selection?.assetType === 'workflow' ? (selection.graphId ?? null) : null,
      project_id: assetChatProjectId,
    },
  )
  const { items: timelineItems } = useChannelTimeline(scope?.workspaceId ?? '', channel?.id ?? '')
  const postMessage = usePostChannelMessage(scope?.workspaceId ?? '', channel?.id ?? '')
  const { mentionMenuNode } = useMentionDetection(scope?.workspaceId ?? '', draft, setDraft, inputRef)

  if (!scope || !selection) {
    return (
      <div data-ui="shell.chat.asset-context.empty" className="flex h-full items-center justify-center p-8 text-sm text-stone-500">
        Pick an asset to start an asset-specific chat.
      </div>
    )
  }

  if (scope.kind === 'project' && loadingProject && !project) {
    return <div data-ui="shell.chat.asset-context.loading" className="flex h-full items-center justify-center"><Spinner size="lg" /></div>
  }

  return (
    <div data-ui="shell.chat.asset-context.panel" className="flex h-full min-h-0 flex-col bg-white">
      {channel?.id ? (
        <div data-ui="shell.chat.asset-context.banner" className="shrink-0 border-b border-stone-200 bg-white px-3 py-2">
          <div data-ui="shell.chat.asset-context.participants">
            <ChannelParticipantsPanel workspaceId={scope.workspaceId} channelId={channel.id} />
          </div>
        </div>
      ) : null}
      <ChannelTimeline items={timelineItems} emptyState="No messages yet. Start a discussion about this asset." scrollToLatest />
      <WorkflowSlashComposer
        workspaceId={scope.workspaceId}
        workflows={workflows}
        channelId={channel?.id ?? null}
        draft={draft}
        setDraft={setDraft}
        onSend={() => postMessage.mutate(
          { content: draft.trim(), role: 'user', author_type: 'human', author_name: 'You' },
          { onSuccess: () => setDraft('') },
        )}
        pending={postMessage.isPending}
        placeholder="Discuss the selected asset in context…"
        inputRef={inputRef}
        beforeInput={mentionMenuNode}
      />
    </div>
  )
}
