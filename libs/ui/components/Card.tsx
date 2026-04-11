import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export default function Card({ children, className = '', onClick }: CardProps) {
  const interactive = onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border border-gray-200 ${interactive} ${className}`}
    >
      {children}
    </div>
  )
}
