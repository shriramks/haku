'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import BottomNav from '@/components/BottomNav'
import { todayISO, formatINR } from '@/lib/formatter'

export default function AddPage() {
  const router = useRouter()
  const [symbol, setSymbol]           = useState('')
  const [planSymbols, setPlanSymbols] = useState<string[]>([])
  const [type, setType]               = useState<'buy' | 'sell'>('buy')
  const [date, setDate]               = useState(todayISO())
  const [qty, setQty]                 = useState('')
  const [price, setPrice]             = useState('')
  const [loading, setLoading]           = useState(false)
  const [symbolsLoaded, setSymbolsLoaded] = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [done, setDone]                 = useState(false)

  useEffect(() => {
    async function loadSymbols() {
      const sb = getSupabaseBrowser()
      const today = new Date().toISOString().slice(0, 10)
      const { data: fys } = await sb
        .from('fiscal_years').select('id')
        .lte('start_date', today).gte('end_date', today).limit(1)
      if (!fys?.length) { setSymbolsLoaded(true); return }
      const { data: allocs } = await sb
        .from('stock_allocations').select('symbol')
        .eq('fy_id', fys[0].id).order('symbol')
      if (allocs) setPlanSymbols(allocs.map(a => a.symbol))
      setSymbolsLoaded(true)
    }
    loadSymbols()
  }, [])

  const amount = (parseFloat(qty) || 0) * (parseFloat(price) || 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!symbol || !qty || !price) return
    setLoading(true); setError(null)

    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { router.push('/login'); return }

    const d = new Date(date)
    const fyEndYear = (d.getMonth() + 1) >= 4 ? d.getFullYear() + 1 : d.getFullYear()
    const { data: fyRows } = await sb
      .from('fiscal_years').select('id')
      .gte('start_date', `${fyEndYear - 1}-04-01`)
      .lte('end_date', `${fyEndYear}-03-31`).limit(1)

    const { error } = await sb.from('transactions').insert({
      user_id: user.id, symbol, exchange: 'NSE',
      trade_date: date, trade_type: type,
      quantity: parseFloat(qty), price: parseFloat(price),
      fy_id: fyRows?.[0]?.id ?? null,
    })

    setLoading(false)
    if (error) { setError(error.message); return }

    // Flash success then reset — keep symbol for quick back-to-back adds
    setDone(true)
    setTimeout(() => { setDone(false); setQty(''); setPrice('') }, 1200)
  }

  return (
    <>
      <div className="pt-[env(safe-area-inset-top,0px)]"
           style={{ background: 'var(--bg-primary)', flex: 1, overflowY: 'auto' }}>
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <h1 className="text-title-2 font-bold">New Transaction</h1>
        </div>

        <form onSubmit={submit} className="px-4 pt-4 space-y-4 pb-28">

          {/* Stock chips */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-footnote uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Stock</p>
              {symbol && (
                <button type="button" onClick={() => setSymbol('')}
                  className="text-subheadline" style={{ color: 'var(--text-faint)' }}>clear</button>
              )}
            </div>
            {!symbolsLoaded ? (
              <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>Loading plan…</p>
            ) : planSymbols.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {planSymbols.map(s => (
                  <button key={s} type="button" onClick={() => setSymbol(s)}
                    className="px-3 py-2 rounded-2xl text-body font-semibold transition-colors"
                    style={symbol === s
                      ? { background: type === 'buy' ? '#34C759' : '#FF3B30', color: '#fff' }
                      : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl p-4"
                   style={{ background: 'rgba(10,132,255,0.08)', border: '1px solid rgba(10,132,255,0.2)' }}>
                <p className="text-body font-semibold mb-1 text-accent">No stocks in current plan</p>
                <p className="text-subheadline mb-2" style={{ color: 'var(--text-2)' }}>
                  Add stocks to your plan before logging transactions.
                </p>
                <a href="/plan" className="text-body font-semibold text-accent">
                  Go to Plan →
                </a>
              </div>
            )}
          </div>

          {/* Buy / Sell */}
          <div>
            <p className="text-footnote mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Type</p>
            <div className="flex rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {(['buy', 'sell'] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className="flex-1 py-3.5 text-body font-bold transition-colors"
                  style={type === t
                    ? { background: t === 'buy' ? '#34C759' : '#FF3B30', color: '#fff' }
                    : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                  {t === 'buy' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div className="overflow-hidden">
            <p className="text-footnote mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Date</p>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required
              className="w-full px-3 py-2.5 rounded-2xl text-body outline-none max-w-full"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark', boxSizing: 'border-box' }} />
          </div>

          {/* Qty × Price */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Quantity', val: qty, set: setQty, ph: '100', decimal: false },
              { label: 'Price (₹)', val: price, set: setPrice, ph: '1250.50', decimal: true },
            ].map(({ label, val, set, ph, decimal }) => (
              <div key={label}>
                <p className="text-footnote mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p>
                <input type="number" inputMode={decimal ? 'decimal' : 'numeric'} placeholder={ph} value={val}
                  onChange={e => set(e.target.value)} required min={decimal ? '0.001' : '1'} step={decimal ? 'any' : '1'}
                  className="w-full px-3 py-3.5 rounded-2xl text-headline tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            ))}
          </div>

          {/* Live total */}
          {amount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl"
                 style={{ background: 'var(--bg-tertiary)' }}>
              <span className="text-body" style={{ color: 'var(--text-muted)' }}>Total</span>
              <span className={`font-bold tabnum text-title-2 ${type === 'buy' ? 'text-positive' : 'text-negative'}`}>
                {formatINR(amount)}
              </span>
            </div>
          )}

          {error && <p className="text-negative text-subheadline text-center">{error}</p>}

          <button type="submit" disabled={loading || !symbol || !qty || !price}
            className="w-full py-4 rounded-2xl font-bold text-headline transition-all active:scale-[0.98] disabled:opacity-40 text-white"
            style={{ background: done ? '#30D158' : type === 'buy' ? '#34C759' : '#FF3B30' }}>
            {done ? '✓ Added' : loading ? '…' : `${type === 'buy' ? 'Buy' : 'Sell'} ${symbol || '…'}`}
          </button>
        </form>
      </div>
      <BottomNav />
    </>
  )
}
