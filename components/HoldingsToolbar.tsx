'use client'

import { useState } from 'react'
import { ArrowDownIcon } from '@/components/icons'
import { SORT_OPTIONS, type SortKey, type SortState } from '@/lib/holdings-sort'

export interface ToolbarPill { key: string; label: string; pct: number }

/**
 * The strip under a Portfolio section header: optional filter pills on the left, the sort control
 * on the right (progress log #121.a). Sort opens an anchored menu; picking the selected option flips
 * its direction (see `nextSort`), picking another switches key.
 */
export default function HoldingsToolbar({ sort, onSort, pills, activePill, onPill }: {
  sort: SortState
  onSort: (key: SortKey) => void
  pills?: ToolbarPill[]
  activePill?: string | null
  onPill?: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = SORT_OPTIONS.find(o => o.key === sort.key)

  return (
    <div className="relative flex items-center justify-between gap-2 px-4" style={{ minHeight: 48 }}>
      <div className="flex items-center gap-2">
        {pills?.map(p => {
          const active = activePill === p.key
          return (
            <button key={p.key}
                    onClick={() => onPill?.(p.key)}
                    aria-pressed={active}
                    className="flex items-center px-3 h-9 rounded-full flex-shrink-0 text-body font-medium whitespace-nowrap"
                    style={active
                      ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }
                      : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              {p.label} {p.pct}%
            </button>
          )
        })}
      </div>

      <button onClick={() => setOpen(o => !o)}
              aria-haspopup="menu" aria-expanded={open}
              className="flex items-center gap-1 text-body whitespace-nowrap"
              style={{ minHeight: 44, color: 'var(--accent)' }}>
        {current?.label}
        <ArrowDownIcon className={`w-[15px] h-[15px] ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute z-20 overflow-hidden rounded-xl"
               style={{
                 right: 12, top: 48, width: 236,
                 background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                 boxShadow: '0 10px 30px color-mix(in srgb, black 28%, transparent)',
               }}>
            <p className="text-subheadline font-semibold px-4 pt-2.5 pb-1" style={{ color: 'var(--text-2)' }}>Sort by</p>
            {SORT_OPTIONS.map((o, i) => {
              const selected = o.key === sort.key
              return (
                <button key={o.key} role="menuitem"
                        onClick={() => { onSort(o.key); setOpen(false) }}
                        className="flex w-full items-center justify-between px-4 text-body text-left"
                        style={{
                          minHeight: 44,
                          color: selected ? 'var(--accent)' : 'var(--text-primary)',
                          fontWeight: selected ? 600 : 400,
                          borderTop: i === 0 ? 'none' : '1px solid var(--divider)',
                        }}>
                  {o.label}
                  {selected && <ArrowDownIcon className={`w-[15px] h-[15px] ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
