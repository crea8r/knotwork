import { memo } from 'react'
import { X } from 'lucide-react'
import DesignerChat from '@modules/workflows/frontend/components/designer/DesignerChat'
import { EditorSidePanel } from '@ui/components/EditorWorkspace'

const DESKTOP_PANEL_MOTION = 'motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-reduce:transition-none'

export default memo(function ChatPanel({
  visible,
  graphId,
  sessionId,
  initialConsultationChannelId,
  onClose,
  onBeforeApplyDelta,
  renderDesktop = true,
  renderMobile = true,
}: {
  visible: boolean
  graphId: string
  sessionId: string
  initialConsultationChannelId?: string | null
  onClose: () => void
  onBeforeApplyDelta: () => void
  renderDesktop?: boolean
  renderMobile?: boolean
}) {
  return (
    <>
      {/* Desktop side panel */}
      {renderDesktop ? (
        <EditorSidePanel
          dataUi="workflow.editor.chat.desktop"
          className={`hidden md:flex ${DESKTOP_PANEL_MOTION} ${
            visible
              ? 'translate-x-0 opacity-100 motion-safe:ease-out'
              : 'pointer-events-none translate-x-4 opacity-0 motion-safe:ease-in motion-reduce:translate-x-0'
          }`}
        >
          <div data-ui="workflow.editor.chat.desktop.content" style={{ flex: 1, overflow: 'hidden' }}>
            <DesignerChat
              active={visible}
              graphId={graphId}
              sessionId={sessionId}
              initialConsultationChannelId={initialConsultationChannelId}
              onBeforeApplyDelta={onBeforeApplyDelta}
              shellClassName="rounded-none border-0"
            />
          </div>
        </EditorSidePanel>
      ) : null}

      {/* Mobile bottom sheet */}
      {renderMobile && visible ? (
        <div data-ui="workflow.editor.chat.mobile" className="md:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-xl" style={{ height: '65vh' }}>
          <div data-ui="workflow.editor.chat.mobile.header" className="relative flex items-center justify-between border-b border-gray-200 px-4 py-3 flex-shrink-0">
            <div data-ui="workflow.editor.chat.mobile.handle" className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full bg-gray-300" />
            <p data-ui="workflow.editor.chat.mobile.title" className="text-sm font-semibold text-gray-900">Designer</p>
            <button data-ui="workflow.editor.chat.mobile.close" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700" aria-label="Close chat">
              <X size={18} />
            </button>
          </div>
          <div data-ui="workflow.editor.chat.mobile.content" className="flex-1 overflow-hidden">
            <DesignerChat
              active={visible}
              graphId={graphId}
              sessionId={sessionId}
              initialConsultationChannelId={initialConsultationChannelId}
              onBeforeApplyDelta={onBeforeApplyDelta}
              shellClassName="rounded-none border-0"
            />
          </div>
        </div>
      ) : null}
    </>
  )
})
