import React from 'react'

interface StepperProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  suffix?: string
}

const round = (n: number) => parseFloat(n.toFixed(1))

export function Stepper({ value, min, max, step, onChange, suffix }: StepperProps) {
  return (
    <div className="flex items-center justify-center gap-4">
      <button
        onClick={() => onChange(Math.max(min, round(value - step)))}
        className="flex items-center justify-center rounded-full text-2xl font-light"
        style={{ width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
        −
      </button>
      <div className="flex items-baseline gap-1">
        <input
          type="number" inputMode="decimal"
          value={value}
          onChange={e => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
          className="font-bold tabnum text-right outline-none bg-transparent"
          style={{ fontSize: 40, width: 72, color: 'var(--text-primary)' }}
        />
        {suffix && <span className="font-bold" style={{ fontSize: 28, color: 'var(--text-primary)' }}>{suffix}</span>}
      </div>
      <button
        onClick={() => onChange(Math.min(max, round(value + step)))}
        className="flex items-center justify-center rounded-full text-2xl font-light"
        style={{ width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
        +
      </button>
    </div>
  )
}
