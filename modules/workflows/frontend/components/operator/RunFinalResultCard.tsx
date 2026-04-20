import MarkdownViewer from '@ui/components/MarkdownViewer'

interface Props {
  finalOutput: string
  completedAt?: string | null
  onClick?: () => void
}

export default function RunFinalResultCard({ finalOutput, completedAt, onClick }: Props) {
  return (
    <div
      className="max-w-[96%] mr-auto rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 px-4 py-3 shadow-sm"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700">Workflow result</p>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
          Final output
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-gray-900">
        This is the result produced by the whole workflow after the end node completed.
      </p>
      <div className="mt-3 rounded-xl border border-white/90 bg-white/90 px-3 py-3">
        <MarkdownViewer content={finalOutput} compact />
      </div>
      {completedAt ? (
        <p className="mt-2 text-[10px] text-gray-500">
          Completed {new Date(completedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  )
}
