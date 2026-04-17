'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { todayISO, formatINR, formatINRFull, formatPrice } from '@/lib/formatter'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'

export default function AddTxnModal({ onClose, initialSymbol, planSymbols: planSymbolsProp }: { onClose: () => void; initialSymbol?: string; planSymbols?: string[] }) {
  const router = useRouter()
  const [symbol, setSymbol]         = useState(initialSymbol ?? '')
  const [planSymbols, setPlanSymbols] = useState<string[]>(() => {
    if (planSymbolsProp && planSymbolsProp.length > 0) return planSymbolsProp
    try { const c = localStorage.getItem('haku_plan_symbols'); return c ? JSON.parse(c) : [] } catch { return [] }
  })
  const [type, setType]             = useState<'buy' | 'sell'>('buy')
  const [date, setDate]             = useState(todayISO())
  const [qty, setQty]               = useState('')
  const [price, setPrice]           = useState('')
  const [redeploy, setRedeploy]     = useState(true)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [done, setDone]             = useState(false)
  const kh = useKeyboardHeight()

  useEffect(() => {
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [])

  useEffect(() => {
    if (planSymbolsProp && planSymbolsProp.length > 0) return
    async function loadSymbols() {
      const sb = getSupabaseBrowser()
      const { data: allocs } = await sb
        .from('stock_allocations')
        .select('symbol')
        .order('symbol')
      if (allocs) {
        const unique = [...new Set(allocs.map(a => a.symbol))].sort()
        setPlanSymbols(unique)
      }
    }
    loadSymbols()
  }, [planSymbolsProp])

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

    const fyId = fyRows?.[0]?.id ?? null
    const { error } = await sb.from('transactions').insert({
      user_id: user.id, symbol, exchange: 'NSE',
      trade_date: date, trade_type: type,
      quantity: parseFloat(qty), price: parseFloat(price),
      fy_id: fyId,
    })

    if (!error && type === 'sell' && redeploy && fyId) {
      const { data: fy } = await sb.from('fiscal_years')
        .select('unallocated_carryover_inr').eq('id', fyId).single()
      const current = fy?.unallocated_carryover_inr ?? 0
      await sb.from('fiscal_years')
        .update({ unallocated_carryover_inr: current + amount })
        .eq('id', fyId)
    }

    setLoading(false)
    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => {
      router.refresh()
      onClose()
    }, 700)
  }

  const signalColor = type === 'buy' ? '#34C759' : '#FF3B30'

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      <div
        className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl flex flex-col overflow-hidden sheet-kb"
        style={{
          bottom: kh,
          background: 'var(--bg-secondary)',
          maxHeight: kh > 0
            ? `calc(100dvh - ${kh}px - max(env(safe-area-inset-top,0px), 16px))`
            : '92dvh',
        }}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-1 pb-3 flex-shrink-0">
          <button onClick={onClose} className="text-accent text-headline min-h-[44px] min-w-[44px] flex items-center">Cancel</button>
          <p className="font-semibold text-headline">New Transaction</p>
          <div className="w-16" />
        </div>

        {/* Buy / Sell toggle — dominant, first */}
        <div className="px-4 mb-0 flex-shrink-0">
          <div className="flex rounded-xl overflow-hidden" style={{ border: `1.5px solid var(--border)`, height: 54 }}>
            {(['buy', 'sell'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className="flex-1 text-headline font-bold transition-colors"
                style={type === t
                  ? { background: t === 'buy' ? '#34C759' : '#FF3B30', color: '#fff' }
                  : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {t === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>
        </div>

        {/* Live total — always visible, hero number */}
        <div className="flex flex-col items-center py-3 flex-shrink-0">
          {amount > 0 ? (
            <>
              <p className="tabnum font-bold" style={{ fontSize: 30, letterSpacing: -0.5, color: signalColor }}>
                {formatINRFull(amount)}
              </p>
              <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {qty} × {formatPrice(parseFloat(price) || 0)}
              </p>
            </>
          ) : (
            <>
              <p className="font-bold" style={{ fontSize: 34, letterSpacing: -0.5, color: 'var(--text-faint)' }}>₹ —</p>
              <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-faint)' }}>enter qty &amp; price below</p>
            </>
          )}
        </div>

        <div className="flex-shrink-0" style={{ height: 1, background: 'var(--border-faint)', margin: '0 16px 14px' }} />

        {/* Scrollable form area */}
        <div className="overflow-y-auto" style={{ paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <form onSubmit={submit} className="px-4 space-y-3">

          {/* Stock chips */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-footnote uppercase tracking-wide" style={{ color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.07em' }}>Stock</p>
              {symbol && (
                <button type="button" onClick={() => setSymbol('')}
                  className="text-subheadline" style={{ color: 'var(--text-faint)' }}>
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
                    className="px-3 rounded-xl text-body font-semibold transition-colors"
                    style={{
                      minHeight: 36,
                      ...(symbol === s
                        ? {
                            background: type === 'buy' ? 'rgba(52,199,89,0.10)' : 'rgba(255,59,48,0.10)',
                            color: signalColor,
                            border: `1.5px solid ${signalColor}`,
                          }
                        : {
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-2)',
                            border: '1.5px solid transparent',
                          }),
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>Loading plan…</p>
            )}
          </div>

          {/* Date */}
          <div className="overflow-hidden">
            <p className="text-footnote mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.07em' }}>Date</p>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required
              onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
              className="w-full px-3 py-2.5 rounded-xl text-body outline-none max-w-full"
              style={{
                background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', colorScheme: 'light dark',
                boxSizing: 'border-box',
              }} />
          </div>

          {/* Qty × Price — grouped card */}
          <div className="grid grid-cols-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
            {[
              { label: 'Quantity', val: qty, set: setQty, ph: '100', decimal: false, align: 'left' },
              { label: 'Price ₹', val: price, set: setPrice, ph: '1250.50', decimal: true, align: 'right' },
            ].map(({ label, val, set, ph, decimal, align }, i) => (
              <div key={label} className="p-3" style={i === 1 ? { borderLeft: '1px solid var(--border)' } : {}}>
                <p className="text-footnote uppercase mb-1" style={{ fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-faint)' }}>{label}</p>
                <input
                  type="number"
                  inputMode={decimal ? 'decimal' : 'numeric'}
                  placeholder={ph}
                  value={val}
                  onChange={e => set(e.target.value)}
                  required
                  min={decimal ? '0.001' : '1'}
                  step={decimal ? 'any' : '1'}
                  onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                  className="w-full bg-transparent tabnum font-bold outline-none"
                  style={{
                    fontSize: 22,
                    color: 'var(--text-primary)',
                    textAlign: align === 'right' ? 'right' : 'left',
                  }}
                />
              </div>
            ))}
          </div>

          {/* Redeploy toggle — sell only */}
          {type === 'sell' && amount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                 style={{ background: 'rgba(255,59,48,0.06)', border: '1px solid rgba(255,59,48,0.15)', opacity: redeploy ? 1 : 0.6 }}>
              <div className="flex-1 mr-3">
                <p className="text-body font-medium">Redeploy proceeds</p>
                <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {redeploy ? `Adds ${formatINR(amount)} to this year's budget` : 'Proceeds stay in this stock\'s allocation'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRedeploy(r => !r)}
                className="relative flex-shrink-0"
                style={{ width: 51, height: 31 }}>
                <div className={`absolute inset-0 rounded-full transition-colors duration-200 ${redeploy ? 'bg-positive' : 'bg-[#ccc]'}`} />
                <div className="absolute top-0.5 rounded-full bg-white shadow transition-transform duration-200"
                     style={{ width: 27, height: 27, left: 2, transform: redeploy ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
          )}

          {error && <p className="text-negative text-body text-center">{error}</p>}

          <button type="submit" disabled={loading || !symbol || !qty || !price}
            className="w-full py-4 rounded-xl font-bold text-headline transition-all active:scale-[0.98] disabled:opacity-40 text-white"
            style={{ background: done ? 'var(--border)' : signalColor }}>
            {done ? '✓ Added' : loading ? '…' : `${type === 'buy' ? 'Buy' : 'Sell'} ${symbol || '…'}`}
          </button>
        </form>
        </div>
      </div>
    </>
  )
}
