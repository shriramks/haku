import { splitINR, splitPct } from '@/lib/formatter'

type NumProps =
  | { amount: number | null; pct?: never; signed?: boolean; align?: boolean }
  | { pct: number | null; amount?: never; signed?: boolean; align?: boolean }

export function Num({ amount, pct, signed, align }: NumProps) {
  const isAmount = amount !== undefined
  const value = isAmount ? amount : pct

  if (value === null || value === undefined) {
    return align
      ? <span className="num-col"><span className="num-digits">—</span><span className="num-uslot" /></span>
      : <>—</>
  }

  const { digits, unit } = isAmount ? splitINR(value) : splitPct(value)
  const pos = signed && value > 0
  const neg = signed && value < 0
  const sign = pos ? '+' : neg ? '−' : ''

  if (align) {
    return (
      <span className="num-col">
        <span className="num-digits">
          {sign && <span className="num-sgn">{sign}</span>}{digits}
        </span>
        <span className="num-uslot">{unit}</span>
      </span>
    )
  }

  return (
    <>
      {sign && <span className="num-sgn">{sign}</span>}
      {digits}
      {unit && <span className="num-u">{unit}</span>}
    </>
  )
}

/** Columnar figure for non-currency values (e.g. gold grams) — shares the
 * digits/unit slot layout so it lines up with `Num align` columns. */
export function NumUnit({ digits, unit }: { digits: string; unit: string }) {
  return (
    <span className="num-col">
      <span className="num-digits">{digits}</span>
      <span className="num-uslot">{unit}</span>
    </span>
  )
}
