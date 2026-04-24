import { MessageSquare } from 'lucide-react'

export default function AssetChatToggleButton({
  active,
  onClick,
  label = 'Open asset chat',
}: {
  active: boolean
  onClick: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-ui="shell.asset.breadcrumb.trailing.toggle"
      aria-pressed={active}
      className={`flex items-center justify-center rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
        active
          ? 'text-brand-600 hover:bg-brand-50 hover:text-brand-700'
          : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700'
      }`}
      aria-label={label}
      title={label}
    >
      <MessageSquare size={13} />
    </button>
  )
}
