/**
 * KnowledgeFilePage — standalone route for direct linking to a knowledge asset file.
 * Delegates rendering to FileEditor for direct knowledge file links.
 */
import { useSearchParams, Link } from 'react-router-dom'
import FileEditor from '@modules/assets/frontend/components/handbook/FileEditor'

export default function KnowledgeFilePage() {
  const [params] = useSearchParams()
  const path = params.get('path') ?? ''

  if (!path) return <div className="p-8 text-red-500">No file path specified.</div>

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 px-5 pt-4 pb-1">
        <Link to="/knowledge" className="hover:text-gray-600">Knowledge</Link>
        <span>›</span>
        <span className="text-gray-600 font-mono">{path}</span>
      </div>

      <div className="flex-1 overflow-hidden">
        <FileEditor path={path} />
      </div>
    </div>
  )
}
