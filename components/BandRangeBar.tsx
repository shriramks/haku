'use client'

interface Props {
  buyLow: number; buyHigh: number
  midLow: number; midHigh: number
  trimPrice: number
  cmp?: number | null
  height?: number
}

export default function BandRangeBar({ buyLow, buyHigh, midLow, midHigh, trimPrice, cmp, height = 28 }: Props) {
  const range = trimPrice - buyLow
  if (range <= 0) return null

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - buyLow) / range) * 100))

  const buyW  = pct(buyHigh)
  const midL  = pct(midLow)
  const midW  = pct(midHigh) - midL
  const trimL = pct(midHigh)
  const trimW = 100 - trimL

  const cmpPct = cmp !== null && cmp !== undefined ? pct(cmp) : null

  return (
    <div className="relative w-full" style={{ height: height + (cmpPct !== null ? 10 : 0) }}>
      {/* Track */}
      <div className="absolute inset-x-0 rounded-lg overflow-hidden" style={{ height }}>
        {/* Buy zone */}
        <div className="absolute top-0 bottom-0 bg-green-500/75"
             style={{ left: 0, width: `${buyW}%` }} />
        {/* Mid zone */}
        <div className="absolute top-0 bottom-0 bg-orange-500/75"
             style={{ left: `${midL}%`, width: `${midW}%` }} />
        {/* Trim zone */}
        <div className="absolute top-0 bottom-0 bg-red-500/75"
             style={{ left: `${trimL}%`, width: `${trimW}%` }} />

        {/* Zone labels */}
        <div className="absolute inset-0 flex items-center">
          <span className="text-[9px] font-bold text-white/90 pl-1" style={{ width: `${buyW}%` }}>Buy</span>
          <span className="text-[9px] font-bold text-white/90" style={{ width: `${midW}%` }}>Mid</span>
          <span className="text-[9px] font-bold text-white/90" style={{ width: `${trimW}%` }}>Trim</span>
        </div>
      </div>

      {/* CMP pin */}
      {cmpPct !== null && (
        <div className="absolute bottom-0" style={{ left: `calc(${cmpPct}% - 1px)` }}>
          <div className="w-0.5" style={{ height, background: 'var(--text-primary)' }} />
          {/* Triangle tip */}
          <div className="w-0 h-0 mx-auto"
               style={{
                 borderLeft: '4px solid transparent',
                 borderRight: '4px solid transparent',
                 borderTop: '6px solid var(--text-primary)',
               }} />
        </div>
      )}
    </div>
  )
}
