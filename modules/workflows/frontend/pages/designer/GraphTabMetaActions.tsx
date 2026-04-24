import { AlertTriangle, Archive, GitBranch, Globe, Loader2, MoreHorizontal, Play, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Btn from '@ui/components/Btn'
import type { AutosaveState } from './graphVersionUtils'

export default function GraphTabMetaActions({
  currentVersionLabel,
  autosaveState,
  autosaveError,
  validationErrors,
  showLifecycleActions,
  publishPending,
  deleteGraphPending,
  hasRuns,
  onOpenHistory,
  onRun,
  onRetrySave,
  onPublish,
  onRetire,
}: {
  currentVersionLabel: string
  autosaveState: AutosaveState
  autosaveError: string
  validationErrors: string[]
  showLifecycleActions: boolean
  publishPending: boolean
  deleteGraphPending: boolean
  hasRuns: boolean
  onOpenHistory: () => void
  onRun: () => void
  onRetrySave: () => void
  onPublish: () => void
  onRetire: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [showErrorDialog, setShowErrorDialog] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  function openMenu() {
    const rect = menuBtnRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setMenuOpen(true)
  }

  const showSaveState = showLifecycleActions && (autosaveState === 'saving' || autosaveState === 'error')
  const hasValidationErrors = validationErrors.length > 0

  return (
    <>
      <div data-ui="workflow.editor.tabs.graph.meta" className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          data-ui="workflow.editor.tabs.graph.version"
          onClick={onOpenHistory}
          className="inline-flex max-w-[18rem] min-w-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
          title="Open history"
        >
          <GitBranch size={12} className="flex-shrink-0" />
          <span className="truncate">{currentVersionLabel}</span>
        </button>

        {showSaveState ? (
          autosaveState === 'saving' ? (
            <span
              data-ui="workflow.editor.tabs.graph.autosave"
              className="inline-flex items-center gap-1.5 text-xs text-gray-400"
            >
              <Loader2 size={12} className="animate-spin" />
              <span>Saving…</span>
            </span>
          ) : (
            <button
              type="button"
              data-ui="workflow.editor.tabs.graph.autosave.retry"
              onClick={onRetrySave}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50"
              title={autosaveError || 'Retry save'}
            >
              <AlertTriangle size={12} />
              <span>Retry save</span>
            </button>
          )
        ) : null}

        <div data-ui="workflow.editor.toolbar.actions" className="ml-1 flex flex-shrink-0 items-center gap-2">
          {hasValidationErrors ? (
            <button
              type="button"
              data-ui="workflow.editor.toolbar.validation.toggle"
              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100"
              onClick={() => setShowErrorDialog(true)}
              title={validationErrors.join(', ')}
            >
              <AlertTriangle size={13} />
              <span>{validationErrors.length} issue{validationErrors.length > 1 ? 's' : ''}</span>
            </button>
          ) : null}

          <Btn data-ui="workflow.editor.toolbar.run" size="sm" variant="primary" disabled={hasValidationErrors} onClick={onRun}>
            <Play size={12} />
            <span className="hidden md:inline"> Run</span>
          </Btn>

          {showLifecycleActions ? (
            <>
              <button
                ref={menuBtnRef}
                type="button"
                data-ui="workflow.editor.tabs.graph.more"
                onClick={openMenu}
                disabled={publishPending || deleteGraphPending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                title="Workflow actions"
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && menuPos
                ? createPortal(
                    <>
                      <div className="fixed inset-0 z-[40]" onClick={() => setMenuOpen(false)} />
                      <div
                        data-ui="workflow.editor.tabs.graph.more.menu"
                        className="fixed z-[41] w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                        style={{ top: menuPos.top, right: menuPos.right }}
                      >
                        <button
                          type="button"
                          data-ui="workflow.editor.tabs.graph.more.publish"
                          disabled={publishPending}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            onPublish()
                            setMenuOpen(false)
                          }}
                        >
                          <Globe size={13} />
                          <span>{publishPending ? 'Publishing…' : 'Publish'}</span>
                        </button>
                        <button
                          type="button"
                          data-ui="workflow.editor.tabs.graph.more.retire"
                          disabled={deleteGraphPending}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            onRetire()
                            setMenuOpen(false)
                          }}
                        >
                          {hasRuns ? <Archive size={13} /> : <Trash2 size={13} />}
                          <span>{deleteGraphPending ? 'Working…' : hasRuns ? 'Archive workflow' : 'Delete workflow'}</span>
                        </button>
                      </div>
                    </>,
                    document.body,
                  )
                : null}
            </>
          ) : null}
        </div>
      </div>

      {showErrorDialog ? (
        <div
          data-ui="workflow.editor.dialog.validation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowErrorDialog(false)}
        >
          <div
            data-ui="workflow.editor.dialog.validation.panel"
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 text-amber-500" />
              <p data-ui="workflow.editor.dialog.validation.title" className="text-sm font-semibold text-gray-900">
                Graph topology issues
              </p>
            </div>
            <ul data-ui="workflow.editor.dialog.validation.list" className="space-y-1 text-sm text-amber-700">
              {validationErrors.map((error, index) => <li key={index}>• {error}</li>)}
            </ul>
            <button
              type="button"
              data-ui="workflow.editor.dialog.validation.close"
              className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50"
              onClick={() => setShowErrorDialog(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
