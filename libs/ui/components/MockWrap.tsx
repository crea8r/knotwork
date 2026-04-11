import type { ReactNode } from 'react'

/**
 * Wraps mock UI in an amber tint so it's visually obvious.
 * To go live: delete <MockWrap> wrapper; keep children.
 */
interface MockWrapProps {
  label: string
  children: ReactNode
}

export default function MockWrap({ label, children }: MockWrapProps) {
  return (
    <div className="relative rounded-lg border border-mock-border bg-mock-bg p-0.5">
      <span className="absolute -top-2 right-2 bg-mock-border text-mock-text text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
        mock · {label}
      </span>
      {children}
    </div>
  )
}
