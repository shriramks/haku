// Compact CMP badge for list rows. Shows zone color only for buy/deep.
// Uses CSS classes for dark-mode-aware colors (defined in globals.css).

type Signal = 'buy' | 'deep' | 'hold' | 'trim' | 'unknown'

export default function CmpBadge({ cmp, signal }: { cmp: number; signal: Signal }) {
  const formatted = `₹${Math.round(cmp)}`

  if (signal === 'buy') {
    return (
      <span
        className="text-footnote tabnum font-semibold flex-shrink-0 cmp-color-buy"
        style={{ padding: '2px 7px', borderRadius: 6, background: 'rgba(34,197,94,0.13)' }}>
        {formatted}
      </span>
    )
  }
  if (signal === 'deep') {
    return (
      <span
        className="text-footnote tabnum font-semibold flex-shrink-0 cmp-color-deep"
        style={{ padding: '2px 7px', borderRadius: 6, background: 'rgba(4,120,87,0.13)' }}>
        {formatted}
      </span>
    )
  }
  return (
    <span className="text-footnote tabnum flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
      {formatted}
    </span>
  )
}
