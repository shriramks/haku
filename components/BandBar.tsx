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
        <div className="h-full flex items-center justify-center"
             style={{ width: `${deepW}%`, background: 'rgba(4,120,87,0.28)' }}>
          {deepW > 8 && <span className="text-footnote font-semibold truncate px-1 text-signal-buy">DEEP</span>}
        </div>
        <div className="h-full flex items-center justify-center"
             style={{ width: `${buyW}%`, background: 'rgba(34,197,94,0.35)' }}>
          <span className="text-footnote font-semibold text-signal-buy truncate px-1">BUY</span>
        </div>
        {showWait && (
          <div className="h-full flex items-center justify-center"
               style={{ width: `${waitW}%`,
                 background: 'repeating-linear-gradient(-45deg, #B8DECC 0px, #B8DECC 3px, #D6EDE5 3px, #D6EDE5 8px)' }}>
            {waitW > 5 && <span className="text-footnote font-semibold truncate px-1" style={{ color: '#3A8A5A' }}>WAIT</span>}
          </div>
        )}
        <div className="h-full flex items-center justify-center"
             style={{ width: `${midW}%`, background: 'rgba(249,115,22,0.30)' }}>
          <span className="text-footnote font-semibold text-signal-hold truncate px-1">HOLD</span>
        </div>
        {cmpPct !== null && (
          <div className="absolute top-0 bottom-0 w-0.5 rounded-full"
               style={{ left: `${cmpPct}%`, background: 'var(--text-primary)' }} />
        )}
      </div>

      {/* Values row */}
      <div className="flex justify-between mt-2 text-footnote tabnum">
        <div className="text-center">
          <p className="font-semibold text-signal-buy">&lt;₹{Math.round(buyLow)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Deep</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-signal-buy">₹{Math.round(buyLow)}–{Math.round(buyHigh)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Buy</p>
        </div>
        {showWait && (
          <div className="text-center">
            <p className="font-semibold" style={{ color: '#5EAA80' }}>₹{Math.round(buyHigh)}–{Math.round(midLow)}</p>
            <p style={{ color: 'var(--text-faint)' }}>Wait</p>
          </div>
        )}
        <div className="text-center">
          <p className="font-semibold text-signal-hold">₹{Math.round(midLow)}–{Math.round(midHigh)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Hold</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-signal-trim">≥₹{Math.round(trimPrice)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Trim</p>
        </div>
      </div>
    </div>
  )
}
