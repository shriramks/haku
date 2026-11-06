'use client'

import type { SurchargeBracket } from '@/lib/tax-liability'

export const DEFAULT_SURCHARGE_BRACKET: SurchargeBracket = 'NONE'

const OPTIONS: readonly { value: SurchargeBracket; label: string }[] = [
  { value: 'NONE', label: 'None' },
  { value: 'S10',  label: '10% · 50 L - 1 Cr' },
  { value: 'S15',  label: '15% · 1 - 2 Cr' },
  { value: 'S25',  label: '25% · Above 2 Cr' },
]

interface Props {
  value:    SurchargeBracket
  onChange: (bracket: SurchargeBracket) => void
}

/** Inline surcharge-bracket picker for the tax page — a native <select> like
 * SlabRateSelect. Never persisted: the caller owns `value` via local state. */
export default function SurchargeSelect({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as SurchargeBracket)}
      className="text-headline font-semibold tabnum"
      style={{ background: 'transparent', color: 'var(--accent)', border: 'none', padding: 0 }}
    >
      {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
