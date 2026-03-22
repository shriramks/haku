import type { BandSignal, GateSignal } from '@/lib/types'

const BAND_CONFIG: Record<BandSignal, { label: string; classes: string }> = {
  buy:     { label: 'Buy Zone',   classes: 'bg-positive/15 text-positive' },
  hold:    { label: 'Hold',       classes: 'bg-warning/15 text-warning' },
  trim:    { label: 'Trim',       classes: 'bg-negative/15 text-negative' },
  deep:    { label: 'Deep Value', classes: 'bg-warning/15 text-warning' },
  unknown: { label: '—',          classes: 'bg-white/10 text-white/40' },
}

const GATE_CONFIG: Record<GateSignal, { icon: string; classes: string }> = {
  pass:    { icon: '✅', classes: 'text-positive' },
  caution: { icon: '⚠️', classes: 'text-warning' },
  fail:    { icon: '❌', classes: 'text-negative' },
}

export function BandSignalBadge({ signal }: { signal: BandSignal }) {
  const cfg = BAND_CONFIG[signal]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-footnote font-semibold ${cfg.classes}`}>
      {cfg.label}
    </span>
  )
}

export function GateSignalIcon({ signal, compact }: { signal: GateSignal; compact?: boolean }) {
  const cfg = GATE_CONFIG[signal]
  if (compact) return <span className="text-base leading-none">{cfg.icon}</span>
  return <span className={`text-body font-medium ${cfg.classes}`}>{cfg.icon} {signal}</span>
}

export function TradeTypeBadge({ type }: { type: 'buy' | 'sell' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-footnote font-bold tabnum
      ${type === 'buy'
        ? 'bg-positive/15 text-positive'
        : 'bg-negative/15 text-negative'}`}>
      {type.toUpperCase()}
    </span>
  )
}

export function InvestableBadge({ investable }: { investable: boolean }) {
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-footnote font-bold tracking-wide
      ${investable
        ? 'bg-positive/15 text-positive'
        : 'bg-negative/15 text-negative'}`}>
      {investable ? 'INVESTABLE' : 'NOT INVESTABLE'}
    </span>
  )
}
