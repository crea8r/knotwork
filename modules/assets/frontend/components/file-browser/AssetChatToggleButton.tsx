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
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
        active
          ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
          : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800'
      }`}
      aria-label={label}
      title={label}
    >
      <MessageSquare size={13} />
    </button>
  )
}
