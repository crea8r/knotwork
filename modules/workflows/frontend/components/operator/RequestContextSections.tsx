import { useMemo } from 'react'
import MarkdownViewer from '@ui/components/MarkdownViewer'
import { parseRequestContext } from '@modules/workflows/frontend/lib/requestContext'

interface Props {
  contextMarkdown?: string | null
}

export default function RequestContextSections({ contextMarkdown }: Props) {
  const context = useMemo(() => parseRequestContext(contextMarkdown), [contextMarkdown])

  if (!context.raw) return null

  return (
    <div className="space-y-2">
      {context.taskBrief ? (
        <div className="rounded-lg border border-amber-100 bg-white px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Task brief</p>
          <MarkdownViewer content={context.taskBrief} compact />
        </div>
      ) : null}

      {context.handbookEntries.length > 0 ? (
        <details className="rounded-lg border border-amber-100 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
            Knowledge context · {context.handbookEntries.length} file{context.handbookEntries.length === 1 ? '' : 's'}
          </summary>
          <div className="space-y-2 border-t border-amber-100 px-3 py-3">
            {context.handbookEntries.map((entry) => (
              <details key={entry.path} className="rounded-lg border border-gray-200 bg-gray-50/80">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                  <span className="font-mono text-[11px]">{entry.path}</span>
                </summary>
                <div className="max-h-56 overflow-y-auto border-t border-gray-200 bg-white px-3 py-2">
                  <MarkdownViewer content={entry.content} compact />
                </div>
              </details>
            ))}
          </div>
        </details>
      ) : null}

      {context.missingHandbookFiles.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-amber-700">Missing knowledge files</p>
          <ul className="space-y-1 text-xs text-amber-900/85">
            {context.missingHandbookFiles.map((path) => (
              <li key={path} className="font-mono">
                {path}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {context.extraSections
        .filter((section) => section.content !== context.taskBrief)
        .map((section) => (
          <div key={`${section.title}-${section.content.slice(0, 24)}`} className="rounded-lg border border-amber-100 bg-white px-3 py-2">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{section.title}</p>
            <MarkdownViewer content={section.content} compact />
          </div>
        ))}
    </div>
  )
}
