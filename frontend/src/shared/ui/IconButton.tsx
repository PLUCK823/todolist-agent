import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string
  icon: ReactNode
  size?: 'sm' | 'md' | 'lg'
  tone?: 'default' | 'primary' | 'onDark'
}

const sizeClasses = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-[var(--radius-control)]',
  lg: 'h-12 w-12 rounded-xl',
}

const toneClasses = {
  default: 'text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]',
  primary: 'bg-[var(--primary-action)] text-white hover:bg-[var(--primary-hover)]',
  onDark: 'text-white/70 hover:bg-white/10 hover:text-white',
}

export function IconButton({
  label,
  icon,
  size = 'md',
  tone = 'default',
  type = 'button',
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center transition-[background-color,color,box-shadow,scale] duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:scale-[.96] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}
      {...props}
    >
      <span aria-hidden="true" className="flex items-center justify-center">
        {icon}
      </span>
    </button>
  )
}
