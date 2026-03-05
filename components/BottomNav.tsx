'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import AddTxnModal from './AddTxnModal'

const LEFT_TABS = [
  { href: '/dashboard', label: 'Portfolio', Icon: PortfolioIcon },
  { href: '/txns',      label: 'Txns',      Icon: TxnsIcon      },
] as const

const RIGHT_TABS = [
  { href: '/bands',    label: 'Bands', Icon: BandsIcon    },
  { href: '/settings', label: 'More',  Icon: SettingsIcon },
] as const

export default function BottomNav() {
  const path = usePathname()
  const [addOpen, setAddOpen] = useState(false)

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/90 backdrop-blur-xl border-t border-white/10"
           style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">

          {LEFT_TABS.map(({ href, label, Icon }) => {
            const active = path === href || path.startsWith(href + '/')
            return (
              <Link key={href} href={href}
                className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors
                  ${active ? 'text-white' : 'text-white/40'}`}>
                <Icon className="w-6 h-6" />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            )
          })}

          {/* Centre add button */}
          <button onClick={() => setAddOpen(true)}
            className="flex items-center justify-center w-14 h-14 rounded-full bg-white -mt-5
                       shadow-lg shadow-white/10 active:scale-95 transition-transform">
            <PlusIcon className="w-7 h-7 text-black" />
          </button>

          {RIGHT_TABS.map(({ href, label, Icon }) => {
            const active = path === href || path.startsWith(href + '/')
            return (
              <Link key={href} href={href}
                className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors
                  ${active ? 'text-white' : 'text-white/40'}`}>
                <Icon className="w-6 h-6" />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            )
          })}

        </div>
      </nav>

      {addOpen && <AddTxnModal onClose={() => setAddOpen(false)} />}
    </>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────

function PortfolioIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function TxnsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function BandsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  )
}
