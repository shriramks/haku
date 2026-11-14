'use client'
import { useState } from 'react'
import { Num } from '@/components/Num'
import { Button } from '@/components/Button'
import { ConfirmButtons } from '@/components/ConfirmButtons'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import { SLEEVES, SLEEVE_LABEL, sleevePct, round1, type Sleeve } from '@/lib/sleeves'
import type { FiscalYear } from '@/lib/types'
import { PlanFigures } from './PlanFigures'

export interface PlanSave {
  total_budget_inr: number
  equity_pct: number
  debt_pct: number
  gold_pct: number
}

/**
 * The one place the plan's pool is edited: the FY budget and how it splits across Equity / Debt / Gold. Nothing is
 * blocked — a split over 100 shows red and still saves. Carryover is read-only context (it is computed, not typed).
 */
export function PlanSheet({ fy, fyHasTxns, prevFYLabel, onClose, onSave, onDeleteFY }: {
  fy: FiscalYear
  fyHasTxns: boolean
  prevFYLabel?: string
  onClose: () => void
  /** Resolves to an error message to show here, or null once saved. */
  onSave: (patch: PlanSave) => Promise<string | null>
  onDeleteFY: () => void
}) {
  const [budgetInput, setBudgetInput] = useState(String(fy.total_budget_inr))
  const [vals, setVals] = useState<Record<Sleeve, number>>({
    equity: sleevePct(fy, 'equity'), debt: sleevePct(fy, 'debt'), gold: sleevePct(fy, 'gold'),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const kh = useKeyboardHeight()

  const carryover = fy.unallocated_carryover_inr ?? 0
  const budget = parseFloat(budgetInput) || 0
  const pool = budget + carryover
  const total = round1(SLEEVES.reduce((s, sl) => s + vals[sl], 0))
  const set = (sl: Sleeve, v: number) => setVals(prev => ({ ...prev, [sl]: Math.max(0, round1(v)) }))

  async function handleSave() {
    if (budget <= 0) { setError('Enter a budget'); return }
    setSaving(true)
    setError(null)
    const err = await onSave({ total_budget_inr: budget, equity_pct: vals.equity, debt_pct: vals.debt, gold_pct: vals.gold })
    if (err) setError(err)
    setSaving(false)
  }

  const circle = { width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>
          <p className="font-semibold text-headline">{fy.label} Plan</p>
          <Button variant="secondary" onClick={handleSave} loading={saving} style={{ minHeight: 44 }}>Save</Button>
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <p className="text-body">Budget</p>
          <input
            type="number" inputMode="decimal"
            value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
            className="text-headline font-semibold tabnum text-right outline-none rounded-xl px-3 py-1.5 w-36"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          />
        </div>
        {carryover !== 0 && prevFYLabel && (
          <div className="flex items-center justify-between px-5" style={{ minHeight: 36 }}>
            <p className="text-body" style={{ color: 'var(--text-2)' }}>Carryover from {prevFYLabel}</p>
            <p className="text-body font-semibold tabnum"><Num amount={carryover} signed /></p>
          </div>
        )}

        <div className="pt-2">
          {SLEEVES.map(sl => (
            <div key={sl} className="grid items-center px-5" style={{ gridTemplateColumns: '64px 1fr 72px', columnGap: 8, minHeight: 56 }}>
              <span className="text-body" style={{ color: 'var(--text-2)' }}>{SLEEVE_LABEL[sl]}</span>
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => set(sl, vals[sl] - 1)} aria-label={`Less ${SLEEVE_LABEL[sl]}`} className="flex items-center justify-center rounded-full text-2xl font-light" style={circle}>−</button>
                <div className="flex items-baseline justify-center" style={{ minWidth: 68 }}>
                  <input
                    type="number" inputMode="decimal"
                    value={vals[sl]}
                    onChange={e => set(sl, parseFloat(e.target.value) || 0)}
                    className="text-title-1 font-bold tabnum text-right outline-none bg-transparent"
                    style={{ width: `${String(vals[sl]).length + 0.4}ch`, minWidth: '1.4ch', color: 'var(--text-primary)' }}
                  />
                  <span className="text-title-1 font-bold">%</span>
                </div>
                <button onClick={() => set(sl, vals[sl] + 1)} aria-label={`More ${SLEEVE_LABEL[sl]}`} className="flex items-center justify-center rounded-full text-2xl font-light" style={circle}>+</button>
              </div>
              <span className="text-body tabnum text-right"><Num amount={(vals[sl] / 100) * pool} /></span>
            </div>
          ))}
        </div>
        <PlanFigures rows={[{ label: 'Plan total', now: { pct: total }, gap: true, tone: true }]} />
        {error && <div className="px-5 py-3"><p className="text-body text-negative">{error}</p></div>}

        <div className="px-5 pt-2">
          {confirmDelete ? (
            <ConfirmButtons
              message={fyHasTxns ? 'Clear allocations?' : 'Delete this plan?'}
              cancelLabel="No" confirmLabel={fyHasTxns ? 'Clear' : 'Delete'}
              onCancel={() => setConfirmDelete(false)} onConfirm={onDeleteFY}
              variant="negative"
            />
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="w-full py-3 rounded-xl text-body font-medium text-negative"
              style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)' }}>
              {fyHasTxns ? 'Clear Plan' : 'Delete Plan'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
