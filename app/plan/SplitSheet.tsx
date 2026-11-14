'use client'
import { useState } from 'react'
import { Num } from '@/components/Num'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { Button } from '@/components/Button'
import { SLEEVES, SLEEVE_LABEL, sleevePct, round1, type Sleeve } from '@/lib/sleeves'
import type { FiscalYear } from '@/lib/types'
import { PlanFigures } from './PlanFigures'

/** The pool across Equity / Debt / Gold. Nothing is blocked: a total over 100 shows red and still saves. */
export function SplitSheet({ fy, pool, onClose, onSave }: {
  fy: FiscalYear
  pool: number
  onClose: () => void
  /** Resolves to an error message to show here, or null once saved. */
  onSave: (split: { equity_pct: number; debt_pct: number; gold_pct: number }) => Promise<string | null>
}) {
  const [vals, setVals] = useState<Record<Sleeve, number>>({
    equity: sleevePct(fy, 'equity'), debt: sleevePct(fy, 'debt'), gold: sleevePct(fy, 'gold'),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = round1(SLEEVES.reduce((s, sl) => s + vals[sl], 0))
  const set = (sl: Sleeve, v: number) => setVals(prev => ({ ...prev, [sl]: Math.max(0, round1(v)) }))

  async function handleSave() {
    setSaving(true)
    setError(null)
    const err = await onSave({ equity_pct: vals.equity, debt_pct: vals.debt, gold_pct: vals.gold })
    if (err) setError(err)
    setSaving(false)
  }

  const circle = { width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }
  return (
    <BottomSheet onClose={onClose}>
      <SheetHeader
        title="Split"
        left={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>}
        right={<Button variant="secondary" onClick={handleSave} loading={saving} style={{ minHeight: 44 }}>Save</Button>}
      />
      <div className="pt-2">
        {SLEEVES.map(sl => (
          <div key={sl} className="grid items-center px-5" style={{ gridTemplateColumns: '64px 1fr 72px', columnGap: 8, minHeight: 56 }}>
            <span className="text-body" style={{ color: 'var(--text-2)' }}>{SLEEVE_LABEL[sl]}</span>
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => set(sl, vals[sl] - 1)} className="flex items-center justify-center rounded-full text-2xl font-light" style={circle}>−</button>
              <div className="flex items-baseline justify-center" style={{ minWidth: 68 }}>
                <input
                  type="number" inputMode="decimal"
                  value={vals[sl]}
                  onChange={e => set(sl, parseFloat(e.target.value) || 0)}
                  className="text-title-1 font-bold tabnum text-right outline-none bg-transparent"
                  style={{ width: 52, color: 'var(--text-primary)' }}
                />
                <span className="text-title-1 font-bold">%</span>
              </div>
              <button onClick={() => set(sl, vals[sl] + 1)} className="flex items-center justify-center rounded-full text-2xl font-light" style={circle}>+</button>
            </div>
            <span className="text-body tabnum text-right"><Num amount={(vals[sl] / 100) * pool} /></span>
          </div>
        ))}
      </div>
      <PlanFigures rows={[{ label: 'Plan total', now: { pct: total }, gap: true, tone: true }]} />
      {error && <div className="px-5 py-3"><p className="text-body text-negative">{error}</p></div>}
    </BottomSheet>
  )
}
