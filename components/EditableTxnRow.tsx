'use client'
import { useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatDate, formatPriceNum, formatPriceFineNum } from '@/lib/formatter'
import { updateStockTransaction, deleteStockTransaction } from '@/app/actions'
import { revalidateMFTransactions, revalidateSGBTransactions, revalidatePPFTransactions, revalidateEPFTransactions } from '@/app/portfolio/actions'
import { Num } from '@/components/Num'
import type { Transaction } from '@/lib/types'
import type { MFTransaction, SGBTransaction, PPFTransaction, EPFTransaction } from '@/lib/portfolio-types'
import { PencilIcon } from '@/components/icons'

// ── Asset types ───────────────────────────────────────────────────────────────

export type AssetType = 'stock' | 'mf' | 'gold' | 'ppf' | 'epf'

export const ASSET_LABELS: Record<AssetType, string> = {
  stock: 'Stocks', mf: 'MF', gold: 'Gold', ppf: 'PPF', epf: 'EPF',
}

// ── Unified display type ──────────────────────────────────────────────────────

export interface DisplayTxn {
  id: string
  asset: AssetType
  name: string
  trade_date: string
  direction: 'in' | 'out' | 'neutral'
  trade_type: string
  amount: number
  signedAmount: number
  detail: string
  rawStock?: Transaction
  rawMF?: MFTransaction
  rawSGB?: SGBTransaction
  rawPPF?: PPFTransaction
  rawEPF?: EPFTransaction
}

function fmtQty(n: number, dec: number): string {
  return n % 1 === 0 ? String(n) : parseFloat(n.toFixed(dec)).toString()
}
function fmtNav(n: number): string {
  return n % 1 === 0 ? String(n) : parseFloat(n.toFixed(2)).toString()
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Per-asset mappers: raw row → DisplayTxn ──────────────────────────────────

export function stockToDisplayTxn(t: Transaction): DisplayTxn {
  return {
    id:           t.id,
    asset:        'stock',
    name:         t.symbol,
    trade_date:   t.trade_date,
    direction:    t.trade_type === 'buy' ? 'in' : 'out',
    trade_type:   t.trade_type,
    amount:       t.amount,
    signedAmount: t.trade_type === 'buy' ? t.amount : -t.amount,
    detail:       `${fmtQty(t.quantity, 1)} sh · ${formatPriceFineNum(t.price)}`,
    rawStock:     t,
  }
}

export function mfToDisplayTxn(t: MFTransaction, fundName: string): DisplayTxn {
  return {
    id:           t.id,
    asset:        'mf',
    name:         fundName,
    trade_date:   t.trade_date,
    direction:    t.trade_type === 'buy' ? 'in' : 'out',
    trade_type:   t.trade_type,
    amount:       t.amount,
    signedAmount: t.trade_type === 'buy' ? t.amount : -t.amount,
    detail:       `${fmtQty(t.units, 3)} units · NAV ${fmtNav(t.nav)}`,
    rawMF:        t,
  }
}

export function sgbToDisplayTxn(t: SGBTransaction): DisplayTxn {
  return {
    id:           t.id,
    asset:        'gold',
    name:         t.gold_type === 'sgb'
                    ? `Gold SGB${t.name ? ' · ' + t.name : ''}`
                    : (t.name ?? (t.gold_type === 'etf' ? 'Gold ETF' : 'Physical Gold')),
    trade_date:   t.trade_date,
    direction:    t.trade_type === 'buy' ? 'in' : 'out',
    trade_type:   t.trade_type,
    amount:       t.amount,
    signedAmount: t.trade_type === 'buy' ? t.amount : -t.amount,
    detail:       `${fmtQty(t.grams, 3)}g · ${formatPriceNum(t.price_per_gram)}/g`,
    rawSGB:       t,
  }
}

export function ppfToDisplayTxn(t: PPFTransaction): DisplayTxn {
  return {
    id:           t.id,
    asset:        'ppf',
    name:         'PPF',
    trade_date:   t.trade_date,
    direction:    t.trade_type === 'deposit' ? 'in' : t.trade_type === 'withdrawal' ? 'out' : 'neutral',
    trade_type:   t.trade_type,
    amount:       t.amount,
    signedAmount: t.trade_type === 'deposit' ? t.amount : t.trade_type === 'withdrawal' ? -t.amount : t.amount,
    detail:       capitalize(t.trade_type),
    rawPPF:       t,
  }
}

export function epfToDisplayTxn(t: EPFTransaction): DisplayTxn {
  return {
    id:           t.id,
    asset:        'epf',
    name:         'EPF',
    trade_date:   t.trade_date,
    direction:    t.trade_type === 'deposit' ? 'in' : 'neutral',
    trade_type:   t.trade_type,
    amount:       t.amount,
    signedAmount: t.amount,
    detail:       capitalize(t.trade_type),
    rawEPF:       t,
  }
}

// ── TxnRow helpers ────────────────────────────────────────────────────────────

interface StockEditState {
  kind: 'stock'
  qty: string; price: string; date: string
  saving: boolean; confirming: boolean
}
interface MFEditState {
  kind: 'mf'
  units: string; nav: string; date: string
  saving: boolean; confirming: boolean
}
interface SGBEditState {
  kind: 'sgb'
  grams: string; price_per_gram: string; date: string; name: string
  saving: boolean; confirming: boolean
}
interface PPFEditState {
  kind: 'ppf'
  amount: string; date: string; trade_type: 'deposit' | 'withdrawal' | 'interest'; notes: string
  saving: boolean; confirming: boolean
}
interface EPFEditState {
  kind: 'epf'
  amount: string; date: string; wage_month: string; trade_type: 'deposit' | 'interest'; notes: string  // wage_month is "YYYY-MM", '' when none
  saving: boolean; confirming: boolean
}
type ActiveEdit = StockEditState | MFEditState | SGBEditState | PPFEditState | EPFEditState

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-field mb-1">{label}</p>
      {children}
    </div>
  )
}

function EditActions({ confirming, saveDisabled, saving, onStartDelete, onKeep, onDelete, onCancel, onSave }: {
  confirming: boolean
  saveDisabled: boolean
  saving: boolean
  onStartDelete: () => void
  onKeep: () => void
  onDelete: () => void
  onCancel: () => void
  onSave: () => void
}) {
  if (confirming) {
    return (
      <div className="flex gap-2">
        <button onClick={onKeep}
          className="flex-1 py-2.5 rounded-xl text-body font-medium"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          Keep
        </button>
        <button onClick={onDelete}
          className="flex-1 py-2.5 rounded-xl text-body font-medium text-negative"
          style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)' }}>
          Delete
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between">
      <button onClick={onStartDelete}
        className="px-4 py-2.5 rounded-xl text-body font-medium text-negative"
        style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)' }}>
        Delete
      </button>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-body font-medium"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saveDisabled}
          className="px-5 py-2.5 rounded-xl text-body font-semibold disabled:opacity-40 text-white bg-accent">
          {saving ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── TxnRow ────────────────────────────────────────────────────────────────────

export function TxnRow({ txn, showAssetTag, compactLabel, onDelete, onSavedStock, onSavedMF, onSavedSGB, onSavedPPF, onSavedEPF }: {
  txn: DisplayTxn
  showAssetTag: boolean
  // Overrides the resting-state name/date/detail block with a single plain line —
  // used where txn.name would just repeat the section header (e.g. Portfolio's
  // EPF list, where every row is already under an "EPF" heading and the wage
  // month is the main thing worth reading at rest). `faint` trails the text in a
  // fainter, smaller style — the date the amount was added.
  compactLabel?: { text: string; faint?: string; italic?: boolean }
  onDelete: (id: string, asset: AssetType) => void
  onSavedStock: (updated: Transaction) => void
  onSavedMF: (updated: MFTransaction) => void
  onSavedSGB: (updated: SGBTransaction) => void
  onSavedPPF: (updated: PPFTransaction) => void
  onSavedEPF: (updated: EPFTransaction) => void
}) {
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null)

  const stock = txn.rawStock
  const mf    = txn.rawMF
  const sgb   = txn.rawSGB
  const ppf   = txn.rawPPF
  const epf   = txn.rawEPF

  function openEdit() {
    if (stock) {
      setActiveEdit({ kind: 'stock', qty: String(stock.quantity), price: String(stock.price), date: stock.trade_date, saving: false, confirming: false })
    } else if (mf) {
      setActiveEdit({ kind: 'mf', units: String(mf.units), nav: String(mf.nav), date: mf.trade_date, saving: false, confirming: false })
    } else if (sgb) {
      setActiveEdit({ kind: 'sgb', grams: String(sgb.grams), price_per_gram: String(sgb.price_per_gram), date: sgb.trade_date, name: sgb.name ?? '', saving: false, confirming: false })
    } else if (ppf) {
      setActiveEdit({ kind: 'ppf', amount: String(ppf.amount), date: ppf.trade_date, trade_type: ppf.trade_type, notes: ppf.notes ?? '', saving: false, confirming: false })
    } else if (epf) {
      setActiveEdit({ kind: 'epf', amount: String(epf.amount), date: epf.trade_date, wage_month: epf.wage_month?.slice(0, 7) ?? '', trade_type: epf.trade_type, notes: epf.notes ?? '', saving: false, confirming: false })
    }
  }

  function cancelEdit() { setActiveEdit(null) }

  async function doDelete() {
    if (txn.asset === 'stock') {
      // Server action — invalidates the 'transactions' cache tag
      await deleteStockTransaction(txn.id)
    } else {
      const table =
        txn.asset === 'mf'   ? 'mf_transactions' :
        txn.asset === 'gold' ? 'sgb_transactions' :
        txn.asset === 'ppf'  ? 'ppf_transactions' :
                               'epf_transactions'
      await getSupabaseBrowser().from(table).delete().eq('id', txn.id)
      // Client-side write bypasses server actions — bust the matching cache tag directly.
      if (txn.asset === 'mf')   await revalidateMFTransactions()
      if (txn.asset === 'gold') await revalidateSGBTransactions()
      if (txn.asset === 'ppf')  await revalidatePPFTransactions()
      if (txn.asset === 'epf')  await revalidateEPFTransactions()
    }
    onDelete(txn.id, txn.asset)
  }

  async function save() {
    if (!activeEdit) return
    setActiveEdit(prev => prev ? { ...prev, saving: true } : null)

    if (activeEdit.kind === 'stock' && stock) {
      const qty   = parseFloat(activeEdit.qty)
      const price = parseFloat(activeEdit.price)
      if (!qty || !price || !activeEdit.date) { setActiveEdit(prev => prev ? { ...prev, saving: false } : null); return }
      // fy_id is re-derived from trade_date inside the action — a date edit
      // can move the transaction into a different FY.
      const { fyId } = await updateStockTransaction(txn.id, { quantity: qty, price, trade_date: activeEdit.date })
      onSavedStock({ ...stock, quantity: qty, price, trade_date: activeEdit.date, fy_id: fyId, amount: qty * price })

    } else if (activeEdit.kind === 'mf' && mf) {
      const units = parseFloat(activeEdit.units)
      const nav   = parseFloat(activeEdit.nav)
      if (!units || !nav || !activeEdit.date) { setActiveEdit(prev => prev ? { ...prev, saving: false } : null); return }
      const patch = { units, nav, trade_date: activeEdit.date, amount: units * nav }
      await getSupabaseBrowser().from('mf_transactions').update(patch).eq('id', txn.id)
      await revalidateMFTransactions()
      onSavedMF({ ...mf, ...patch })

    } else if (activeEdit.kind === 'sgb' && sgb) {
      const grams          = parseFloat(activeEdit.grams)
      const price_per_gram = parseFloat(activeEdit.price_per_gram)
      if (!grams || !price_per_gram || !activeEdit.date) { setActiveEdit(prev => prev ? { ...prev, saving: false } : null); return }
      const patch = { grams, price_per_gram, trade_date: activeEdit.date, name: activeEdit.name || null, amount: grams * price_per_gram }
      await getSupabaseBrowser().from('sgb_transactions').update(patch).eq('id', txn.id)
      await revalidateSGBTransactions()
      onSavedSGB({ ...sgb, ...patch })

    } else if (activeEdit.kind === 'ppf' && ppf) {
      const amount = parseFloat(activeEdit.amount)
      if (!amount || !activeEdit.date) { setActiveEdit(prev => prev ? { ...prev, saving: false } : null); return }
      const patch = { amount, trade_date: activeEdit.date, trade_type: activeEdit.trade_type, notes: activeEdit.notes }
      await getSupabaseBrowser().from('ppf_transactions').update(patch).eq('id', txn.id)
      await revalidatePPFTransactions()
      onSavedPPF({ ...ppf, ...patch })

    } else if (activeEdit.kind === 'epf' && epf) {
      const amount = parseFloat(activeEdit.amount)
      if (!amount || !activeEdit.date) { setActiveEdit(prev => prev ? { ...prev, saving: false } : null); return }
      const wage_month = activeEdit.trade_type === 'deposit' && activeEdit.wage_month ? `${activeEdit.wage_month}-01` : null
      const patch = { amount, trade_date: activeEdit.date, wage_month, trade_type: activeEdit.trade_type, notes: activeEdit.notes }
      await getSupabaseBrowser().from('epf_transactions').update(patch).eq('id', txn.id)
      await revalidateEPFTransactions()
      onSavedEPF({ ...epf, ...patch })
    }

    setActiveEdit(null)
  }

  // ── Computed amount preview while editing ──
  const editAmount = (() => {
    if (!activeEdit) return 0
    if (activeEdit.kind === 'stock') return (parseFloat(activeEdit.qty) || 0) * (parseFloat(activeEdit.price) || 0)
    if (activeEdit.kind === 'mf')    return (parseFloat(activeEdit.units) || 0) * (parseFloat(activeEdit.nav) || 0)
    if (activeEdit.kind === 'sgb')   return (parseFloat(activeEdit.grams) || 0) * (parseFloat(activeEdit.price_per_gram) || 0)
    if (activeEdit.kind === 'ppf')   return parseFloat(activeEdit.amount) || 0
    if (activeEdit.kind === 'epf')   return parseFloat(activeEdit.amount) || 0
    return 0
  })()

  const editDirection: 'in' | 'out' | 'neutral' = (() => {
    if (activeEdit?.kind === 'ppf') return activeEdit.trade_type === 'deposit' ? 'in' : activeEdit.trade_type === 'withdrawal' ? 'out' : 'neutral'
    if (activeEdit?.kind === 'epf') return activeEdit.trade_type === 'deposit' ? 'in' : 'neutral'
    return txn.direction
  })()
  const signedEditAmount = editDirection === 'in' ? editAmount : editDirection === 'out' ? -editAmount : editAmount

  const saveDisabled = !activeEdit || activeEdit.saving || (() => {
    if (activeEdit.kind === 'stock') return !activeEdit.qty || !activeEdit.price || !activeEdit.date
    if (activeEdit.kind === 'mf')    return !activeEdit.units || !activeEdit.nav || !activeEdit.date
    if (activeEdit.kind === 'sgb')   return !activeEdit.grams || !activeEdit.price_per_gram || !activeEdit.date
    if (activeEdit.kind === 'ppf')   return !activeEdit.amount || !activeEdit.date
    if (activeEdit.kind === 'epf')   return !activeEdit.amount || !activeEdit.date
    return true
  })()

  const canEdit = !!(stock || mf || sgb || ppf || epf)

  // ── Edit mode ──
  if (activeEdit) {
    const editDotClass = editDirection === 'in' ? 'bg-positive' : editDirection === 'out' ? 'bg-negative' : 'bg-muted'
    const badgeLabel =
      activeEdit.kind === 'ppf' || activeEdit.kind === 'epf'
        ? capitalize(activeEdit.trade_type)
        : editDirection === 'in' ? 'BUY' : 'SELL'
    const badgeClass = editDirection === 'in' ? 'text-positive' : editDirection === 'out' ? 'text-negative' : ''
    const badgeBg    = editDirection === 'in' ? 'rgba(52,199,89,0.15)' : editDirection === 'out' ? 'rgba(255,59,48,0.15)' : 'var(--bg-tertiary)'
    const badgeStyle = editDirection === 'neutral' ? { background: badgeBg, color: 'var(--text-muted)' } : { background: badgeBg }

    return (
      <div className="px-4 py-3" style={{ background: 'rgba(10,132,255,0.04)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${editDotClass}`} />
            <span className={`font-semibold ${txn.asset === 'mf' ? 'text-body' : 'text-headline'} truncate max-w-[160px]`}>{txn.name}</span>
            <span className={`text-footnote font-bold px-1.5 py-0.5 rounded-md flex-shrink-0 ${badgeClass}`} style={badgeStyle}>
              {badgeLabel}
            </span>
          </div>
          <span className="font-bold tabnum text-body flex-shrink-0" style={{ color: 'var(--text-2)' }}>
            <Num amount={signedEditAmount || txn.signedAmount} signed={editDirection !== 'neutral'} />
          </span>
        </div>

        {activeEdit.kind === 'stock' && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <EditField label="Quantity">
                <input type="number" inputMode="numeric" value={activeEdit.qty}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'stock' ? { ...prev, qty: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
              <EditField label="Price">
                <input type="number" inputMode="decimal" value={activeEdit.price}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'stock' ? { ...prev, price: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <EditField label="Date">
                <input type="date" value={activeEdit.date}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'stock' ? { ...prev, date: e.target.value } : prev)}
                  className="min-w-0 w-full px-3 py-2.5 rounded-xl text-body outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
              </EditField>
              <div />
            </div>
          </>
        )}

        {activeEdit.kind === 'mf' && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <EditField label="Units">
                <input type="number" inputMode="decimal" value={activeEdit.units}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'mf' ? { ...prev, units: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
              <EditField label="NAV">
                <input type="number" inputMode="decimal" value={activeEdit.nav}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'mf' ? { ...prev, nav: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <EditField label="Date">
                <input type="date" value={activeEdit.date}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'mf' ? { ...prev, date: e.target.value } : prev)}
                  className="min-w-0 w-full px-3 py-2.5 rounded-xl text-body outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
              </EditField>
              <div />
            </div>
          </>
        )}

        {activeEdit.kind === 'sgb' && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <EditField label="Grams">
                <input type="number" inputMode="decimal" value={activeEdit.grams}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'sgb' ? { ...prev, grams: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
              <EditField label="Price / g">
                <input type="number" inputMode="decimal" value={activeEdit.price_per_gram}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'sgb' ? { ...prev, price_per_gram: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <EditField label="Date">
                <input type="date" value={activeEdit.date}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'sgb' ? { ...prev, date: e.target.value } : prev)}
                  className="min-w-0 w-full px-3 py-2.5 rounded-xl text-body outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
              </EditField>
              <EditField label="Name (optional)">
                <input type="text" value={activeEdit.name}
                  onChange={e => setActiveEdit(prev => prev?.kind === 'sgb' ? { ...prev, name: e.target.value } : prev)}
                  placeholder="e.g. SGB 2023-24 S3"
                  className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
            </div>
          </>
        )}

        {(activeEdit.kind === 'ppf' || activeEdit.kind === 'epf') && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <EditField label="Amount">
                <input type="number" inputMode="decimal" value={activeEdit.amount}
                  onChange={e => setActiveEdit(prev => (prev?.kind === 'ppf' || prev?.kind === 'epf') ? { ...prev, amount: e.target.value } : prev)}
                  className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
              <EditField label={activeEdit.kind === 'epf' ? 'Date added' : 'Date'}>
                <input type="date" value={activeEdit.date}
                  onChange={e => setActiveEdit(prev => (prev?.kind === 'ppf' || prev?.kind === 'epf') ? { ...prev, date: e.target.value } : prev)}
                  className="min-w-0 w-full px-3 py-2.5 rounded-xl text-body outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
              </EditField>
            </div>
            {activeEdit.kind === 'epf' && activeEdit.trade_type === 'deposit' && (
              <div className="mb-2">
                <EditField label="Wage month">
                  <input type="month" value={activeEdit.wage_month}
                    onChange={e => setActiveEdit(prev => prev?.kind === 'epf' ? { ...prev, wage_month: e.target.value } : prev)}
                    className="min-w-0 w-full px-3 py-2.5 rounded-xl text-body outline-none"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
                </EditField>
              </div>
            )}
            <div className="mb-2">
              <EditField label="Type">
                <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                  {(activeEdit.kind === 'ppf'
                    ? (['deposit', 'withdrawal', 'interest'] as const)
                    : (['deposit', 'interest'] as const)
                  ).map(tt => (
                    <button key={tt}
                      onClick={() => setActiveEdit(prev =>
                        prev?.kind === 'ppf' ? { ...prev, trade_type: tt as PPFEditState['trade_type'] } :
                        prev?.kind === 'epf' ? { ...prev, trade_type: tt as EPFEditState['trade_type'] } : prev
                      )}
                      className="flex-1 py-2.5 text-body font-medium transition-colors capitalize"
                      style={activeEdit.trade_type === tt
                        ? { background: 'var(--accent)', color: '#fff' }
                        : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      {tt}
                    </button>
                  ))}
                </div>
              </EditField>
            </div>
            <div className="mb-3">
              <EditField label="Notes (optional)">
                <input type="text" value={activeEdit.notes}
                  onChange={e => setActiveEdit(prev => (prev?.kind === 'ppf' || prev?.kind === 'epf') ? { ...prev, notes: e.target.value } : prev)}
                  placeholder="e.g. FY26 deposit"
                  className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </EditField>
            </div>
          </>
        )}

        <EditActions
          confirming={activeEdit.confirming}
          saveDisabled={saveDisabled}
          saving={activeEdit.saving}
          onStartDelete={() => setActiveEdit(prev => prev ? { ...prev, confirming: true } : null)}
          onKeep={() => setActiveEdit(prev => prev ? { ...prev, confirming: false } : null)}
          onDelete={doDelete}
          onCancel={cancelEdit}
          onSave={save}
        />
      </div>
    )
  }

  // ── Normal display ──
  const amtColour = txn.direction === 'in' ? 'text-positive' : txn.direction === 'out' ? 'text-negative' : ''
  const amtStyle  = txn.direction === 'neutral' ? { color: 'var(--text-2)' } : undefined

  return (
    <div className="flex items-center px-4 py-3 gap-3 tap-row">
      <div className="flex-1 min-w-0">
        {compactLabel ? (
          <p className="text-body tabnum truncate"
             style={{ color: 'var(--text-2)', fontStyle: compactLabel.italic ? 'italic' : 'normal' }}>
            {compactLabel.text}
            {compactLabel.faint && (
              <span className="text-subheadline" style={{ color: 'var(--text-faint)', fontStyle: 'normal' }}> · {compactLabel.faint}</span>
            )}
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className={`font-semibold truncate ${txn.asset === 'mf' ? 'text-body' : 'text-headline'}`}>
                {txn.name}
              </span>
              <span className="flex-shrink-0 text-subheadline" style={{ color: 'var(--text-muted)' }}>·</span>
              <span className="flex-shrink-0 text-subheadline tabnum" style={{ color: 'var(--text-muted)' }}>
                {formatDate(txn.trade_date)}
              </span>
            </div>
            <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {showAssetTag && (
                <>
                  <span className="font-semibold uppercase inline-flex items-center rounded px-1 leading-[1.5]"
                        style={{ fontSize: 10, letterSpacing: '0.04em', color: 'var(--text-muted)', background: 'var(--border-faint)', border: '1px solid var(--border)' }}>
                    {ASSET_LABELS[txn.asset]}
                  </span>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                </>
              )}
              {txn.detail}
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <p className={`font-bold tabnum text-headline ${amtColour}`} style={amtStyle}>
          <Num amount={txn.signedAmount} signed={txn.direction !== 'neutral'} />
        </p>
        {canEdit ? (
          <button onClick={openEdit}
            className="w-[44px] h-[44px] flex items-center justify-center flex-shrink-0"
            style={{ color: 'var(--text-faint)' }}>
            <PencilIcon className="w-[18px] h-[18px]" />
          </button>
        ) : (
          <div className="w-[44px] h-[44px] flex-shrink-0" />
        )}
      </div>
    </div>
  )
}
