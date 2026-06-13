import React from 'react'

interface LabeledInputProps {
  label: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  type?: 'number' | 'text'
  readOnly?: boolean
  step?: string
  autoFocus?: boolean
  invalid?: boolean
  onEnter?: () => void
}

export function LabeledInput({
  label, value, onChange, placeholder, type = 'number',
  readOnly, step, autoFocus, invalid, onEnter,
}: LabeledInputProps) {
  const box = 'w-full px-3.5 py-3.5 rounded-xl text-headline tabnum outline-none'
  const boxStyle = {
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    border: `1px solid ${invalid ? 'var(--c-warning)' : 'var(--border)'}`,
  }
  return (
    <div>
      <label className="text-subheadline block mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {readOnly ? (
        <div className={box} style={boxStyle}>{value}</div>
      ) : (
        <input
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={step}
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          onChange={e => onChange?.(e.target.value)}
          onKeyDown={onEnter ? e => { if (e.key === 'Enter') onEnter() } : undefined}
          onFocus={e => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
          className={box}
          style={boxStyle}
        />
      )}
    </div>
  )
}
