export default function Loading() {
  return (
    <div>
      {/* Nav */}
      <div
        className="sticky top-0 z-10 border-b px-4 pb-3"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-[28px] font-bold">Plan</h1>
          <div className="flex items-center gap-2">
            <div className="h-9 w-16 rounded-xl animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-8 w-8 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>
      </div>

      {/* Budget strip */}
      <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <div className="h-3 w-20 rounded animate-pulse mb-2" style={{ background: 'var(--bg-tertiary)' }} />
        <div className="h-8 w-32 rounded-lg animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
      </div>

      {/* Sector filter strip */}
      <div className="w-full px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-faint)' }}>
        <div className="h-4 w-28 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
        <div className="h-4 w-16 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
      </div>

      {/* Stock rows */}
      <div className="divide-y" style={{ borderColor: 'var(--border-faint)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="px-4 py-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="h-4 w-20 rounded animate-pulse mb-1" style={{ background: 'var(--bg-tertiary)' }} />
                <div className="h-3 w-16 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
              </div>
              <div className="h-5 w-14 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
            <div className="h-1.5 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        ))}
      </div>

      <BottomNavShell active="/plan" />
    </div>
  )
}

function BottomNavShell({ active }: { active: string }) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t"
      style={{
        background: 'var(--bg-nav)',
        borderColor: 'var(--border)',
        paddingBottom: 'max(4px, calc(env(safe-area-inset-bottom, 0px) - 20px))',
      }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        <NavItem href="/allocation" label="Allocation" active={active === '/allocation'}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
          </svg>
        </NavItem>
        <NavItem href="/bands" label="Buy Bands" active={active === '/bands'}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </NavItem>
        <div className="flex items-center justify-center w-14 h-14 rounded-full -mt-5 shadow-lg"
             style={{ background: 'var(--text-primary)' }}>
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="var(--bg-primary)" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <NavItem href="/transactions" label="Transactions" active={active === '/transactions'}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        </NavItem>
        <NavItem href="/plan" label="Plan" active={active === '/plan'}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </NavItem>
      </div>
    </div>
  )
}

function NavItem({ href, label, active, children }: {
  href: string; label: string; active: boolean; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl"
         style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
      {children}
      <span className="text-[11px] font-medium">{label}</span>
    </div>
  )
}
