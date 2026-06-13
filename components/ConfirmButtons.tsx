import React from 'react'

interface ConfirmButtonsProps {
  message?: React.ReactNode
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  variant?: 'negative' | 'primary'
  loading?: boolean
  disabled?: boolean
  className?: string
}

export function ConfirmButtons({
  message, cancelLabel, confirmLabel, onCancel, onConfirm,
  variant = 'negative', loading = false, disabled = false, className,
}: ConfirmButtonsProps) {
  const negative = variant === 'negative'
  return (
    <div className={['flex items-center gap-3', className].filter(Boolean).join(' ')}>
      {message && (
        <p className="flex-1 text-subheadline" style={{ color: 'var(--text-muted)' }}>{message}</p>
      )}
      <button onClick={onCancel}
        className="px-3 rounded-xl text-subheadline"
        style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', minHeight: 44 }}>
        {cancelLabel}
      </button>
      <button onClick={onConfirm} disabled={loading || disabled}
        className={`px-3 rounded-xl text-subheadline font-semibold disabled:opacity-40 ${negative ? 'text-negative' : 'text-accent'}`}
        style={{ background: negative ? 'rgba(255,59,48,0.10)' : 'rgba(10,132,255,0.12)', minHeight: 44 }}>
        {loading ? '…' : confirmLabel}
      </button>
    </div>
  )
}
