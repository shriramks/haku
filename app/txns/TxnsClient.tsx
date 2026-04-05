'use client'
import { useState, useMemo } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatDate } from '@/lib/formatter'
import { getStockName } from '@/lib/stock-names'
import type { Transaction } from '@/lib/types'

type TimeFilter = 'all' | 'month' | 'fy'
type TypeFilter = 'all' | 'buy' | 'sell'

export default function TxnsClient({ transactions: initial }: { transactions: Transaction[] }) {
  const [txns, setTxns]               = useState(initial)
  const [privacy, setPrivacy]         = useState(false)
  const [stockFilter, setStockFilter] = useState('all')
  const [timeFilter, setTimeFilter]   = useState<TimeFilter>('all')
  const [typeFilter, setTypeFilter]   = useState<TypeFilter>('all')

  async function deleteTxn(id: string) {
    await getSupabaseBrowser().from('transactions').delete().eq('id', id)
    setTxns(prev => prev.filter(t => t.id !== id))
  }

  const symbols = useMemo(() =>
    Array.from(new Set(txns.map(t => t.symbol))).sort(), [txns])

  const filtered = useMemo(() => {
    const now = new Date()
    return txns.filter(t => {
      if (stockFilter !== 'all' && t.symbol !== stockFilter) return false
      if (typeFilter  !== 'all' && t.trade_type !== typeFilter) return false
      if (timeFilter === 'month') {
        const d = new Date(t.trade_date + 'T00:00:00')
        if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false
      }
      if (timeFilter === 'fy') {
        const fyStart = now.getMonth() >= 3
          ? new Date(now.getFullYear(), 3, 1)
          : new Date(now.getFullYear() - 1, 3, 1)
        if (new Date(t.trade_date + 'T00:00:00') < fyStart) return false
      }
      return true
    })
  }, [txns, stockFilter, timeFilter, typeFilter])

  const grouped = groupByMonth(filtered)

  const timeLabel: Record<TimeFilter, string> = { all: 'All Time', month: 'This Month', fy: 'This FY' }
  const typeLabel: Record<TypeFilter, string> = { all: 'Type: All', buy: 'Type: Buy', sell: 'Type: Sell' }

  return (
    <div style={{ minHeight: '100dvh', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)',
                    paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <h1 className="text-display font-bold">Transactions</h1>
          <button
            onClick={() => setPrivacy(p => !p)}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: privacy ? 'rgba(10,132,255,0.12)' : 'var(--bg-tertiary)' }}
            aria-label={privacy ? 'Show amounts' : 'Hide amounts'}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24"
                 stroke={privacy ? '#0A84FF' : 'currentColor'} strokeWidth={1.8}>
              {privacy ? (
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 3l18 18M10.477 10.477A3 3 0 0013.5 13.5M6.228 6.228A10.45 10.45 0 003 12c1.657 3.722 5.27 6 9 6a10.45 10.45 0 004.772-1.228M9.878 9.878A3 3 0 0114.12 14.12M17.772 17.772A10.45 10.45 0 0021 12c-1.657-3.722-5.27-6-9-6a10.45 10.45 0 00-1.772.228" />
              ) : (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto hide-scrollbar">
        <ChipSelect
          value={stockFilter} onChange={setStockFilter}
          active={stockFilter !== 'all'}
          options={[{ value: 'all', label: 'All Stocks' }, ...symbols.map(s => ({ value: s, label: s }))]}
        />
        <ChipSelect
          value={timeFilter} onChange={v => setTimeFilter(v as TimeFilter)}
          active={timeFilter !== 'all'}
          options={[
            { value: 'all',   label: 'All Time'    },
            { value: 'month', label: 'This Month'  },
            { value: 'fy',    label: 'This FY'     },
          ]}
        />
        <ChipSelect
          value={typeFilter} onChange={v => setTypeFilter(v as TypeFilter)}
          active={typeFilter !== 'all'}
          options={[
            { value: 'all',  label: 'Type: All'  },
            { value: 'buy',  label: 'Type: Buy'  },
            { value: 'sell', label: 'Type: Sell' },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 gap-1"
             style={{ color: 'var(--text-faint)' }}>
          <p className="text-headline font-medium">No transactions</p>
          <p className="text-body" style={{ color: 'var(--text-muted)' }}>
            {txns.length === 0 ? 'Tap + to log your first trade' : 'Try adjusting filters'}
          </p>
        </div>
      ) : (
        <div>
          {grouped.map(({ month, items, buyTotal, sellTotal }) => (
            <section key={month}>
              {/* Month header */}
              <div className="flex items-start justify-between gap-3 px-4 pt-6 pb-3">
                <p className="text-title-1 font-bold">{month}</p>
                <div className="flex gap-3 pt-1 flex-shrink-0">
                  {buyTotal > 0 && (
                    <span className="text-footnote font-bold uppercase tabnum"
                          style={{ color: 'var(--c-positive)', letterSpacing: '0.04em' }}>
                      Buy: {formatINR(buyTotal)}
                    </span>
                  )}
                  {sellTotal > 0 && (
                    <span className="text-footnote font-bold uppercase tabnum"
                          style={{ color: 'var(--c-negative)', letterSpacing: '0.04em' }}>
                      Sell: {formatINR(sellTotal)}
                    </span>
                  )}
                </div>
              </div>
              <div className="border-t" style={{ borderColor: 'var(--border-faint)' }} />
              <div className="divide-y" style={{ borderColor: 'var(--border-faint)' }}>
                {items.map(txn => (
                  <TxnRow key={txn.id} txn={txn} privacy={privacy} onDelete={deleteTxn} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Chip select ───────────────────────────────────────────────────────────────

function ChipSelect({ value, onChange, options, active }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  active: boolean
}) {
  return (
    <div className="relative flex-shrink-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-subheadline font-semibold rounded-full outline-none"
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          background: active ? 'var(--text-primary)' : 'var(--bg-secondary)',
          color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
          border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
          paddingTop: 7, paddingBottom: 7, paddingLeft: 13, paddingRight: 28,
          fontFamily: 'inherit',
        }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
           style={{ color: active ? 'var(--bg-secondary)' : 'var(--text-muted)' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </div>
    </div>
  )
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TxnRow({ txn, privacy, onDelete }: {
  txn: Transaction
  privacy: boolean
  onDelete: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const isBuy  = txn.trade_type === 'buy'
  const name   = getStockName(txn.symbol)
  const blur: React.CSSProperties = privacy ? { filter: 'blur(6px)', userSelect: 'none' } : {}

  if (confirming) {
    return (
      <div className="flex items-center justify-between px-4 py-4">
        <p className="text-body" style={{ color: 'var(--text-2)' }}>Delete this transaction?</p>
        <div className="flex gap-4">
          <button onClick={() => setConfirming(false)} className="text-accent text-body">Keep</button>
          <button onClick={() => onDelete(txn.id)} className="text-negative text-body font-semibold">Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-4 py-4 tap-row">
      {/* Left: symbol + detail */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <p className="text-headline font-bold">{txn.symbol}</p>
          {name && <p className="text-footnote truncate" style={{ color: 'var(--text-muted)' }}>{name}</p>}
        </div>
        <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {formatDate(txn.trade_date)}
          {' · '}{txn.quantity % 1 === 0 ? txn.quantity : txn.quantity.toFixed(1)} shares
          {' @ ₹'}{txn.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </p>
        {txn.notes && (
          <p className="text-footnote mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{txn.notes}</p>
        )}
      </div>

      {/* Right: amount + delete */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <p className="text-headline font-bold tabnum"
           style={{ color: isBuy ? 'var(--c-positive)' : 'var(--c-negative)', ...blur }}>
          {isBuy ? '+' : '−'}{formatINR(txn.amount)}
        </p>
        <button
          onClick={() => setConfirming(true)}
          className="text-[22px] leading-none px-1"
          style={{ color: 'var(--text-faint)' }}>
          ×
        </button>
      </div>
    </div>
  )
}

// ── Grouping ─────────────────────────────────────────────────────────────────

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
    buyTotal:  items.filter(t => t.trade_type === 'buy').reduce((s, t)  => s + t.amount, 0),
    sellTotal: items.filter(t => t.trade_type === 'sell').reduce((s, t) => s + t.amount, 0),
  }))
}
