import Link from 'next/link'
import type { ReactNode } from 'react'

// The stock ticker text role, shared by every "stock overview" list row
// (Plan, Allocation, Bands). Centralized so a future type-scale pass only
// has to change one file — see docs/design.md §1 and agent.md's row history.
export function RowSymbol({ symbol, className }: { symbol: string; className?: string }) {
  return (
    <p
      className={`text-headline font-bold truncate${className ? ` ${className}` : ''}`}
      style={{ color: 'var(--text-primary)' }}
    >
      {symbol}
    </p>
  )
}

type RowShellBase = {
  dim?: boolean
  padding: 'compact' | 'roomy'
  accessory?: ReactNode
  children: ReactNode
}
type RowShellProps = RowShellBase & ({ href: string; onClick?: never } | { href?: never; onClick: () => void })

// Shared interactive shell for stock-overview list rows. Owns exactly the
// three things that drift when the type scale changes — the tap wrapper,
// the vertical padding preset, and dim/accessory handling — and nothing
// about each screen's internal column layout, which stays legitimately
// different (Plan: flex stack; Allocation: 3-col grid; Bands: flex + bar).
export function RowShell({ href, onClick, dim, padding, accessory, children }: RowShellProps) {
  const paddingClass = padding === 'roomy' ? 'pt-4 pb-3' : 'py-3.5'
  const inner = (
    <>
      <div className={`px-4 ${paddingClass}`}>{children}</div>
      {accessory}
    </>
  )
  const className = 'block w-full text-left tap-row'
  const style = { opacity: dim ? 0.35 : 1 }

  return href != null
    ? <Link href={href} className={className} style={style}>{inner}</Link>
    : <button onClick={onClick} className={className} style={style}>{inner}</button>
}
