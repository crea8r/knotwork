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
import type { Components } from 'react-markdown'

interface Props {
  content: string
  maxHeight?: string
  className?: string
  compact?: boolean
  theme?: 'default' | 'inverse'
}

const PROSE =
  'prose prose-sm max-w-none ' +
  'prose-headings:font-semibold prose-headings:text-gray-900 prose-headings:mt-1.5 prose-headings:mb-1 ' +
  'prose-p:text-gray-800 prose-p:leading-relaxed prose-p:my-1 ' +
  'prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline ' +
  'prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-code:text-xs prose-code:font-mono ' +
  'prose-pre:bg-gray-900 prose-pre:text-gray-100 ' +
  'prose-blockquote:border-brand-300 prose-blockquote:text-gray-600 ' +
  'prose-table:text-sm prose-th:text-gray-700 prose-td:text-gray-700 ' +
  'prose-ul:my-0 prose-ol:my-0 prose-li:my-0 ' +
  '[&_ul]:my-0 [&_ol]:my-0 [&_li]:my-0 [&_li>p]:my-0 [&_li_p]:my-0 ' +
  '[&_h1]:my-1 [&_h2]:my-1 [&_h3]:my-1 [&_h4]:my-0.5 [&_h5]:my-0.5 [&_h6]:my-0.5'

const COMPACT_COMPONENTS: Components = {
  h1: (props) => <h1 className="text-base font-semibold text-gray-900 my-1" {...props} />,
  h2: (props) => <h2 className="text-[15px] font-semibold text-gray-900 my-1" {...props} />,
  h3: (props) => <h3 className="text-sm font-semibold text-gray-900 my-1" {...props} />,
  h4: (props) => <h4 className="text-sm font-semibold text-gray-900 my-0.5" {...props} />,
  h5: (props) => <h5 className="text-sm font-semibold text-gray-900 my-0.5" {...props} />,
  h6: (props) => <h6 className="text-sm font-semibold text-gray-900 my-0.5" {...props} />,
  p: (props) => <p className="my-0.5 text-gray-800 leading-relaxed" {...props} />,
  ul: (props) => <ul className="my-0.5 pl-4 list-disc" {...props} />,
  ol: (props) => <ol className="my-0.5 pl-4 list-decimal" {...props} />,
  li: (props) => <li className="my-0.5 leading-relaxed" {...props} />,
  blockquote: (props) => <blockquote className="my-1 pl-3 border-l-2 border-brand-300 text-gray-600" {...props} />,
  code: (props) => <code className="bg-gray-100 px-1 rounded text-xs font-mono" {...props} />,
  pre: (props) => <pre className="my-1 bg-gray-900 text-gray-100 rounded p-2 text-xs overflow-auto" {...props} />,
}

const INVERSE_COMPACT_COMPONENTS: Components = {
  h1: (props) => <h1 className="text-base font-semibold text-white my-1" {...props} />,
  h2: (props) => <h2 className="text-[15px] font-semibold text-white my-1" {...props} />,
  h3: (props) => <h3 className="text-sm font-semibold text-white my-1" {...props} />,
  h4: (props) => <h4 className="text-sm font-semibold text-white my-0.5" {...props} />,
  h5: (props) => <h5 className="text-sm font-semibold text-white my-0.5" {...props} />,
  h6: (props) => <h6 className="text-sm font-semibold text-white my-0.5" {...props} />,
  p: (props) => <p className="my-0.5 text-white/95 leading-relaxed" {...props} />,
  a: (props) => <a className="text-white underline underline-offset-2" {...props} />,
  ul: (props) => <ul className="my-0.5 pl-4 list-disc text-white/95" {...props} />,
  ol: (props) => <ol className="my-0.5 pl-4 list-decimal text-white/95" {...props} />,
  li: (props) => <li className="my-0.5 leading-relaxed" {...props} />,
  blockquote: (props) => <blockquote className="my-1 pl-3 border-l-2 border-white/40 text-white/80" {...props} />,
  code: (props) => <code className="bg-white/10 px-1 rounded text-xs font-mono text-white" {...props} />,
  pre: (props) => <pre className="my-1 bg-black/25 text-white rounded p-2 text-xs overflow-auto" {...props} />,
}

function MarkdownBody({ content, compact = false, theme = 'default' }: { content: string; compact?: boolean; theme?: 'default' | 'inverse' }) {
  if (compact) {
    const components = theme === 'inverse' ? INVERSE_COMPACT_COMPONENTS : COMPACT_COMPONENTS
    return (
      <div className="max-w-none text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }
  return (
    <div className={PROSE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function FullScreenModal({ content, onClose, compact = false, theme = 'default' }: { content: string; onClose: () => void; compact?: boolean; theme?: 'default' | 'inverse' }) {
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
        <MarkdownBody content={content} compact={compact} theme={theme} />
      </div>
    </div>,
    document.body,
  )
}

export default function MarkdownViewer({ content, maxHeight = 'none', className = '', compact = false, theme = 'default' }: Props) {
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
          <MarkdownBody content={content} compact={compact} theme={theme} />
        </div>
      </div>

      {fullScreen && (
        <FullScreenModal content={content} compact={compact} theme={theme} onClose={() => setFullScreen(false)} />
      )}
    </>
  )
}
