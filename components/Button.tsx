import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive'
  loading?: boolean
  fullWidth?: boolean
}

const VARIANT_CLS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:     'py-4 rounded-xl text-headline font-semibold transition-all active:scale-[0.98] disabled:opacity-40 bg-accent text-white',
  secondary:   'text-accent text-headline font-semibold disabled:opacity-40',
  destructive: 'py-3 rounded-xl text-body font-medium disabled:opacity-40 text-negative',
}

export function Button({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const cls = [
    VARIANT_CLS[variant],
    fullWidth && 'w-full',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button {...props} disabled={loading || disabled} className={cls}>
      {loading ? '…' : children}
    </button>
  )
}
