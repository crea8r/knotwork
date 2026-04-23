import type { ReactNode } from 'react'

export default function ChannelPageTemplate({
  eyebrow,
  title,
  description,
  status,
  channel,
  sidePanel,
}: {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  status?: ReactNode
  channel: ReactNode
  sidePanel?: ReactNode
}) {
  return (
    <div data-ui="channel.page" className="min-h-0 overflow-y-auto p-4 md:p-8">
      <div data-ui="channel.page.inner" className="mx-auto flex max-w-7xl flex-col gap-6">
        <div data-ui="channel.page.header" className="flex items-start justify-between gap-4">
          <div data-ui="channel.page.header.main" className="min-w-0">
            {eyebrow ? <div data-ui="channel.page.header.eyebrow" className="min-w-0 text-xs text-stone-500">{eyebrow}</div> : null}
            {title ? <h1 data-ui="channel.page.header.title" className={`${eyebrow ? 'mt-1' : ''} truncate text-xl font-semibold text-stone-950 md:text-2xl`}>{title}</h1> : null}
            {description ? <div data-ui="channel.page.header.description" className="mt-1 text-sm text-stone-600">{description}</div> : null}
          </div>
          {status ? <div data-ui="channel.page.header.actions" className="flex shrink-0 items-center gap-2">{status}</div> : null}
        </div>

        {sidePanel ? <section data-ui="channel.page.side-panel" className="space-y-4">{sidePanel}</section> : null}
        <div data-ui="channel.page.content" className="min-h-[640px]">{channel}</div>
      </div>
    </div>
  )
}
