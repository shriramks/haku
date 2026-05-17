export function DetailRow({ label, value, bold, muted, color, noRupee }: {
  label: string; value: string; bold?: boolean; muted?: boolean; color?: string; noRupee?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4" style={{ minHeight: 44 }}>
      <span className="text-body" style={{ color: 'var(--text-2)' }}>
        {label} {!noRupee && <span style={{ color: 'var(--text-faint)' }}>₹</span>}
      </span>
      <span className="tabnum" style={{
        fontSize: bold ? 17 : 15,
        fontWeight: bold ? 700 : 400,
        color: color ?? (muted ? 'var(--text-muted)' : 'var(--text-primary)'),
      }}>
        {value}
      </span>
    </div>
  )
}

export function CompRow({ k, v, faint, first: _first }: { k: string; v: string; faint?: boolean; first?: boolean }) {
  return (
    <div className="flex items-center justify-between" style={{ minHeight: faint ? 32 : 44 }}>
      <span style={{ fontSize: 13, color: faint ? 'var(--text-faint)' : 'var(--text-2)' }}>{k}</span>
      <span className="tabnum" style={{ fontSize: 13, color: faint ? 'var(--text-faint)' : 'var(--text-primary)', fontWeight: 400, textAlign: 'right' }}>{v}</span>
    </div>
  )
}

export function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-footnote" style={{ color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, paddingTop: 16, paddingBottom: 2 }}>
      {label}
    </p>
  )
}
