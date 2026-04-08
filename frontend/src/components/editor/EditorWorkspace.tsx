import type { ReactNode } from 'react'

export interface EditorWorkspaceTab<T extends string> {
  id: T
  label: string
}

export function EditorWorkspaceTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  actions,
}: {
  tabs: EditorWorkspaceTab<T>[]
  activeTab: T
  onTabChange: (tab: T) => void
  actions?: ReactNode
}) {
  return (
    <div className="border-b border-gray-200 bg-white px-4 py-1.5 flex items-center justify-between gap-4" style={{ flexShrink: 0 }}>
      <div className="flex items-center gap-4 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`py-1.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-brand-500 text-brand-600 font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function EditorWorkspaceBody({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex-1 overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

export function EditorSidePanel({
  children,
  width = 440,
  className = '',
}: {
  children: ReactNode
  width?: number
  className?: string
}) {
  return (
    <div
      style={{ width }}
      className={`flex-shrink-0 bg-white flex flex-col overflow-hidden border-l border-gray-200 ${className}`}
    >
      {children}
    </div>
  )
}
