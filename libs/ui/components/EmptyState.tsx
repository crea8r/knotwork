import type { ReactNode } from 'react'
import Btn from './Btn'

interface EmptyStateProps {
  icon?: ReactNode
  heading: string
  subtext?: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon, heading, subtext, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      {icon && <div className="text-4xl mb-3 text-gray-300">{icon}</div>}
      <p className="font-medium text-gray-600">{heading}</p>
      {subtext && <p className="text-sm text-gray-400 mt-1 max-w-xs">{subtext}</p>}
      {action && (
        <div className="mt-4">
          <Btn variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </Btn>
        </div>
      )}
    </div>
  )
}
