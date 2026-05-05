'use client'
import { useState } from 'react'
import { formatINRFine, formatPrice } from '@/lib/formatter'
import { Num } from '@/components/Num'
import { SparkleIcon, PlusIcon, TrashIcon } from '@/components/icons'
import type { BuyTranche } from '@/lib/types'

export default function TrancheSection({
  symbol, tranches, remaining, budget, hasBands, cmp,
  onAdd, onDelete, onUpdate, onGenerate, onClear, generating, hideHeader,
}: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  budget: number
  hasBands: boolean
  cmp?: number | null
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onUpdate: (id: string, qty: number, price: number) => Promise<void>
  onGenerate: () => void
  onClear: () => Promise<void>
  generating: boolean
  hideHeader?: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const plannedTotal = tranches.reduce((s, t) => s + t.qty * t.price, 0)

  return (
    <div style={{ padding: '6px 0 4px 0' }}>
      {/* Label + available amount */}
      {!hideHeader && (
        <div className="px-4 mb-3">
          <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Buy levels</p>
          {plannedTotal > 0 && (
            <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
              {formatINRFine(remaining - plannedTotal)} available after planned tranches
            </p>
          )}
        </div>
      )}
      {hideHeader && plannedTotal > 0 && (
        <p className="px-4 mb-3 text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
          {symbol} · {formatINRFine(remaining - plannedTotal)} remaining after tranches
        </p>
      )}
      {/* Actions — tinted accent buttons (less heavy than solid fill) */}
      <div className="flex gap-2.5 px-4 pb-3 pt-1">
        <button
          onClick={onGenerate}
          disabled={!hasBands || generating}
          className="flex-1 flex items-center justify-center gap-1.5 text-body font-semibold rounded-xl disabled:opacity-40"
          style={{ minHeight: 40, background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,122,255,0.25)', color: 'var(--accent)' }}>
          <SparkleIcon className="w-3.5 h-3.5" />
          {generating ? 'Generating…' : 'Generate'}
        </button>
        <button
          onClick={() => setEditingId(editingId === 'new' ? null : 'new')}
          className="flex-1 flex items-center justify-center gap-1.5 text-body font-semibold rounded-xl"
          style={{ minHeight: 40, background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,122,255,0.25)', color: 'var(--accent)' }}>
          <PlusIcon className="w-3.5 h-3.5" />
          Manual
        </button>
      </div>
      {tranches.length > 0 && (
        <div className="flex justify-end px-4 pb-2">
          <button
            onClick={() => onClear()}
            className="flex items-center gap-1.5 text-subheadline disabled:opacity-40 text-negative">
            <TrashIcon className="w-3 h-3" />
            Clear all
          </button>
        </div>
      )}

      {/* Tranche list */}
      <div>
        {editingId === 'new' && (
          <div style={{ borderTop: '1px solid var(--border-faint)' }}>
            <TrancheInputRow
              maxAmount={remaining - plannedTotal}
              onSave={async (qty, price) => { await onAdd(symbol, qty, price); setEditingId(null) }}
              onCancel={() => setEditingId(null)}
            />
          </div>
        )}
        {tranches.map(t => (
          <div key={t.id} style={{ borderTop: '1px solid var(--border-faint)' }}>
            {editingId === t.id
              ? <TrancheInputRow
                  initialQty={String(Math.round(t.qty))}
                  initialPrice={String(t.price)}
                  maxAmount={remaining - plannedTotal + t.qty * t.price}
                  onSave={async (qty, price) => { await onUpdate(t.id, qty, price); setEditingId(null) }}
                  onDelete={() => { onDelete(t.id); setEditingId(null) }}
                  onCancel={() => setEditingId(null)}
                />
              : <TrancheRow tranche={t} cmp={cmp} onEdit={() => setEditingId(editingId === t.id ? null : t.id)} />
            }
          </div>
        ))}
        {tranches.length === 0 && editingId !== 'new' && (
          <p className="px-4 py-3 text-subheadline" style={{ borderTop: '1px solid var(--border-faint)', color: 'var(--text-faint)' }}>
            No levels yet — tap Generate
          </p>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TrancheRow({ tranche, cmp, onEdit }: {
  tranche: BuyTranche
  cmp?: number | null
  onEdit: () => void
}) {
  const amount = tranche.qty * tranche.price

  const distPct = (cmp != null && cmp > 0)
    ? ((cmp - tranche.price) / cmp) * 100
    : null

  const cmpFormatted = cmp != null ? formatPrice(cmp) : null

  const distLabel = distPct == null
    ? null
    : distPct < 0
      ? `↑ ${Math.abs(distPct).toFixed(1)}% above ${cmpFormatted}`
      : `↓ ${distPct.toFixed(1)}% from ${cmpFormatted}`

  return (
    <div className="flex items-center px-4 py-3 gap-3">
      {/* Price × qty — GTT pair */}
      <div className="flex-1">
        <p className="tabnum" style={{ lineHeight: 1.2 }}>
          <span className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatPrice(tranche.price)}
          </span>
          <span className="text-body" style={{ color: 'var(--text-faint)', margin: '0 5px' }}>×</span>
          <span className="text-body" style={{ color: 'var(--text-2)' }}>
            {Math.round(tranche.qty)}
          </span>
        </p>
        {distLabel && (
          <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {distLabel}
          </p>
        )}
      </div>
      {/* Amount */}
      <p className="text-body font-semibold tabnum" style={{ color: 'var(--text-2)' }}>
        <Num amount={amount} />
      </p>
      {/* Edit — 44pt tap target */}
      <button onClick={onEdit} className="w-11 h-11 flex items-center justify-center flex-shrink-0 -mr-2"
              style={{ color: 'var(--text-faint)' }}>
        <PencilIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

function TrancheInputRow({ initialQty = '', initialPrice = '', maxAmount, onSave, onDelete, onCancel }: {
  initialQty?: string
  initialPrice?: string
  maxAmount: number
  onSave: (qty: number, price: number) => Promise<void>
  onDelete?: () => void
  onCancel?: () => void
}) {
  const [qty, setQty]     = useState(initialQty)
  const [price, setPrice] = useState(initialPrice)
  const [saving, setSaving] = useState(false)

  const amount = (parseFloat(qty) || 0) * (parseFloat(price) || 0)
  const overBudget = amount > 0 && amount > maxAmount

  async function save() {
    const q = parseFloat(qty), p = parseFloat(price)
    if (!q || !p || overBudget) return
    setSaving(true)
    await onSave(q, p)
    setSaving(false)
  }

  return (
    <div className="px-4 py-3" style={{ borderColor: 'var(--border-faint)' }}>
      <div className="flex items-center gap-2 mb-2">
        <input type="text" inputMode="numeric" placeholder="Qty" value={qty}
          onChange={e => setQty(e.target.value)}
          className="tabnum"
          style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, fontSize: 15, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none' }} />
        <span style={{ fontSize: 13, color: 'var(--text-faint)', flexShrink: 0 }}>×</span>
        <input type="text" inputMode="decimal" placeholder="Price" value={price}
          onChange={e => setPrice(e.target.value)}
          className="tabnum"
          style={{ flex: 2, minWidth: 0, padding: '10px 12px', borderRadius: 10, fontSize: 15, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none' }} />
      </div>

      {overBudget && (
        <p className="text-subheadline mb-2 tabnum" style={{ color: '#FF3B30' }}>
          Exceeds by {formatINRFine(amount - maxAmount)}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={save} disabled={saving || !qty || !price || overBudget}
            className="px-4 py-2.5 rounded-xl text-body font-semibold disabled:opacity-40 text-white bg-accent">
            {saving ? '…' : 'Save'}
          </button>
          {onDelete && (
            <button onClick={onDelete}
              className="px-4 py-2.5 rounded-xl text-body font-medium text-negative"
              style={{ background: 'rgba(255,59,48,0.10)', border: '1px solid rgba(255,59,48,0.20)' }}>
              Delete
            </button>
          )}
        </div>
        {onCancel && (
          <button onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-body font-medium"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function RefreshIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}


function XIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function PencilIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  )
}
