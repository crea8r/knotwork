import { GitBranch } from 'lucide-react'
import Btn from '@ui/components/Btn'

export default function WorkflowEntryPanel({
  title,
  description,
  onOpen,
}: {
  title: string
  description?: string | null
  onOpen?: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-[28px] border border-stone-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-600">
          <GitBranch size={20} />
        </div>
        <h3 className="mt-4 text-base font-semibold text-stone-900">{title}</h3>
        <p className="mt-2 text-sm text-stone-500">
          {description || 'This workflow lives alongside assets. Open it in the main workspace when you need the full designer.'}
        </p>
        {onOpen ? (
          <div className="mt-5 flex justify-center">
            <Btn size="sm" onClick={onOpen}>Open workflow</Btn>
          </div>
        ) : null}
      </div>
    </div>
  )
}
