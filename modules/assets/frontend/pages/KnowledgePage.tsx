import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useKnowledgeChanges } from "@modules/assets/frontend/api/knowledge"
import HandbookPage from './HandbookPage'
import ReviewQueue from '@modules/assets/frontend/components/knowledge/ReviewQueue'
import { readNamespacedStorage, writeNamespacedStorage } from '@storage'

type KnowledgeTab = 'review' | 'assets'
const KNOWLEDGE_TAB_STORAGE_KEY = 'knowledge-tab'

export default function KnowledgePage() {
  const [searchParams] = useSearchParams()
  const { data: proposals = [] } = useKnowledgeChanges('pending')
  const pendingCount = proposals.length

  const [tab, setTab] = useState<KnowledgeTab>(() => {
    const saved = readNamespacedStorage(KNOWLEDGE_TAB_STORAGE_KEY, ['kw-knowledge-tab']) as KnowledgeTab | null
    return saved ?? 'review'
  })

  // Auto-surface review tab when pending items exist and user hasn't explicitly chosen
  useEffect(() => {
    if (pendingCount > 0 && !readNamespacedStorage(KNOWLEDGE_TAB_STORAGE_KEY, ['kw-knowledge-tab'])) {
      setTab('review')
    }
  }, [pendingCount])

  useEffect(() => {
    if (searchParams.get('path') || searchParams.get('folder') || searchParams.get('new')) {
      setTab('assets')
      writeNamespacedStorage(KNOWLEDGE_TAB_STORAGE_KEY, 'assets', ['kw-knowledge-tab'])
    }
  }, [searchParams])

  function selectTab(next: KnowledgeTab) {
    setTab(next)
    writeNamespacedStorage(KNOWLEDGE_TAB_STORAGE_KEY, next, ['kw-knowledge-tab'])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-gray-200 px-4 pt-4 flex gap-4 bg-white flex-shrink-0">
        <button
          onClick={() => selectTab('review')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'review'
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Review
          {pendingCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-700 text-xs">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => selectTab('assets')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'assets'
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Assets
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'review' ? (
          <ReviewQueue />
        ) : (
          <HandbookPage />
        )}
      </div>
    </div>
  )
}
