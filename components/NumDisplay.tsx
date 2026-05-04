import { trimPct } from '@/lib/formatter'

const SMALL = 'text-[0.6em] leading-none'

const CR  = 1_00_00_000
const LAC = 1_00_000
const K   = 1_000

function compact(abs: number): [string, string] {
  if (abs >= CR)  return [String(parseFloat((abs / CR).toFixed(2))),  'Cr']
  if (abs >= LAC) return [String(parseFloat((abs / LAC).toFixed(2))), 'L']
  if (abs >= K)   return [String(parseFloat((abs / K).toFixed(2))),   'K']
  return [String(Math.round(abs)), '']
}

/** Hero/non-hero amount: absolute value + small unit. Color at call site carries direction. */
export function HeroAmt({ value }: { value: number }) {
  const [num, unit] = compact(Math.abs(value))
  return (
    <>
      {num}{unit && <span className={SMALL}>{unit}</span>}
    </>
  )
}

/** Non-hero amount: absolute value + small unit. */
export function AmtText({ value }: { value: number }) {
  const [num, unit] = compact(Math.abs(value))
  return (
    <>
      {num}{unit && <span className={SMALL}>{unit}</span>}
    </>
  )
}

/** Percentage with small % symbol. Color at call site carries direction. */
export function PctText({ value }: { value: number }) {
  return (
    <>
      {trimPct(Math.abs(value))}<span className={SMALL}>%</span>
    </>
  )
}
