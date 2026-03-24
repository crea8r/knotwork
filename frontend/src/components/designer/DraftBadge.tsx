/** Amber pill shown in the designer header when the user is viewing a draft. */
export default function DraftBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Draft
    </span>
  )
}
