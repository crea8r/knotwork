import { Play, Trash2, Map as MapIcon, RotateCcw } from 'lucide-react'
import type { Run } from '@/types'
import StatusBadge from '@/components/shared/StatusBadge'
import InlineRename from './InlineRename'
import type { useDeleteRun, useCloneRun, useExecuteRunInline, useAbortRun } from '@/api/runs'

const TERMINAL = new Set(['completed', 'failed', 'stopped'])
const DELETABLE = new Set(['completed', 'failed', 'stopped', 'draft', 'queued', 'paused'])

interface Props {
  run: Run
  runId: string
  workspaceId: string
  wsConnected: boolean
  showInputPanel: boolean
  executeInline: ReturnType<typeof useExecuteRunInline>
  abortRun: ReturnType<typeof useAbortRun>
  cloneRun: ReturnType<typeof useCloneRun>
  deleteRun: ReturnType<typeof useDeleteRun>
  refetchRun: () => void
  refetchNodes: () => void
  onShowInputPanel: (v: boolean) => void
  onShowMobileMap: () => void
  onAbort: () => void
  onCloneAndRun: () => void
  onDelete: () => void
}

export default function RunDetailHeader({
  run, runId, workspaceId, wsConnected, showInputPanel,
  executeInline, abortRun, cloneRun, deleteRun,
  refetchRun, refetchNodes,
  onShowInputPanel, onShowMobileMap, onAbort, onCloneAndRun, onDelete,
}: Props) {
  const isDeletable = DELETABLE.has(run.status)
  return (
    <div className="px-4 md:px-6 py-3 border-b border-gray-200 bg-white flex items-center gap-3 flex-wrap">
      <div>
        <p className="text-xs text-gray-400">Run</p>
        <p className="font-mono text-xs text-gray-400">{runId?.slice(0, 8)}…</p>
      </div>
      <InlineRename runId={runId} workspaceId={workspaceId} currentName={run.name} />
      <StatusBadge status={run.status} />
      <button
        onClick={() => onShowInputPanel(!showInputPanel)}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${showInputPanel ? 'border-brand-400 text-brand-600 bg-brand-50' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
      >
        Input
      </button>
      <button onClick={onShowMobileMap} className="xl:hidden flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400">
        <MapIcon size={12} />Workflow map
      </button>
      {(run.status === 'queued' || run.status === 'draft') && (
        <button
          onClick={() => executeInline.mutate(runId, { onSuccess: () => { refetchRun(); refetchNodes() }, onError: () => { refetchRun(); refetchNodes() } })}
          disabled={executeInline.isPending || executeInline.isSuccess}
          className="flex items-center gap-1.5 text-xs bg-brand-500 text-white px-3 py-1.5 rounded-lg hover:bg-brand-600 disabled:opacity-50"
        >
          <Play size={12} /> {executeInline.isPending || executeInline.isSuccess ? 'Starting…' : 'Run now'}
        </button>
      )}
      {run.status === 'running' && (
        <button onClick={onAbort} disabled={abortRun.isPending} title="Use only to cancel a stuck run." className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50">
          {abortRun.isPending ? 'Aborting…' : 'Abort run (stuck only)'}
        </button>
      )}
      {wsConnected && run.status === 'running' && <span className="text-xs text-blue-500 animate-pulse">live</span>}
      {TERMINAL.has(run.status) && (
        <button onClick={onCloneAndRun} disabled={cloneRun.isPending || executeInline.isPending} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RotateCcw size={12} />{cloneRun.isPending || executeInline.isPending ? 'Cloning…' : 'Clone & re-run'}
        </button>
      )}
      {isDeletable && (
        <button onClick={onDelete} disabled={deleteRun.isPending} className="ml-auto flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50">
          <Trash2 size={13} /> Delete
        </button>
      )}
    </div>
  )
}
