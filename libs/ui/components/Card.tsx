import type { HTMLAttributes, ReactNode } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export default function Card({ children, className = '', onClick, ...props }: CardProps) {
  const interactive = onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
  return (
    <div
      {...props}
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border border-gray-200 ${interactive} ${className}`}
    >
      {children}
    </div>
  )
}
