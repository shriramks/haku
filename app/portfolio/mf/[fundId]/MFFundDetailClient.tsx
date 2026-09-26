'use client'

import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { formatINRFull, formatPriceFine, formatPnLFull, formatDate, trimZero, trimPct, getGainColor } from '@/lib/formatter'
import UserMenu from '@/components/UserMenu'
import EmptyState from '@/components/EmptyState'
import { Num } from '@/components/Num'
import { computeMFHolding } from '@/lib/mf-compute'
import { TxnRow, mfToDisplayTxn } from '@/components/EditableTxnRow'
import type { MFund, MFTransaction } from '@/lib/portfolio-types'

interface Props {
  fund: MFund
  transactions: MFTransaction[]
  nav: number | null
  prevNav: number | null
  navDate: string | null
}

function groupByMonth(txns: MFTransaction[]) {
  const map = new Map<string, MFTransaction[]>()
  for (const t of txns) {
    const key = new Date(t.trade_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    ;(map.get(key) ?? map.set(key, []).get(key)!).push(t)
  }
  return Array.from(map.entries()).map(([month, items]) => ({ month, items }))
}

export default function MFFundDetailClient({ fund, transactions: initialTransactions, nav, prevNav, navDate }: Props) {
  const router = useRouter()
  const [transactions, setTransactions] = useState(initialTransactions)

  function updateTxn(u: MFTransaction) { setTransactions(prev => prev.map(t => t.id === u.id ? u : t)) }
  function deleteTxn(id: string)       { setTransactions(prev => prev.filter(t => t.id !== id)) }

  const holding = useMemo(
    () => computeMFHolding(fund, transactions, nav, prevNav),
    [fund, transactions, nav, prevNav]
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
          <span className="text-headline font-semibold">Mutual Fund</span>
          <div style={{ minWidth: 60 }} className="flex justify-end">
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Fund title */}
      <div className="px-4" style={{ paddingTop: 18, paddingBottom: 4 }}>
        <p className="text-title-1 font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {fund.scheme_name}
        </p>
        <p className="text-subheadline tabnum mt-1" style={{ color: 'var(--text-muted)' }}>
          {trimZero(holding?.units ?? 0, 3)} units
        </p>
      </div>

      {/* Summary */}
      <div className="px-4" style={{ paddingTop: 8 }}>
        <DetailRow label="Current Value" value={holding?.currentValue != null ? formatINRFull(holding.currentValue) : '—'} />
        <DetailRow label="Invested Value" value={holding ? formatINRFull(holding.invested) : '—'} />
        <DetailRow
          label="Current Return"
          value={holding ? formatPnLFull(holding.gain) : '—'}
          valueColor={getGainColor(holding?.gain ?? null)}
        />
        <DetailRow
          label="1D Gain"
          value={holding ? <><Num amount={holding.gain1d} signed />{'  '}<Num pct={holding.gain1dPct} signed /></> : '—'}
          valueColor={getGainColor(holding?.gain1d ?? null)}
        />
        <DetailRow
          label="XIRR p.a."
          value={holding?.xirr != null ? `${trimPct(Math.abs(holding.xirr * 100))}%` : '—'}
          valueColor={getGainColor(holding?.xirr ?? null)}
        />
        <DetailRow
          label="Current NAV"
          value={holding?.currentNav != null ? formatPriceFine(holding.currentNav) : '—'}
          caption={navDate ? `as of ${formatDate(navDate)}` : undefined}
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
                txn={mfToDisplayTxn(t, fund.scheme_name)}
                showAssetTag={false}
                onDelete={deleteTxn}
                onSavedStock={() => {}}
                onSavedMF={updateTxn}
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
    <div className="flex items-center justify-between py-3" style={{ minHeight: 52, borderBottom: _last ? 'none' : '1px solid var(--divider)' }}>
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
