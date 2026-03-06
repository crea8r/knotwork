/**
 * MarkdownViewer — renders markdown content with optional full-screen reading mode.
 *
 * Props:
 *   content     — raw markdown string
 *   maxHeight   — CSS max-height in the inline view (default: 'none')
 *   className   — extra classes on the inline container
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Maximize2, X } from 'lucide-react'

interface Props {
  content: string
  maxHeight?: string
  className?: string
}

const PROSE =
  'prose prose-sm max-w-none ' +
  'prose-headings:font-semibold prose-headings:text-gray-900 ' +
  'prose-p:text-gray-800 prose-p:leading-relaxed ' +
  'prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline ' +
  'prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-code:text-xs prose-code:font-mono ' +
  'prose-pre:bg-gray-900 prose-pre:text-gray-100 ' +
  'prose-blockquote:border-brand-300 prose-blockquote:text-gray-600 ' +
  'prose-table:text-sm prose-th:text-gray-700 prose-td:text-gray-700 ' +
  'prose-ul:my-1 prose-ol:my-1 prose-li:my-0'

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className={PROSE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function FullScreenModal({ content, onClose }: { content: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 flex-shrink-0">
        <p className="text-sm font-semibold text-gray-700">Reading view</p>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100"
          title="Close (Esc)"
        >
          <X size={14} /> Close
        </button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 max-w-4xl mx-auto w-full">
        <MarkdownBody content={content} />
      </div>
    </div>,
    document.body,
  )
}

export default function MarkdownViewer({ content, maxHeight = 'none', className = '' }: Props) {
  const [fullScreen, setFullScreen] = useState(false)

  return (
    <>
      <div className={`relative group ${className}`}>
        {/* Full-screen toggle */}
        <button
          onClick={() => setFullScreen(true)}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity
                     bg-white border border-gray-200 rounded p-1 shadow-sm text-gray-400
                     hover:text-gray-700 hover:border-gray-400 z-10"
          title="Full-screen reading view"
        >
          <Maximize2 size={12} />
        </button>

        {/* Inline view */}
        <div
          className="overflow-auto"
          style={{ maxHeight }}
        >
          <MarkdownBody content={content} />
        </div>
      </div>

      {fullScreen && (
        <FullScreenModal content={content} onClose={() => setFullScreen(false)} />
      )}
    </>
  )
}
