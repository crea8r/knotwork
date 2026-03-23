import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bug, Loader2 } from 'lucide-react'
import MarkdownViewer from '@/components/shared/MarkdownViewer'
import type { ChatItem } from '@/pages/runDetail/runDetailTypes'
import { extractImageSources, stripInlineSvg, formatJson } from '@/pages/runDetail/runDetailTypes'

interface Props {
  item: ChatItem
  highlighted: boolean
  dimmed: boolean
  onClick?: () => void
}

export default function MessageBubble({ item, highlighted, dimmed, onClick }: Props) {
  const [showRaw, setShowRaw] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const images = useMemo(() => extractImageSources(item.text), [item.text])
  const renderText = useMemo(() => {
    if (images.some((img) => img.inlineSvg)) return stripInlineSvg(item.text)
    return item.text
  }, [item.text, images])

  return (
    <div
      className={`max-w-[90%] ${item.role === 'user' ? 'ml-auto' : 'mr-auto'}`}
      style={{ opacity: dimmed ? 0.58 : 1, transition: 'opacity 160ms ease' }}
    >
      <div className="flex items-center gap-2 mb-0.5">
        {item.speakerAgentId ? (
          <Link to={`/agents/${item.speakerAgentId}`} className="text-[10px] uppercase tracking-wide text-brand-600 hover:underline">
            {item.speaker}{item.nodeName ? ` • ${item.nodeName}` : ''}
          </Link>
        ) : (
          <p className="text-[10px] uppercase tracking-wide text-gray-400">
            {item.speaker}{item.nodeName ? ` • ${item.nodeName}` : ''}
          </p>
        )}
        <button
          onClick={() => setShowRaw(v => !v)}
          className="text-[10px] text-gray-400 hover:text-gray-700 inline-flex items-center gap-1"
        >
          <Bug size={11} /> {showRaw ? 'Hide raw' : 'Raw'}
        </button>
      </div>

      <div
        onClick={onClick}
        className={`w-full text-left rounded-2xl px-3 py-2 text-sm leading-relaxed border transition-colors ${
          item.role === 'assistant'
            ? 'bg-white text-gray-800 border-gray-200 shadow-sm'
            : item.role === 'user'
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-gray-100 text-gray-600 border-gray-200'
        } ${highlighted ? 'ring-4 ring-blue-600 shadow-[0_8px_18px_rgba(37,99,235,0.28)] scale-[1.04]' : ''} select-text`}
        style={highlighted ? { boxShadow: '0 0 0 10px rgba(37,99,235,0.32), 0 8px 18px rgba(37,99,235,0.28)' } : undefined}
      >
        {item.kind === 'loading' && (
          <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <Loader2 size={12} className="animate-spin" />
            <span>Working</span>
          </div>
        )}
        {images.length > 0 && (
          <div className="mb-2 space-y-2">
            {images.map((img, idx) => (
              <button
                key={`${img.src}-${idx}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); setPreviewImage(img.src) }}
                className="block"
              >
                <img
                  src={img.src}
                  alt={`response-image-${idx + 1}`}
                  loading="lazy"
                  className="max-h-80 w-auto max-w-full rounded-lg border border-gray-200 bg-white object-contain"
                />
              </button>
            ))}
          </div>
        )}
        {item.markdown ? <MarkdownViewer content={renderText} compact /> : <span className="whitespace-pre-wrap">{renderText}</span>}
      </div>
      {previewImage && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 p-4 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="Full size"
            className="max-h-[95vh] max-w-[95vw] rounded-lg bg-white object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {showRaw && (
        <pre className="mt-1.5 bg-black text-green-200 rounded-lg p-2.5 text-[11px] overflow-auto max-h-56">
          {formatJson(item.raw)}
        </pre>
      )}
      {item.ts && (
        <p className="text-[10px] text-gray-400 mt-0.5">
          {new Date(item.ts).toLocaleString()}
        </p>
      )}
    </div>
  )
}
