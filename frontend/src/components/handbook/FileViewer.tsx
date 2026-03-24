/**
 * FileViewer — view-only display for PDF, DOCX, and image files.
 * Shows a download button and a "View Only" badge for all binary file types.
 */
import { Download, Lock } from 'lucide-react'
import { useRawFileUrl, useDocxHtmlUrl } from '@/api/knowledge'

interface Props {
  path: string
  file_type: string  // 'pdf' | 'docx' | 'image' | 'other'
  title: string
}

function ViewOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium border border-gray-200">
      <Lock size={10} />
      View Only
    </span>
  )
}

function DownloadBtn({ url, filename }: { url: string; filename: string }) {
  return (
    <a
      href={`${url}&download=true`}
      download={filename}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
    >
      <Download size={14} />
      Download
    </a>
  )
}

export default function FileViewer({ path, file_type, title }: Props) {
  const rawUrl = useRawFileUrl(path)
  const htmlUrl = useDocxHtmlUrl(path)
  const filename = path.split('/').pop() ?? path

  if (!rawUrl) return null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-800 truncate">{title}</span>
          <ViewOnlyBadge />
        </div>
        <DownloadBtn url={rawUrl} filename={filename} />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {file_type === 'pdf' && (
          <embed
            src={rawUrl}
            type="application/pdf"
            className="w-full h-full"
            title={title}
          />
        )}

        {file_type === 'image' && (
          <div className="flex items-center justify-center h-full bg-gray-50 p-4">
            <img
              src={rawUrl}
              alt={title}
              className="max-w-full max-h-full object-contain rounded shadow"
            />
          </div>
        )}

        {file_type === 'docx' && htmlUrl && (
          <iframe
            src={htmlUrl}
            className="w-full h-full border-0"
            title={title}
            sandbox="allow-same-origin"
          />
        )}

        {(file_type === 'other' || (file_type === 'docx' && !htmlUrl)) && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <Lock size={32} />
            <p className="text-sm">Preview not available</p>
            <DownloadBtn url={rawUrl} filename={filename} />
          </div>
        )}
      </div>
    </div>
  )
}
