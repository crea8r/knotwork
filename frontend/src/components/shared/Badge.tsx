import type { ReactNode } from 'react'

interface BadgeProps {
  variant?: 'blue' | 'green' | 'orange' | 'red' | 'gray' | 'purple'
  size?: 'sm' | 'md'
  children: ReactNode
}

const VARIANT = {
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-green-100 text-green-800',
  orange: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-gray-100 text-gray-700',
  purple: 'bg-purple-100 text-purple-800',
}

const SIZE = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-1 text-sm',
}

export default function Badge({ variant = 'gray', size = 'sm', children }: BadgeProps) {
  return (
    <span className={`inline-block rounded-full font-medium ${VARIANT[variant]} ${SIZE[size]}`}>
      {children}
    </span>
  )
}
