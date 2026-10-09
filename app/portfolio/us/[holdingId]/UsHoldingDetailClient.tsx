'use client'

import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { formatINRFull, formatPnLFull, formatDate, formatUsd, trimZero, trimPct, getGainColor } from '@/lib/formatter'
import UserMenu from '@/components/UserMenu'
import EmptyState from '@/components/EmptyState'
import { Num } from '@/components/Num'
import { computeUsPosition, type UsdInrRate } from '@/lib/us-compute'
import { TxnRow, usToDisplayTxn } from '@/components/EditableTxnRow'
import type { UsHolding, UsTransaction } from '@/lib/portfolio-types'
import type { StockPriceInfo } from '@/lib/stock-prices'

interface Props {
  holding: UsHolding
  transactions: UsTransaction[]
  quote: StockPriceInfo | null
  fx: UsdInrRate | null
  fxDate: string | null
}

function groupByMonth(txns: UsTransaction[]) {
  const map = new Map<string, UsTransaction[]>()
  for (const t of txns) {
    const key = new Date(t.trade_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    ;(map.get(key) ?? map.set(key, []).get(key)!).push(t)
  }
  return Array.from(map.entries()).map(([month, items]) => ({ month, items }))
}

export default function UsHoldingDetailClient({ holding, transactions: initialTransactions, quote, fx, fxDate }: Props) {
  const router = useRouter()
  const [transactions, setTransactions] = useState(initialTransactions)

  function updateTxn(u: UsTransaction) { setTransactions(prev => prev.map(t => t.id === u.id ? u : t)) }
  function deleteTxn(id: string)       { setTransactions(prev => prev.filter(t => t.id !== id)) }

  const position = useMemo(
    () => computeUsPosition(holding, transactions, quote, fx),
    [holding, transactions, quote, fx]
  )

  const sortedTxns = useMemo(
    () => [...transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date)),
    [transactions]
  )
  const grouped = useMemo(() => groupByMonth(sortedTxns), [sortedTxns])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl"
           style={{ background: 'var(--bg-nav)', paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <button onClick={() => router.push('/portfolio')}
                  className="flex items-center gap-1 text-body flex-shrink-0"
                  style={{ color: 'var(--accent)', minWidth: 60, minHeight: 44 }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M7 1L1 7l6 6" /></svg>
            Portfolio
          </button>
          <span className="text-headline font-semibold">US Stock / ETF</span>
          <div style={{ minWidth: 60 }} className="flex justify-end">
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="px-4" style={{ paddingTop: 18, paddingBottom: 4 }}>
        <p className="text-title-1 font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {holding.name || holding.symbol}
        </p>
        <p className="text-subheadline tabnum mt-1" style={{ color: 'var(--text-muted)' }}>
          {holding.symbol} · {holding.region === 'us' ? 'US' : 'India'} · {trimZero(position?.quantity ?? 0, 3)} units
        </p>
      </div>

      {/* Summary */}
      <div className="px-4" style={{ paddingTop: 8 }}>
        <DetailRow label="Current Value" value={position?.currentValue != null ? formatINRFull(position.currentValue) : '—'} />
        <DetailRow label="Invested Value" value={position ? formatINRFull(position.invested) : '—'} />
        <DetailRow
          label="Current Return"
          value={position?.gain != null ? formatPnLFull(position.gain) : '—'}
          valueColor={getGainColor(position?.gain ?? null)}
        />
        <DetailRow
          label="1D Gain"
          value={position?.gain1d != null ? <><Num amount={position.gain1d} signed />{'  '}<Num pct={position.gain1dPct ?? 0} signed /></> : '—'}
          valueColor={getGainColor(position?.gain1d ?? null)}
        />
        <DetailRow
          label="XIRR p.a."
          value={position?.xirr != null ? `${trimPct(Math.abs(position.xirr * 100))}%` : '—'}
          valueColor={getGainColor(position?.xirr ?? null)}
        />
        <DetailRow
          label="Current Price"
          value={quote ? formatUsd(quote.cmp) : '—'}
          caption={quote ? `as of ${formatDate(quote.fetchedAt.slice(0, 10))}` : undefined}
        />
        <DetailRow
          label="USD to INR"
          value={fx ? fx.rate.toFixed(2) : '—'}
          caption={fxDate ? `as of ${formatDate(fxDate.slice(0, 10))}` : undefined}
          last
        />
      </div>

      {/* Transactions */}
      <div className="flex items-baseline justify-between px-4" style={{ paddingTop: 24, paddingBottom: 6 }}>
        <span className="label-section">Transactions</span>
        <span className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>{sortedTxns.length}</span>
      </div>

      {sortedTxns.length === 0 ? (
        <EmptyState>No transactions yet.</EmptyState>
      ) : (
        grouped.map(({ month, items }) => (
          <div key={month}>
            <div className="px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <span className="label-section">{month}</span>
            </div>
            {items.map(t => (
              <TxnRow key={t.id}
                txn={usToDisplayTxn(t, holding.symbol)}
                showAssetTag={false}
                onDelete={deleteTxn}
                onSavedStock={() => {}}
                onSavedUs={updateTxn}
                onSavedMF={() => {}}
                onSavedSGB={() => {}}
                onSavedPPF={() => {}}
                onSavedEPF={() => {}}
              />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function DetailRow({ label, value, valueColor, caption, last: _last }: {
  label: string; value: ReactNode; valueColor?: string; caption?: string; last?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3" style={{ minHeight: 52 }}>
      <p className="text-body" style={{ color: 'var(--text-2)' }}>{label}</p>
      <div className="text-right">
        <p className="text-headline font-semibold tabnum" style={{ color: valueColor ?? 'var(--text-primary)' }}>
          {value}
        </p>
        {caption && (
          <p className="text-footnote mt-0.5" style={{ color: 'var(--text-faint)' }}>{caption}</p>
        )}
      </div>
    </div>
  )
}
