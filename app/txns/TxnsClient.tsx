'use client'
import { useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatDate } from '@/lib/formatter'
import type { Transaction } from '@/lib/types'

export default function TxnsClient({ transactions: initial }: { transactions: Transaction[] }) {
  const [txns, setTxns] = useState(initial)

  async function deleteTxn(id: string) {
    await getSupabaseBrowser().from('transactions').delete().eq('id', id)
    setTxns(prev => prev.filter(t => t.id !== id))
  }

  const grouped = groupByMonth(txns)

  return (
    <div className="pt-[env(safe-area-inset-top,0px)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-xl border-b border-white/10 px-5 pb-3">
        <h1 className="text-[28px] font-bold pt-4">Transactions</h1>
        {txns.length > 0 && (
          <p className="text-[13px] text-white/40 mt-0.5">{txns.length} total</p>
        )}
      </div>

      {txns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 text-white/30 gap-2">
          <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-[17px] font-medium">No transactions yet</p>
          <p className="text-[15px]">Tap + to log your first trade</p>
        </div>
      ) : (
        <div className="py-4 space-y-5">
          {grouped.map(({ month, items, buyTotal, sellTotal }) => (
            <section key={month}>
              {/* Month header */}
              <div className="flex items-baseline justify-between px-5 mb-2">
                <p className="text-[13px] font-semibold text-white/40 uppercase tracking-widest">{month}</p>
                <div className="flex gap-3 text-[12px] tabnum">
                  {buyTotal > 0 && <span className="text-[#30D158]/70">+{formatINR(buyTotal)}</span>}
                  {sellTotal > 0 && <span className="text-[#FF453A]/70">−{formatINR(sellTotal)}</span>}
                </div>
              </div>

              {/* Card group */}
              <div className="mx-4 rounded-2xl overflow-hidden bg-[#1C1C1E] divide-y divide-white/[0.06]">
                {items.map(txn => (
                  <TxnRow key={txn.id} txn={txn} onDelete={deleteTxn} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TxnRow({ txn, onDelete }: { txn: Transaction; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const isBuy = txn.trade_type === 'buy'

  if (confirming) {
    return (
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-[15px] text-white/60">Delete this transaction?</p>
        <div className="flex gap-4">
          <button onClick={() => setConfirming(false)} className="text-[#0A84FF] text-[15px]">Keep</button>
          <button onClick={() => onDelete(txn.id)} className="text-[#FF453A] text-[15px] font-semibold">Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center px-4 py-3.5 gap-3 tap-row active:bg-white/5">
      {/* Coloured dot */}
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5
        ${isBuy ? 'bg-[#30D158]' : 'bg-[#FF453A]'}`} />

      {/* Symbol + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[16px]">{txn.symbol}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md
            ${isBuy ? 'bg-[#30D158]/15 text-[#30D158]' : 'bg-[#FF453A]/15 text-[#FF453A]'}`}>
            {isBuy ? 'BUY' : 'SELL'}
          </span>
        </div>
        <p className="text-[13px] text-white/40 tabnum mt-0.5">
          {Math.round(txn.quantity)} shares · ₹{txn.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })} · {formatDate(txn.trade_date)}
        </p>
        {txn.notes && (
          <p className="text-[12px] text-white/30 mt-0.5 truncate">{txn.notes}</p>
        )}
      </div>

      {/* Amount + delete */}
      <div className="flex items-center gap-3">
        <p className={`font-bold tabnum text-[16px] ${isBuy ? 'text-white' : 'text-[#FF453A]'}`}>
          {isBuy ? '' : '−'}{formatINR(txn.amount)}
        </p>
        <button onClick={() => setConfirming(true)}
          className="text-white/20 hover:text-white/50 text-[22px] leading-none px-1 transition-colors">
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
    buyTotal:  items.filter(t => t.trade_type === 'buy').reduce((s, t) => s + t.amount, 0),
    sellTotal: items.filter(t => t.trade_type === 'sell').reduce((s, t) => s + t.amount, 0),
  }))
}
