import { Num } from '@/components/Num'

// ── Plan figures (shared by the edit and add sheets) ─────────────────────────

export type Fig = { amount: number } | { pct: number }

/** Planned / Invested / Left / Plan total. `withWas` adds the before column (edit only; a row without `was` leaves it empty). `tone` colours an amount by sign; `gap` starts a new group. */
export function PlanFigures({ rows, withWas }: {
  withWas?: boolean
  rows: { label: string; was?: Fig; now: Fig; tone?: boolean; gap?: boolean }[]
}) {
  const cell = (f: Fig, color: string) => (
    <span className="text-body tabnum" style={{ color }}>
      {'amount' in f ? <Num amount={f.amount} align /> : <Num pct={f.pct} align />}
    </span>
  )
  const tone = (f: Fig) => 'amount' in f ? (f.amount < 0 ? 'var(--c-negative)' : 'var(--c-positive)') : (f.pct > 100 ? 'var(--c-negative)' : 'var(--text-primary)')
  return (
    <div className="px-5 pt-2 pb-2 grid items-baseline gap-y-2.5 gap-x-4"
         style={{ gridTemplateColumns: withWas ? '1fr 84px 84px' : '1fr 84px' }}>
      {withWas && (
        <>
          <span />
          <span className="label-field text-right">Was</span>
          <span className="label-field text-right">Now</span>
        </>
      )}
      {rows.map(r => (
        <div key={r.label} className="contents">
          {r.gap && <span style={{ gridColumn: '1 / -1', height: 6 }} />}
          <span className="text-body" style={{ color: 'var(--text-2)' }}>{r.label}</span>
          {withWas && (r.was ? cell(r.was, 'var(--text-muted)') : <span />)}
          {cell(r.now, r.tone ? tone(r.now) : 'var(--text-primary)')}
        </div>
      ))}
    </div>
  )
}
