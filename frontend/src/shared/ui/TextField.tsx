import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  description?: string
  error?: string
  leadingIcon?: ReactNode
}

export function TextField({
  id,
  label,
  description,
  error,
  leadingIcon,
  className = '',
  ...props
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <label htmlFor={inputId} className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">
      <span>{label}</span>
      <span className="relative block">
        {leadingIcon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]"
          >
            {leadingIcon}
          </span>
        ) : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-11 w-full rounded-[var(--radius-control)] border bg-white px-3 text-sm font-normal text-[var(--text)] shadow-[0_1px_0_rgb(32_37_56_/_2%)] transition-[border-color,box-shadow] placeholder:text-[var(--text-muted)]/70 focus:border-[var(--primary)] focus:outline-none focus:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-[var(--surface-subtle)] disabled:text-[var(--text-muted)] ${leadingIcon ? 'pl-10' : ''} ${error ? 'border-[var(--danger)]' : 'border-[var(--border)]'} ${className}`}
          {...props}
        />
      </span>
      {description ? (
        <span id={descriptionId} className="text-xs font-normal text-[var(--text-muted)]">
          {description}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className="text-xs font-medium text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </label>
  )
}
