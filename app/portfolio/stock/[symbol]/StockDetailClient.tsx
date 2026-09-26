'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { formatINRFull, formatPriceNum, formatPnLFull, trimPct, getGainColor } from '@/lib/formatter'
import UserMenu from '@/components/UserMenu'
import EmptyState from '@/components/EmptyState'
import { seqCost } from '@/lib/compute'
import { stockXirr } from '@/lib/xirr'
import { TxnRow, stockToDisplayTxn } from '@/components/EditableTxnRow'
import type { Transaction } from '@/lib/types'

interface Props {
  symbol: string
  transactions: Transaction[]
  cmp: number | null   // resolved server-side (saved price, else band snapshot) — see resolveCmp
}

function groupByMonth(txns: Transaction[]) {
  const map = new Map<string, Transaction[]>()
  for (const t of txns) {
    const key = new Date(t.trade_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    ;(map.get(key) ?? map.set(key, []).get(key)!).push(t)
  }
  return Array.from(map.entries()).map(([month, items]) => ({ month, items }))
}

export default function StockDetailClient({ symbol, transactions: initialTransactions, cmp }: Props) {
  const router = useRouter()
  const [transactions, setTransactions] = useState(initialTransactions)

  function updateTxn(u: Transaction) { setTransactions(prev => prev.map(t => t.id === u.id ? u : t)) }
  function deleteTxn(id: string)     { setTransactions(prev => prev.filter(t => t.id !== id)) }

  const { qty, cost } = useMemo(() => seqCost(transactions), [transactions])
  const currentValue = cmp !== null ? qty * cmp : null
  const gain = currentValue !== null ? currentValue - cost : null
  const xirr = useMemo(
    () => currentValue !== null ? stockXirr(transactions, currentValue) : null,
    [transactions, currentValue]
  )

  const sortedTxns = useMemo(
    () => [...transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date)),
    [transactions]
  )
  const grouped = useMemo(() => groupByMonth(sortedTxns), [sortedTxns])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)', paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <button onClick={() => router.push('/portfolio')}
                  className="flex items-center gap-1 text-body flex-shrink-0"
                  style={{ color: 'var(--accent)', minWidth: 60, minHeight: 44 }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M7 1L1 7l6 6" /></svg>
            Portfolio
          </button>
          <span className="text-headline font-semibold">Stock</span>
          <div style={{ minWidth: 60 }} className="flex justify-end">
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Stock title */}
      <div className="px-4" style={{ paddingTop: 18, paddingBottom: 4 }}>
        <p className="text-title-1 font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {symbol}
        </p>
        <p className="text-subheadline tabnum mt-1" style={{ color: 'var(--text-muted)' }}>
          {qty.toLocaleString('en-IN', { maximumFractionDigits: 0 })} shares
        </p>
      </div>

      {/* Summary */}
      <div className="px-4" style={{ paddingTop: 8 }}>
        <DetailRow label="Current Value" value={currentValue != null ? formatINRFull(currentValue) : '—'} />
        <DetailRow label="Invested Value" value={formatINRFull(cost)} />
        <DetailRow
          label="Current Return"
          value={formatPnLFull(gain)}
          valueColor={getGainColor(gain)}
        />
        <DetailRow
          label="XIRR p.a."
          value={xirr != null ? `${trimPct(Math.abs(xirr * 100))}%` : '—'}
          valueColor={getGainColor(xirr)}
        />
        <DetailRow label="Current Price" value={cmp != null ? formatPriceNum(cmp) : '—'} last />
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
                txn={stockToDisplayTxn(t)}
                showAssetTag={false}
                onDelete={deleteTxn}
                onSavedStock={updateTxn}
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

function DetailRow({ label, value, valueColor, last: _last }: {
  label: string; value: string; valueColor?: string; last?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3" style={{ minHeight: 52, borderBottom: _last ? 'none' : '1px solid var(--divider)' }}>
      <p className="text-body" style={{ color: 'var(--text-2)' }}>{label}</p>
      <p className="text-headline font-semibold tabnum text-right" style={{ color: valueColor ?? 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}
