'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatDate, shortMonthYear } from '@/lib/formatter'
import type { Transaction, FiscalYear } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { getStockName } from '@/lib/stock-names'

export default function TransactionsClient({
  transactions: initial,
  fiscalYears,
  selectedFY,
  filterSymbol,
}: {
  transactions: Transaction[]
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  filterSymbol?: string
}) {
  const router = useRouter()
  const [txns, setTxns] = useState(initial)
  const [typeFilter, setTypeFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const [symbolFilter, setSymbolFilter] = useState<string>('all')

  useEffect(() => { setTxns(initial) }, [initial])

  function deleteTxn(id: string) {
    setTxns(prev => prev.filter(t => t.id !== id))
  }

  function updateTxn(updated: Transaction) {
    setTxns(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  const symbols = Array.from(new Set(txns.map(t => t.symbol))).sort()
  const displayed = txns
    .filter(t => !filterSymbol || t.symbol === filterSymbol)
    .filter(t => symbolFilter === 'all' || t.symbol === symbolFilter)
    .filter(t => typeFilter === 'all' || t.trade_type === typeFilter)
  const grouped = groupByMonth(displayed)

  return (
    <div style={{ minHeight: '100dvh' }}>
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pb-3"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <div>
            <h1 className="text-display font-bold">{filterSymbol ?? 'Transactions'}</h1>
            {filterSymbol && (
              <a href="/transactions" className="text-subheadline text-accent">← All</a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <FYPicker
              fiscalYears={fiscalYears}
              selectedFY={selectedFY}
              onSelect={fy => router.push(`/transactions?fy=${encodeURIComponent(fy.label)}`)}
            />
            <UserMenu />
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 mt-2">
          {(['all', 'buy', 'sell'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className="px-4 rounded-full text-subheadline font-medium transition-colors flex-shrink-0 flex items-center"
              style={{
                minHeight: '44px',
                ...(typeFilter === t
                  ? { background: t === 'buy' ? 'rgba(52,199,89,0.2)' : t === 'sell' ? 'rgba(255,59,48,0.2)' : 'var(--text-primary)', color: t === 'buy' ? '#34C759' : t === 'sell' ? '#FF3B30' : 'var(--bg-primary)' }
                  : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }),
              }}>
              {t === 'all' ? 'All' : t === 'buy' ? 'Buys' : 'Sells'}
            </button>
          ))}
          {!filterSymbol && symbols.length > 0 && (
            <>
              <div className="w-px self-stretch my-2" style={{ background: 'var(--border)' }} />
              <div className="relative flex-shrink-0">
                <div className="flex items-center gap-1.5 px-4 rounded-full text-subheadline font-medium pointer-events-none"
                     style={{
                       minHeight: '44px',
                       ...(symbolFilter !== 'all'
                         ? { background: 'rgba(10,132,255,0.15)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }
                         : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }),
                     }}>
                  <span className="text-subheadline">{symbolFilter === 'all' ? 'Stock' : symbolFilter}</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <select
                  value={symbolFilter}
                  onChange={e => setSymbolFilter(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                  <option value="all">All stocks</option>
                  {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center px-6"
             style={{
               color: 'var(--text-muted)',
               minHeight: 'calc(100dvh - var(--nav-h, 64px) - var(--safe-bottom, 0px) - 100px)',
             }}>
          <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-headline font-medium">No transactions yet</p>
          <p className="text-body">Tap + to log your first trade</p>
        </div>
      ) : (
        <div className="pt-4 space-y-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
          {grouped.map(({ month, items, buyTotal, sellTotal }) => (
            <section key={month}>
              <div className="flex items-baseline justify-between px-5 mb-2">
                <p className="text-subheadline font-semibold uppercase tracking-widest"
                   style={{ color: 'var(--text-muted)' }}>{month}</p>
                <div className="flex gap-3 text-subheadline tabnum">
                  {buyTotal > 0 && <span className="text-positive">+{formatINR(buyTotal)}</span>}
                  {sellTotal > 0 && <span className="text-negative">−{formatINR(sellTotal)}</span>}
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border-faint)' }}>
                {items.map(txn => (
                  <TxnRow
                    key={txn.id}
                    txn={txn}
                    fiscalYears={fiscalYears}
                    onDelete={deleteTxn}
                    onSaved={updateTxn}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// ── TxnRow ────────────────────────────────────────────────────────────────────

function TxnRow({ txn, fiscalYears, onDelete, onSaved }: {
  txn: Transaction
  fiscalYears: FiscalYear[]
  onDelete: (id: string) => void
  onSaved: (updated: Transaction) => void
}) {
  const [editing, setEditing]       = useState(false)
  const [editQty, setEditQty]       = useState('')
  const [editPrice, setEditPrice]   = useState('')
  const [editDate, setEditDate]     = useState('')
  const [advanceOn, setAdvanceOn]   = useState(false)
  const [advanceFyId, setAdvanceFyId] = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [confirming, setConfirming] = useState(false)

  const isBuy = txn.trade_type === 'buy'
  // FYs available for advance buy — exclude the txn's own FY
  const otherFYs = fiscalYears.filter(f => f.id !== txn.fy_id)

  function openEdit() {
    setEditQty(String(txn.quantity))
    setEditPrice(String(txn.price))
    setEditDate(txn.trade_date)
    setAdvanceOn(!!txn.advance_fy_id)
    setAdvanceFyId(txn.advance_fy_id ?? null)
    setConfirming(false)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setConfirming(false)
  }

  async function save() {
    const qty   = parseFloat(editQty)
    const price = parseFloat(editPrice)
    if (!qty || !price || !editDate) return
    setSaving(true)
    const patch = {
      quantity:       qty,
      price,
      trade_date:     editDate,
      advance_fy_id:  advanceOn && advanceFyId ? advanceFyId : null,
    }
    await getSupabaseBrowser().from('transactions').update(patch).eq('id', txn.id)
    onSaved({ ...txn, ...patch, amount: qty * price })
    setSaving(false)
    setEditing(false)
  }

  async function doDelete() {
    await getSupabaseBrowser().from('transactions').delete().eq('id', txn.id)
    onDelete(txn.id)
  }

  const editAmount = (parseFloat(editQty) || 0) * (parseFloat(editPrice) || 0)
  const saveDisabled = saving || !editQty || !editPrice || !editDate || (advanceOn && !advanceFyId)

  // ── Edit mode ──
  if (editing) {
    return (
      <div className="px-4 py-3" style={{ background: 'rgba(10,132,255,0.04)' }}>
        {/* Header — frozen */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isBuy ? 'bg-positive' : 'bg-negative'}`} />
            <span className="font-semibold text-headline">{txn.symbol}</span>
            <span className={`text-footnote font-bold px-1.5 py-0.5 rounded-md ${isBuy ? 'text-positive' : 'text-negative'}`}
                  style={{
                    background: isBuy ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)',
                  }}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
          </div>
          <span className="font-bold tabnum text-body" style={{ color: 'var(--text-2)' }}>
            {editAmount > 0 ? formatINR(editAmount) : formatINR(txn.amount)}
          </span>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <p className="text-footnote uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Quantity</p>
            <input type="number" inputMode="numeric" value={editQty} onChange={e => setEditQty(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>
          <div>
            <p className="text-footnote uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Price (₹)</p>
            <input type="number" inputMode="decimal" value={editPrice} onChange={e => setEditPrice(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <p className="text-footnote uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Date</p>
            <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
          </div>
          <div />
        </div>

        {/* Advance buy — buys only, only when other FYs exist */}
        {isBuy && otherFYs.length > 0 && (
          <div className="border-t pt-3 mb-3" style={{ borderColor: 'var(--border-faint)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium">Count toward a different FY</p>
                <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>Apply this to another year's plan</p>
              </div>
              <button
                type="button"
                onClick={() => { setAdvanceOn(v => !v); setAdvanceFyId(null) }}
                className={`w-[51px] h-[31px] rounded-full relative flex-shrink-0 transition-colors ${advanceOn ? 'bg-positive' : ''}`}
                style={advanceOn ? undefined : { background: 'var(--border)' }}>
                <span className="absolute top-[2px] w-[27px] h-[27px] rounded-full bg-white transition-all"
                      style={{ left: advanceOn ? '22px' : '2px', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </button>
            </div>
            {advanceOn && (
              <div className="mt-3 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {otherFYs.map(fy => (
                  <button key={fy.id} type="button"
                    onClick={() => setAdvanceFyId(fy.id)}
                    className="w-full flex items-center justify-between px-4 py-3 border-b last:border-b-0 text-left"
                    style={{
                      borderColor: 'var(--border-faint)',
                      background: advanceFyId === fy.id ? 'rgba(10,132,255,0.06)' : 'var(--bg-secondary)',
                    }}>
                    <div>
                      <p className="text-body font-medium" style={{ color: advanceFyId === fy.id ? '#0A84FF' : 'var(--text-primary)' }}>{fy.label}</p>
                      <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
                        {shortMonthYear(fy.start_date)} – {shortMonthYear(fy.end_date)}
                      </p>
                    </div>
                    {advanceFyId === fy.id && (
                      <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#0A84FF" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {confirming ? (
          <div className="flex items-center justify-between">
            <p className="text-body" style={{ color: 'var(--text-2)' }}>Delete this transaction?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(false)} className="text-body text-accent">Keep</button>
              <button onClick={doDelete} className="text-body font-semibold text-negative">Delete</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button onClick={() => setConfirming(true)}
              className="px-4 py-2.5 rounded-xl text-body font-medium text-negative"
              style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)' }}>
              Delete
            </button>
            <div className="flex gap-2">
              <button onClick={cancelEdit}
                className="px-4 py-2.5 rounded-xl text-body font-medium"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button onClick={save} disabled={saveDisabled}
                className="px-5 py-2.5 rounded-xl text-body font-semibold disabled:opacity-40 text-white bg-accent">
                {saving ? '…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Normal display ──
  return (
    <div className="flex items-start px-4 py-3.5 gap-3" style={{ minHeight: '56px' }}>
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-[5px] ${isBuy ? 'bg-positive' : 'bg-negative'}`} />

      {/* Left: symbol + name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-headline">{txn.symbol}</span>
          {txn.advance_fy_id && (
            <span className="text-footnote font-semibold px-1.5 py-0.5 rounded-md text-accent"
                  style={{ background: 'rgba(10,132,255,0.12)', border: '1px solid rgba(10,132,255,0.25)' }}>
              {`→ ${getFYLabel(txn.advance_fy_id, fiscalYears)}`}
            </span>
          )}
        </div>
        {getStockName(txn.symbol) && (
          <p className="text-footnote mt-0.5" style={{ color: 'var(--text-2)' }}>{getStockName(txn.symbol)}</p>
        )}
      </div>

      {/* Middle: qty / price / date */}
      <div className="text-right flex-shrink-0 pr-4">
        <p className="text-body tabnum font-medium" style={{ color: 'var(--text-primary)' }}>
          {Math.round(txn.quantity)} qty
        </p>
        <p className="text-subheadline tabnum" style={{ color: 'var(--text-muted)' }}>
          ₹{txn.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </p>
        <p className="text-footnote" style={{ color: 'var(--text-faint)' }}>
          {formatDate(txn.trade_date)}
        </p>
      </div>

      {/* Right: amount + edit */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <p className={`font-bold tabnum text-headline ${isBuy ? '' : 'text-negative'}`}
           style={isBuy ? { color: 'var(--text-primary)' } : undefined}>
          {isBuy ? '' : '−'}{formatINR(txn.amount)}
        </p>
        <button onClick={openEdit}
          className="w-[44px] h-[44px] flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-faint)' }}>
          <PencilIcon className="w-[14px] h-[14px]" />
        </button>
      </div>
    </div>
  )
}

function getFYLabel(fyId: string, fiscalYears: FiscalYear[]): string {
  return fiscalYears.find(f => f.id === fyId)?.label ?? '?'
}

function groupByMonth(txns: Transaction[]) {
  const map = new Map<string, Transaction[]>()
  for (const t of txns) {
    const key = new Date(t.trade_date + 'T00:00:00')
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  return Array.from(map.entries()).map(([month, items]) => ({
    month,
    items,
    buyTotal:  items.filter(t => t.trade_type === 'buy').reduce((s, t) => s + t.amount, 0),
    sellTotal: items.filter(t => t.trade_type === 'sell').reduce((s, t) => s + t.amount, 0),
  }))
}

function PencilIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15.232 5.232l3.536 3.536M9 11l6.5-6.5a2 2 0 112.828 2.828L11.828 13.828a2 2 0 01-.828.497l-3 .75.75-3a2 2 0 01.497-.828z" />
    </svg>
  )
}
