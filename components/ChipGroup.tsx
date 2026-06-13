import React from 'react'

interface ChipGroupProps {
  items: string[]
  selected: string | null
  onSelect: (item: string) => void
  variant?: 'positive' | 'negative'
}

export function ChipGroup({ items, selected, onSelect, variant = 'positive' }: ChipGroupProps) {
  const accent = variant === 'positive' ? 'var(--c-positive)' : 'var(--c-negative)'
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => {
        const active = selected === item
        return (
          <button key={item} type="button" onClick={() => onSelect(item)}
            className="px-3 rounded-xl text-body font-semibold transition-colors"
            style={{
              minHeight: 36,
              ...(active
                ? { background: `color-mix(in srgb, ${accent} 10%, transparent)`, color: accent, border: `1.5px solid ${accent}` }
                : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1.5px solid transparent' }),
            }}>
            {item}
          </button>
        )
      })}
    </div>
  )
}
