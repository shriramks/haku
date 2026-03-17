'use client'
import { useState } from 'react'
import { formatINR } from '@/lib/formatter'
import type { BuyTranche } from '@/lib/types'

// Shared TrancheSection used by both BandsClient (inline mode) and StockDetailClient (card mode).
// card=false (default): outer border-t separator, for use inside an already-bordered expanded row
// card=true: outer rounded card with border, for use as a standalone section

export default function TrancheSection({
  symbol, tranches, remaining, hasBands,
  onToggle, onAdd, onDelete, onUpdate, onGenerate, onClear, generating,
  card = false,
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
  card?: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const plannedTotal = tranches.reduce((s, t) => s + t.qty * t.price, 0)

  const inner = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-2 mb-2">
        <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Tranches</p>
        <span className="text-[11px] tabnum" style={{ color: 'var(--text-muted)' }}>
          {formatINR(plannedTotal)} planned · {formatINR(remaining)} left
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
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
        {editingId === 'new' && (
          <TrancheInputRow
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
    </>
  )

  if (card) {
    return (
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)', padding: '6px 4px 4px 4px', background: 'var(--bg-secondary)' }}>
        {inner}
      </div>
    )
  }

  return (
    <div className="border-t" style={{ borderColor: 'var(--border-faint)', padding: '6px 4px 4px 4px' }}>
      {inner}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TrancheInputRow({ initialQty = '', initialPrice = '', onSave, onDelete, onCancel }: {
  initialQty?: string
  initialPrice?: string
  onSave: (qty: number, price: number) => Promise<void>
  onDelete?: () => void
  onCancel?: () => void
}) {
  const [qty, setQty]     = useState(initialQty)
  const [price, setPrice] = useState(initialPrice)
  const [saving, setSaving] = useState(false)

  async function save() {
    const q = parseFloat(qty), p = parseFloat(price)
    if (!q || !p) return
    setSaving(true)
    await onSave(q, p)
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-1.5 p-2 border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <input type="text" inputMode="numeric" placeholder="Qty" value={qty}
        onChange={e => setQty(e.target.value)}
        style={{ width: 80, padding: '8px', borderRadius: 10, fontSize: 14, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
      <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>×</span>
      <input type="text" inputMode="decimal" placeholder="Price ₹" value={price}
        onChange={e => setPrice(e.target.value)}
        style={{ width: 150, padding: '8px', borderRadius: 10, fontSize: 14, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
        <button onClick={save} disabled={saving || !qty || !price}
          style={{ width: 50, height: 50, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', cursor: 'pointer', opacity: (saving || !qty || !price) ? 0.4 : 1 }}>
          <SaveIcon className="w-5 h-5" style={{ color: 'var(--text-2)' }} />
        </button>
        {onDelete && (
          <button onClick={onDelete}
            style={{ width: 50, height: 50, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            <TrashIcon className="w-5 h-5" style={{ color: 'var(--text-2)' }} />
          </button>
        )}
        {onCancel && (
          <button onClick={onCancel}
            style={{ width: 50, height: 50, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            <XIcon className="w-5 h-5" style={{ color: 'var(--text-2)' }} />
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
    <div className="flex items-center px-4 py-4 gap-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <button onClick={() => onToggle(tranche.id, !tranche.allocated)}
        className="w-[26px] h-[26px] rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
        style={tranche.allocated ? { background: '#30D158', borderColor: '#30D158' } : { background: 'transparent', borderColor: 'var(--border)' }}>
        {tranche.allocated && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
      </button>
      <p className="flex-1 text-[13px] tabnum"
         style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-2)', textDecoration: tranche.allocated ? 'line-through' : 'none' }}>
        {Math.round(tranche.qty)} × ₹{tranche.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </p>
      <p className="text-[13px] font-semibold tabnum"
         style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-primary)' }}>
        {formatINR(amount)}
      </p>
      <button onClick={onEdit} className="flex-shrink-0 p-2.5" style={{ color: 'var(--text-faint)' }}>
        <PencilIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function XIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function SaveIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function TrashIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  )
}
