import MarkdownViewer from '@ui/components/MarkdownViewer'

interface Props {
  inputMarkdown: string
  createdAt?: string | null
  onClick?: () => void
}

export default function RunStartInputCard({ inputMarkdown, createdAt, onClick }: Props) {
  return (
    <div
      className="max-w-[96%] mr-auto rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 px-4 py-3 shadow-sm"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-sky-700">Start input</p>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">
          Workflow input
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-gray-900">
        This is the input that entered the workflow at the start node.
      </p>
      <div className="mt-3 rounded-xl border border-white/90 bg-white/90 px-3 py-3">
        <MarkdownViewer content={inputMarkdown} compact />
      </div>
      {createdAt ? (
        <p className="mt-2 text-[10px] text-gray-500">
          Started {new Date(createdAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  )
}
