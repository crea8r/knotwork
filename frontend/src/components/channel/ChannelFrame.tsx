import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Edit2, Loader2, Send } from 'lucide-react'
import Btn from '@/components/shared/Btn'
import MarkdownViewer from '@/components/shared/MarkdownViewer'

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const seconds = Math.max(0, Math.floor(diffMs / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return ''
}

function formatAbsoluteTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(iso))
}

export type ChannelTimelineItem =
  | {
      id: string
      kind: 'message'
      authorLabel: string
      tone?: 'human' | 'agent' | 'system'
      mine?: boolean
      content: ReactNode | string
      markdown?: boolean
      ts?: string | null
    }
  | {
      id: string
      kind: 'decision'
      label: string
      actorName?: string | null
      ts?: string | null
    }
  | {
      id: string
      kind: 'custom'
      content: ReactNode
    }

export function ChannelShell({
  eyebrow,
  title,
  typeIcon,
  parentLabel,
  description,
  status,
  actions,
  context,
  topPanel,
  onRenameTitle,
  renamePending,
  shellClassName,
  children,
}: {
  eyebrow?: ReactNode
  title?: string
  typeIcon?: ReactNode
  parentLabel?: string | null
  description?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  context?: ReactNode
  topPanel?: ReactNode
  onRenameTitle?: (value: string) => void | Promise<void>
  renamePending?: boolean
  shellClassName?: string
  children: ReactNode
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title ?? '')

  async function submitRename() {
    const next = draftTitle.trim()
    if (!next || !onRenameTitle || next === title) {
      setDraftTitle(title ?? '')
      setEditingTitle(false)
      return
    }
    await onRenameTitle(next)
    setEditingTitle(false)
  }

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-stone-200 bg-white ${shellClassName ?? ''}`}>
      <div className="border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? <div className="min-w-0 text-[11px] text-stone-500">{eyebrow}</div> : null}
            {title ? (
              editingTitle ? (
                <div className={`${eyebrow ? 'mt-1.5' : ''} flex items-center gap-2`}>
                  {typeIcon ? (
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-stone-500">
                      {typeIcon}
                    </span>
                  ) : null}
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => { void submitRename() }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void submitRename()
                      }
                      if (e.key === 'Escape') {
                        setDraftTitle(title)
                        setEditingTitle(false)
                      }
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-semibold text-stone-900 outline-none focus:ring-2 focus:ring-stone-900"
                  />
                  {status}
                </div>
              ) : (
                <div className={`${eyebrow ? 'mt-1.5' : ''} flex items-center gap-2`}>
                  {typeIcon ? (
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-stone-500">
                      {typeIcon}
                    </span>
                  ) : null}
                  <h2 className="truncate text-sm font-semibold text-stone-900">{title}</h2>
                  {onRenameTitle ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftTitle(title)
                        setEditingTitle(true)
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                      title="Rename channel"
                      disabled={renamePending}
                    >
                      {renamePending ? <Loader2 size={13} className="animate-spin" /> : <Edit2 size={13} />}
                    </button>
                  ) : null}
                  {status}
                </div>
              )
            ) : null}
            {parentLabel ? <p className={`${title ? 'mt-0.5' : eyebrow ? 'mt-1.5' : ''} text-[11px] text-stone-500`}>{parentLabel}</p> : null}
            {description ? <div className="mt-1.5 text-sm text-stone-600">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {context ? <div className="mt-3 flex flex-wrap gap-2">{context}</div> : null}
      </div>
      {topPanel ? <div className="shrink-0">{topPanel}</div> : null}
      {children}
    </div>
  )
}

export function ChannelContextPill({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-700">
      {children}
    </div>
  )
}

export function ChannelTimeline({
  items,
  emptyState = 'No messages yet.',
  highlightedItemId,
}: {
  items: ChannelTimelineItem[]
  emptyState?: string
  highlightedItemId?: string | null
}) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!highlightedItemId) return
    const node = itemRefs.current.get(highlightedItemId)
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightedItemId, items])

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf7f1] p-4 space-y-3">
      {items.length === 0 ? <p className="text-sm text-stone-500">{emptyState}</p> : items.map((item) => {
        if (item.kind === 'message') {
          const relative = item.ts ? formatRelativeTime(item.ts) : ''
          const absolute = item.ts ? formatAbsoluteTime(item.ts) : ''
          return (
            <div
              key={item.id}
              ref={(node) => {
                if (node) itemRefs.current.set(item.id, node)
                else itemRefs.current.delete(item.id)
              }}
              className={`max-w-[92%] ${item.mine ? 'ml-auto' : 'mr-auto'}`}
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-stone-400">
                <p>{item.authorLabel}</p>
                {item.ts ? (
                  <p className="normal-case tracking-normal text-stone-400" title={absolute}>
                    {relative ? `${relative} · ${absolute}` : absolute}
                  </p>
                ) : null}
              </div>
              <div className={`rounded-2xl border px-4 py-2.5 text-sm ${
                item.mine
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : item.tone === 'system'
                    ? 'border-stone-200 bg-stone-100 text-stone-800'
                    : 'border-stone-200 bg-white text-stone-800'
              } ${highlightedItemId === item.id ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-[#faf7f1]' : ''}`}>
                {item.markdown && typeof item.content === 'string' ? (
                  <MarkdownViewer content={item.content} compact theme={item.mine ? 'inverse' : 'default'} />
                ) : (
                  typeof item.content === 'string' ? <span className="whitespace-pre-wrap">{item.content}</span> : item.content
                )}
              </div>
            </div>
          )
        }

        if (item.kind === 'decision') {
          const relative = item.ts ? formatRelativeTime(item.ts) : ''
          const absolute = item.ts ? formatAbsoluteTime(item.ts) : ''
          return (
            <div key={item.id} className="max-w-[92%] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-amber-700">Decision</p>
              <p className="text-sm text-amber-900">{item.label}</p>
              {item.actorName ? <p className="mt-1 text-[11px] text-amber-700">by {item.actorName}</p> : null}
              {item.ts ? (
                <p className="mt-1 text-[11px] text-amber-700/80" title={absolute}>
                  {relative ? `${relative} · ${absolute}` : absolute}
                </p>
              ) : null}
            </div>
          )
        }

        return <div key={item.id}>{item.content}</div>
      })}
    </div>
  )
}

export function ChannelComposer({
  draft,
  setDraft,
  onSend,
  placeholder,
  pending = false,
  rows = 3,
  sendLabel = 'Send',
  inputRef,
  beforeInput,
}: {
  draft: string
  setDraft: (value: string) => void
  onSend: () => void
  placeholder: string
  pending?: boolean
  rows?: number
  sendLabel?: string
  inputRef?: Ref<HTMLTextAreaElement>
  beforeInput?: ReactNode
}) {
  return (
    <div className="border-t border-stone-200 bg-white p-3 flex-shrink-0">
      {beforeInput ? <div className="mb-2 space-y-2">{beforeInput}</div> : null}
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={rows}
        disabled={pending}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.trim()) {
            e.preventDefault()
            onSend()
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900 resize-none disabled:bg-stone-50 disabled:text-stone-500"
      />
      <div className="mt-2 flex justify-end">
        <Btn size="sm" onClick={onSend} disabled={!draft.trim() || pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {pending ? 'Thinking…' : sendLabel}
        </Btn>
      </div>
    </div>
  )
}
