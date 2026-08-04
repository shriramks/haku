'use client'

export const SLAB_RATES: readonly number[] = [0, 5, 10, 15, 20, 30]
export const DEFAULT_SLAB_RATE = 30

interface Props {
  value:    number
  onChange: (slabRatePct: number) => void
}

/** Inline slab-rate picker for the tax page — a native <select> deliberately,
 * not the app's usual bottom-sheet picker. Never persisted: the caller owns
 * `value` via local state that resets to DEFAULT_SLAB_RATE on mount. */
export default function SlabRateSelect({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="text-footnote font-semibold tabnum"
      style={{ background: 'transparent', color: 'var(--accent)', border: 'none', padding: 0 }}
    >
      {SLAB_RATES.map(rate => (
        <option key={rate} value={rate}>{rate}% slab</option>
      ))}
    </select>
  )
}
