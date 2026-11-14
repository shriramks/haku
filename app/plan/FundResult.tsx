import { schemeTypeLine, type MfSchemeResult } from '@/lib/mf-schemes'

/** One result row: the scheme's AMFI name and its class line. A fund already in the plan is dimmed, marked, and not tappable. */
export function FundResult({ scheme, inPlan, onPick }: { scheme: MfSchemeResult; inPlan: boolean; onPick: (s: MfSchemeResult) => void }) {
  return (
    <button type="button" disabled={inPlan} onClick={() => onPick(scheme)}
      className="block w-full px-3 py-2.5 text-left"
      style={{ background: 'var(--bg-tertiary)', color: inPlan ? 'var(--text-muted)' : 'var(--text-primary)', minHeight: 52, borderTop: '1px solid var(--border-faint)' }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-body font-semibold">{scheme.name}</p>
        {inPlan && <span className="text-footnote font-semibold flex-shrink-0" style={{ color: 'var(--text-muted)' }}>In plan</span>}
      </div>
      <p className="text-footnote mt-0.5" style={{ color: 'var(--text-faint)' }}>{schemeTypeLine(scheme)}</p>
    </button>
  )
}
