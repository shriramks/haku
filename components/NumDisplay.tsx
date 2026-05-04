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

function signPrefix(value: number, showSign?: boolean): string {
  if (showSign) return value >= 0 ? '+ ' : '− '
  return value < 0 ? '− ' : ''
}

/** Hero/non-hero amount: number + small unit. Use showSign for gain/loss contexts. */
export function HeroAmt({ value, showSign }: { value: number; showSign?: boolean }) {
  const abs = Math.abs(value)
  const [num, unit] = compact(abs)
  return (
    <>
      {signPrefix(value, showSign)}{num}{unit && <span className={SMALL}>{unit}</span>}
    </>
  )
}

/** Non-hero amount: number + small unit. */
export function AmtText({ value }: { value: number }) {
  const abs = Math.abs(value)
  const [num, unit] = compact(abs)
  return (
    <>
      {signPrefix(value)}{num}{unit && <span className={SMALL}>{unit}</span>}
    </>
  )
}

/** Percentage with small % symbol. Use showSign for gain/XIRR contexts. */
export function PctText({ value, showSign }: { value: number; showSign?: boolean }) {
  const abs = Math.abs(value)
  return (
    <>
      {signPrefix(value, showSign)}{trimPct(abs)}<span className={SMALL}>%</span>
    </>
  )
}
