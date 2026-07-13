import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-[var(--primary-action)] text-white shadow-[0_8px_20px_rgb(113_101_234_/_20%)] hover:bg-[var(--primary-hover)]',
  secondary:
    'border-[var(--border)] bg-white text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-subtle)]',
  ghost:
    'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]',
  danger:
    'border-transparent bg-[var(--danger-action)] text-white hover:brightness-95',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-10 rounded-lg px-3 text-xs',
  md: 'min-h-10 rounded-[var(--radius-control)] px-4 text-sm',
  lg: 'min-h-12 rounded-xl px-5 text-sm',
}

export function Button({
  className = '',
  type = 'button',
  variant = 'primary',
  size = 'md',
  leadingIcon,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 border font-semibold transition-[background-color,border-color,color,box-shadow,scale] duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:scale-[.96] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {leadingIcon ? <span aria-hidden="true">{leadingIcon}</span> : null}
      {children}
    </button>
  )
}
