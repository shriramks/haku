import { splitINR, splitPct } from '@/lib/formatter'

type NumProps =
  | { amount: number | null; pct?: never; signed?: boolean }
  | { pct: number | null; amount?: never; signed?: boolean }

export function Num({ amount, pct, signed }: NumProps) {
  if (amount !== undefined) {
    if (amount === null) return <>—</>
    const { digits, unit } = splitINR(amount)
    const pos = signed && amount > 0
    const neg = signed && amount < 0
    return (
      <>
        {(pos || neg) && <span className="num-sgn">{pos ? '+' : '−'}</span>}
        {digits}
        {unit && <span className="num-u">{unit}</span>}
      </>
    )
  }

  if (pct === null || pct === undefined) return <>—</>
  const { digits, unit } = splitPct(pct)
  const pos = signed && pct > 0
  const neg = signed && pct < 0
  return (
    <>
      {(pos || neg) && <span className="num-sgn">{pos ? '+' : '−'}</span>}
      {digits}
      {unit && <span className="num-u">{unit}</span>}
    </>
  )
}
