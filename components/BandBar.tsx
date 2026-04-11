import { formatPrice, formatPriceNum } from '@/lib/formatter'

export default function BandBar({ buyLow, buyHigh, midLow, midHigh, trimPrice, cmp }: {
  buyLow: number; buyHigh: number
  midLow: number; midHigh: number
  trimPrice: number; cmp: number | null
}) {
  const min = buyLow * 0.9
  const max = midHigh
  const range = max - min

  function pct(v: number) { return Math.min(100, Math.max(0, ((v - min) / range) * 100)) }

  const deepW  = pct(buyLow)
  const buyW   = pct(buyHigh) - pct(buyLow)
  const waitW  = pct(midLow)  - pct(buyHigh)   // > 0 when Bear compresses buyHigh below midLow
  const midW   = 100 - pct(midLow)
  const cmpPct = cmp != null && cmp >= min && cmp <= max ? pct(cmp) : null
  const showWait = waitW > 1

  return (
    <div>
      {/* Bar */}
      <div className="relative h-7 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-tertiary)' }}>
        <div style={{ width: `${deepW}%`, background: 'rgba(4,120,87,0.28)' }} />
        <div style={{ width: `${buyW}%`, background: 'rgba(34,197,94,0.35)' }} />
        {showWait && (
          <div style={{ width: `${waitW}%`,
            background: 'repeating-linear-gradient(-45deg, #B8DECC 0px, #B8DECC 3px, #D6EDE5 3px, #D6EDE5 8px)' }} />
        )}
        <div style={{ width: `${midW}%`, background: 'rgba(249,115,22,0.30)' }} />
        {cmpPct !== null && (
          <div className="absolute top-0 bottom-0 rounded-full"
               style={{ left: `${cmpPct}%`, width: 4, transform: 'translateX(-50%)', background: 'var(--text-primary)', opacity: 0.9 }} />
        )}
      </div>

      {/* Values row */}
      <div className="flex justify-between mt-2 text-footnote tabnum">
        <div className="text-center">
          <p className="font-semibold text-signal-buy">&lt;{formatPrice(buyLow)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Deep</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-signal-buy">₹{formatPriceNum(buyLow)}–{formatPriceNum(buyHigh)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Buy</p>
        </div>
        {showWait && (
          <div className="text-center">
            <p className="font-semibold" style={{ color: '#5EAA80' }}>₹{formatPriceNum(buyHigh)}–{formatPriceNum(midLow)}</p>
            <p style={{ color: 'var(--text-faint)' }}>Wait</p>
          </div>
        )}
        <div className="text-center">
          <p className="font-semibold text-signal-hold">₹{formatPriceNum(midLow)}–{formatPriceNum(midHigh)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Hold</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-signal-trim">≥{formatPrice(trimPrice)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Trim</p>
        </div>
      </div>
    </div>
  )
}
