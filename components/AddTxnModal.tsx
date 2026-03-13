'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { todayISO, formatINR } from '@/lib/formatter'

export default function AddTxnModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [symbol, setSymbol]         = useState('')
  const [planSymbols, setPlanSymbols] = useState<string[]>([])
  const [type, setType]             = useState<'buy' | 'sell'>('buy')
  const [date, setDate]             = useState(todayISO())
  const [qty, setQty]               = useState('')
  const [price, setPrice]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [done, setDone]             = useState(false)

  useEffect(() => {
    async function loadSymbols() {
      const sb = getSupabaseBrowser()
      const today = new Date().toISOString().slice(0, 10)
      const { data: fys } = await sb
        .from('fiscal_years')
        .select('id')
        .lte('start_date', today)
        .gte('end_date', today)
        .limit(1)
      if (!fys?.length) return
      const { data: allocs } = await sb
        .from('stock_allocations')
        .select('symbol')
        .eq('fy_id', fys[0].id)
        .order('symbol')
      if (allocs) setPlanSymbols(allocs.map(a => a.symbol))
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
    if (!user) { onClose(); return }

    const d = new Date(date)
    const fyEndYear = (d.getMonth() + 1) >= 4 ? d.getFullYear() + 1 : d.getFullYear()
    const { data: fyRows } = await sb
      .from('fiscal_years').select('id')
      .gte('start_date', `${fyEndYear - 1}-04-01`)
      .lte('end_date', `${fyEndYear}-03-31`)
      .limit(1)

    const { error } = await sb.from('transactions').insert({
      user_id: user.id, symbol, exchange: 'NSE',
      trade_date: date, trade_type: type,
      quantity: parseFloat(qty), price: parseFloat(price),
      fy_id: fyRows?.[0]?.id ?? null,
    })

    setLoading(false)
    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => { router.refresh(); onClose() }, 700)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      <div
        className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-[28px] max-h-[92vh] overflow-y-auto"
        style={{
          background: 'var(--bg-secondary)',
          paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)',
        }}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-1 pb-4">
          <button onClick={onClose} className="text-[#0A84FF] text-[17px]">Cancel</button>
          <p className="font-semibold text-[17px]">New Transaction</p>
          <div className="w-16" />
        </div>

        <form onSubmit={submit} className="px-4 space-y-3">

          {/* Stock chips */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Stock</p>
              {symbol && (
                <button type="button" onClick={() => setSymbol('')}
                  className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  clear
                </button>
              )}
            </div>
            {planSymbols.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {planSymbols.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSymbol(s)}
                    className="px-3 py-2 rounded-2xl text-[14px] font-semibold transition-colors"
                    style={symbol === s
                      ? { background: type === 'buy' ? '#34C759' : '#FF3B30', color: '#fff' }
                      : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }
                    }>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>Loading plan…</p>
            )}
          </div>

          {/* Buy / Sell toggle */}
          <div>
            <p className="text-[11px] mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Type</p>
            <div className="flex rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {(['buy', 'sell'] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className="flex-1 py-3.5 text-[15px] font-bold transition-colors"
                  style={type === t
                    ? { background: t === 'buy' ? '#34C759' : '#FF3B30', color: '#fff' }
                    : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                  {t === 'buy' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <p className="text-[11px] mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Date</p>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required
              className="w-full px-3 py-3.5 rounded-2xl text-[17px] outline-none"
              style={{
                background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', colorScheme: 'light dark',
              }} />
          </div>

          {/* Qty × Price */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Quantity', val: qty, set: setQty, ph: '100', decimal: false },
              { label: 'Price (₹)', val: price, set: setPrice, ph: '1250.50', decimal: true },
            ].map(({ label, val, set, ph, decimal }) => (
              <div key={label}>
                <p className="text-[11px] mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p>
                <input type="number" inputMode={decimal ? 'decimal' : 'numeric'} placeholder={ph} value={val}
                  onChange={e => set(e.target.value)} required min={decimal ? '0.001' : '1'} step={decimal ? 'any' : '1'}
                  className="w-full px-3 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{
                    background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                  }} />
              </div>
            ))}
          </div>

          {/* Live total */}
          {amount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl"
                 style={{ background: 'var(--bg-tertiary)' }}>
              <span className="text-[15px]" style={{ color: 'var(--text-muted)' }}>Total</span>
              <span className={`font-bold tabnum text-[20px] ${type === 'buy' ? 'text-green-500' : 'text-red-400'}`}>
                {formatINR(amount)}
              </span>
            </div>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button type="submit" disabled={loading || !symbol || !qty || !price}
            className="w-full py-4 rounded-2xl font-bold text-[17px] transition-all active:scale-[0.98] disabled:opacity-40 text-white"
            style={{ background: done ? 'var(--border)' : type === 'buy' ? '#34C759' : '#FF3B30' }}>
            {done ? '✓ Added' : loading ? '…' : `${type === 'buy' ? 'Buy' : 'Sell'} ${symbol || '…'}`}
          </button>
        </form>
      </div>
    </>
  )
}
