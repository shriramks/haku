'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import AddTxnModal from './AddTxnModal'

const TABS = [
  { href: '/allocation',   label: 'Allocation',   Icon: AllocationIcon },
  { href: '/bands',        label: 'Bands',        Icon: BandsIcon      },
  { href: '/transactions', label: 'Transactions', Icon: TxnsIcon       },
  { href: '/plan',         label: 'Plan',         Icon: PlanIcon       },
] as const

const pillStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  borderRadius: 28,
  boxShadow: '0 8px 28px rgba(0,0,0,0.13), 0 2px 6px rgba(0,0,0,0.07)',
}

export default function BottomNav() {
  const path = usePathname()
  const [addOpen, setAddOpen] = useState(false)
  const [addSymbol, setAddSymbol] = useState<string | undefined>(undefined)
  const [onboarding, setOnboarding] = useState<string | null>(null)
  const [storedFY, setStoredFY] = useState<string | null>(null)

  useEffect(() => {
    function handleOpenAddTxn(e: Event) {
      const symbol = (e as CustomEvent).detail?.symbol as string | undefined
      setAddSymbol(symbol || undefined)
      setAddOpen(true)
    }
    document.addEventListener('open-add-txn', handleOpenAddTxn)
    return () => document.removeEventListener('open-add-txn', handleOpenAddTxn)
  }, [])

  useEffect(() => {
    setOnboarding(localStorage.getItem('haku_onboarding'))
    function syncOnboarding() { setOnboarding(localStorage.getItem('haku_onboarding')) }
    window.addEventListener('haku_onboarding', syncOnboarding)
    return () => window.removeEventListener('haku_onboarding', syncOnboarding)
  }, [])

  useEffect(() => {
    setStoredFY(localStorage.getItem('haku_fy'))
    function syncFY() { setStoredFY(localStorage.getItem('haku_fy')) }
    window.addEventListener('haku_fy_change', syncFY)
    return () => window.removeEventListener('haku_fy_change', syncFY)
  }, [])

  function tabHref(base: string) {
    return storedFY ? `${base}?fy=${encodeURIComponent(storedFY)}` : base
  }

  const pulsePlan  = onboarding === 'plan'
  const pulseBands = onboarding === 'bands'

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-2.5 px-3"
        style={{ paddingBottom: 'var(--nav-bottom-pad)', paddingTop: 8 }}>

        {/* Tabs pill */}
        <div className="flex items-center justify-around flex-1 p-2" style={pillStyle}>
          {TABS.map(({ href, label, Icon }) => {
            const active   = path === href || path.startsWith(href + '/')
            const showPulse = (href === '/bands' && pulseBands) || (href === '/plan' && pulsePlan)
            return (
              <Link key={href} href={tabHref(href)}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition-colors relative"
                style={{
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: active ? 'var(--border)' : 'transparent',
                }}>
                {showPulse && (
                  <span className="absolute whitespace-nowrap text-footnote font-semibold text-white px-2 py-0.5 rounded-md bg-accent"
                        style={{ bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', position: 'absolute' }}>
                    {href === '/bands' ? 'Generate buy bands →' : 'Set up your plan →'}
                  </span>
                )}
                <div className="relative">
                  <Icon className="w-[25px] h-[25px]" />
                  {showPulse && <PulseDot />}
                </div>
                <span className="text-[10px] font-medium leading-none"
                      style={{ fontWeight: active ? 600 : 500 }}>{label}</span>
              </Link>
            )
          })}
        </div>

        {/* Add pill */}
        <button
          onClick={() => { setAddSymbol(undefined); setAddOpen(true) }}
          className="flex items-center justify-center active:scale-95 transition-transform"
          style={{ ...pillStyle, padding: '23px 18px' }}>
          <PlusIcon className="w-[25px] h-[25px]" style={{ color: 'var(--text-primary)' }} />
        </button>

      </nav>

      {addOpen && <AddTxnModal onClose={() => { setAddOpen(false); setAddSymbol(undefined) }} initialSymbol={addSymbol} />}
    </>
  )
}

function PulseDot() {
  return (
    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 bg-accent" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 border border-black bg-accent" />
    </span>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────

function AllocationIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  )
}

function BandsIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}

function PlusIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function TxnsIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  )
}

function PlanIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}
