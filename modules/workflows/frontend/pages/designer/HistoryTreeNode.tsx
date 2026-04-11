import { FileEdit, GitBranch } from 'lucide-react'

export default function HistoryTreeNode({
  label,
  meta,
  badges,
  depth,
  selected,
  onClick,
  isDraft = false,
}: {
  label: string
  meta: string
  badges: React.ReactNode
  depth: number
  selected: boolean
  onClick: () => void
  isDraft?: boolean
}) {
  const Icon = isDraft ? FileEdit : GitBranch
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
        selected ? 'border-brand-300 bg-brand-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
      style={{ marginLeft: depth * 18 }}
    >
      <div className="flex items-center gap-2">
        <Icon
          size={14}
          className={selected ? 'text-brand-600' : isDraft ? 'text-amber-400' : 'text-gray-300'}
        />
        <p className="truncate text-sm font-semibold text-gray-900">{label}</p>
        {badges}
      </div>
      <p className="mt-1 text-xs text-gray-500">{meta}</p>
    </button>
  )
}
