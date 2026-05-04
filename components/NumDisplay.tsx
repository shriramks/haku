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

/** Hero amount: small ₹ prefix + number + small unit. Use showSign for gain/loss contexts. */
export function HeroAmt({ value, showSign }: { value: number; showSign?: boolean }) {
  const abs = Math.abs(value)
  const [num, unit] = compact(abs)
  const prefix = showSign
    ? (value >= 0 ? '+ ' : '− ')
    : (value < 0  ? '− ' : '')
  return (
    <>
      {prefix}<span className={SMALL}>₹</span>{num}{unit && <span className={SMALL}>{unit}</span>}
    </>
  )
}

/** Non-hero amount: number + small unit, no ₹. */
export function AmtText({ value }: { value: number }) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '− ' : ''
  const [num, unit] = compact(abs)
  return (
    <>
      {sign}{num}{unit && <span className={SMALL}>{unit}</span>}
    </>
  )
}

/** Percentage with small % symbol. Use showSign for gain/XIRR contexts. */
export function PctText({ value, showSign }: { value: number; showSign?: boolean }) {
  const abs = Math.abs(value)
  const prefix = showSign
    ? (value >= 0 ? '+ ' : '− ')
    : (value < 0  ? '− ' : '')
  return (
    <>
      {prefix}{trimPct(abs)}<span className={SMALL}>%</span>
    </>
  )
}
