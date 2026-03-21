'use client'
import { useState } from 'react'
import { formatINR } from '@/lib/formatter'
import type { BuyTranche } from '@/lib/types'

export default function TrancheSection({
  symbol, tranches, remaining, hasBands,
  onToggle, onAdd, onDelete, onUpdate, onGenerate, onClear, generating,
}: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  hasBands: boolean
  onToggle: (id: string, allocated: boolean) => void
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onUpdate: (id: string, qty: number, price: number) => Promise<void>
  onGenerate: () => void
  onClear: () => Promise<void>
  generating: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const plannedTotal = tranches.reduce((s, t) => s + t.qty * t.price, 0)

  return (
    <div className="border-t" style={{ borderColor: 'var(--border-faint)', padding: '6px 4px 4px 4px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 mb-2">
        <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Tranches</p>
        <span className="text-[13px] font-semibold tabnum" style={{ color: 'var(--text-2)' }}>
          {formatINR(remaining)} / {formatINR(plannedTotal)} left
        </span>
      </div>

      {/* 3-button bar */}
      <div className="flex gap-1.5 px-2 mb-2">
        <button
          onClick={onGenerate}
          disabled={!hasBands || generating}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[14px] font-medium disabled:opacity-40"
          style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }}>
          <RefreshIcon className={`w-3.5 h-3.5 ${generating ? 'spin' : ''}`} />
          {generating ? '…' : 'Generate'}
        </button>
        <button
          onClick={() => setEditingId(editingId === 'new' ? null : 'new')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[14px] font-medium"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          <PlusIcon className="w-3.5 h-3.5" />
          Add
        </button>
        <button
          onClick={() => onClear()}
          disabled={tranches.length === 0}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[14px] font-medium disabled:opacity-40"
          style={{ background: 'rgba(255,59,48,0.10)', color: '#FF3B30', border: '1px solid rgba(255,59,48,0.20)' }}>
          <XIcon className="w-3.5 h-3.5" />
          Clear All
        </button>
      </div>

      {/* Tranche list */}
      <div className="divide-y" style={{ borderColor: 'var(--border-faint)' }}>
        {editingId === 'new' && (
          <TrancheInputRow
            maxAmount={remaining - plannedTotal}
            onSave={async (qty, price) => { await onAdd(symbol, qty, price); setEditingId(null) }}
            onCancel={() => setEditingId(null)}
          />
        )}
        {tranches.map(t =>
          editingId === t.id
            ? <TrancheInputRow
                key={t.id}
                initialQty={String(Math.round(t.qty))}
                initialPrice={String(t.price)}
                maxAmount={remaining - plannedTotal + t.qty * t.price}
                onSave={async (qty, price) => { await onUpdate(t.id, qty, price); setEditingId(null) }}
                onDelete={() => { onDelete(t.id); setEditingId(null) }}
                onCancel={() => setEditingId(null)}
              />
            : <TrancheRow key={t.id} tranche={t} onToggle={onToggle} onEdit={() => setEditingId(editingId === t.id ? null : t.id)} />
        )}
        {tranches.length === 0 && editingId !== 'new' && (
          <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>No tranches yet — tap Generate</p>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
          style={{ flex: 1, padding: '10px 12px', borderRadius: 10, fontSize: 15, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none' }} />
        <span style={{ fontSize: 13, color: 'var(--text-faint)', flexShrink: 0 }}>×</span>
        <input type="text" inputMode="decimal" placeholder="Price ₹" value={price}
          onChange={e => setPrice(e.target.value)}
          className="tabnum"
          style={{ flex: 2, padding: '10px 12px', borderRadius: 10, fontSize: 15, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none' }} />
      </div>

      {overBudget && (
        <p className="text-[12px] mb-2 tabnum" style={{ color: '#FF3B30' }}>
          Exceeds allocation by {formatINR(amount - maxAmount)} — max {formatINR(maxAmount)}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={save} disabled={saving || !qty || !price || overBudget}
            className="px-4 py-2.5 rounded-xl text-[14px] font-semibold disabled:opacity-40 text-white"
            style={{ background: '#0A84FF' }}>
            {saving ? '…' : 'Save'}
          </button>
          {onDelete && (
            <button onClick={onDelete}
              className="px-4 py-2.5 rounded-xl text-[14px] font-medium"
              style={{ background: 'rgba(255,59,48,0.10)', color: '#FF3B30', border: '1px solid rgba(255,59,48,0.20)' }}>
              Delete
            </button>
          )}
        </div>
        {onCancel && (
          <button onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-[14px] font-medium"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function TrancheRow({ tranche, onToggle, onEdit }: {
  tranche: BuyTranche
  onToggle: (id: string, allocated: boolean) => void
  onEdit: () => void
}) {
  const amount = tranche.qty * tranche.price
  return (
    <div className="flex items-center px-4 py-3 gap-3">
      {/* Checkbox — 44pt tap target */}
      <button onClick={() => onToggle(tranche.id, !tranche.allocated)}
        className="w-11 h-11 flex items-center justify-center flex-shrink-0 -ml-2">
        <div className="w-[26px] h-[26px] rounded-full border-2 flex items-center justify-center transition-colors"
          style={tranche.allocated ? { background: '#30D158', borderColor: '#30D158' } : { background: 'transparent', borderColor: 'var(--border)' }}>
          {tranche.allocated && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
        </div>
      </button>
      <p className="flex-1 text-[13px] tabnum"
         style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-2)', textDecoration: tranche.allocated ? 'line-through' : 'none' }}>
        {Math.round(tranche.qty)} × ₹{tranche.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </p>
      <p className="text-[13px] font-semibold tabnum"
         style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-primary)' }}>
        {formatINR(amount)}
      </p>
      {/* Edit — 44pt tap target */}
      <button onClick={onEdit} className="w-11 h-11 flex items-center justify-center flex-shrink-0 -mr-2"
              style={{ color: 'var(--text-faint)' }}>
        <PencilIcon className="w-4 h-4" />
      </button>
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

function PlusIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
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
