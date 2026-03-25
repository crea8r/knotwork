import { X } from 'lucide-react'
import DesignerChat from '@/components/designer/DesignerChat'

export default function ChatPanel({
  graphId,
  sessionId,
  onClose,
  onBeforeApplyDelta,
}: {
  graphId: string
  sessionId: string
  onClose: () => void
  onBeforeApplyDelta: () => void
}) {
  return (
    <>
      {/* Desktop side panel */}
      <div className="hidden md:flex border-l border-gray-200 bg-white" style={{ width: 440, flexShrink: 0, flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DesignerChat graphId={graphId} sessionId={sessionId} onBeforeApplyDelta={onBeforeApplyDelta} />
        </div>
      </div>

      {/* Mobile bottom sheet */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-xl" style={{ height: '65vh' }}>
        <div className="relative flex items-center justify-between border-b border-gray-200 px-4 py-3 flex-shrink-0">
          <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full bg-gray-300" />
          <p className="text-sm font-semibold text-gray-900">Designer</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700" aria-label="Close chat">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <DesignerChat graphId={graphId} sessionId={sessionId} onBeforeApplyDelta={onBeforeApplyDelta} />
        </div>
      </div>
    </>
  )
}
