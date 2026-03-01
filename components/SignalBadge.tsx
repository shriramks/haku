import type { BandSignal, GateSignal } from '@/lib/types'

const BAND_CONFIG: Record<BandSignal, { label: string; classes: string }> = {
  buy:     { label: 'Buy Zone', classes: 'bg-green-500/15 text-green-400' },
  hold:    { label: 'Hold',     classes: 'bg-orange-500/15 text-orange-400' },
  trim:    { label: 'Trim',     classes: 'bg-red-500/15 text-red-400' },
  deep:    { label: 'Deep Value', classes: 'bg-orange-500/15 text-orange-400' },
  unknown: { label: '—',        classes: 'bg-white/10 text-white/40' },
}

const GATE_CONFIG: Record<GateSignal, { icon: string; classes: string }> = {
  pass:    { icon: '✅', classes: 'text-green-400' },
  caution: { icon: '⚠️', classes: 'text-orange-400' },
  fail:    { icon: '❌', classes: 'text-red-400' },
}

export function BandSignalBadge({ signal }: { signal: BandSignal }) {
  const cfg = BAND_CONFIG[signal]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.classes}`}>
      {cfg.label}
    </span>
  )
}

export function GateSignalIcon({ signal, compact }: { signal: GateSignal; compact?: boolean }) {
  const cfg = GATE_CONFIG[signal]
  if (compact) return <span className="text-base leading-none">{cfg.icon}</span>
  return <span className={`text-sm font-medium ${cfg.classes}`}>{cfg.icon} {signal}</span>
}

export function TradeTypeBadge({ type }: { type: 'buy' | 'sell' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold tabnum
      ${type === 'buy'
        ? 'bg-green-500/15 text-green-400'
        : 'bg-red-500/15 text-red-400'}`}>
      {type.toUpperCase()}
    </span>
  )
}

export function InvestableBadge({ investable }: { investable: boolean }) {
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold tracking-wide
      ${investable
        ? 'bg-green-500/15 text-green-400'
        : 'bg-red-500/15 text-red-400'}`}>
      {investable ? 'INVESTABLE' : 'NOT INVESTABLE'}
    </span>
  )
}
