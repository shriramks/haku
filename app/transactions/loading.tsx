export default function Loading() {
  return (
    <div>
      {/* Nav */}
      <div
        className="sticky top-0 z-10 border-b px-5 pb-3"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-[28px] font-bold">Transactions</h1>
          <div className="flex items-center gap-2">
            <div className="h-9 w-16 rounded-xl animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-8 w-8 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>
      </div>

      <div className="pt-4 space-y-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
        {[...Array(2)].map((_, g) => (
          <section key={g}>
            {/* Month header */}
            <div className="flex items-baseline justify-between px-5 mb-2">
              <div className="h-3 w-24 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
              <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
            {/* Txn rows */}
            <div className="divide-y" style={{ borderColor: 'var(--border-faint)' }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-start px-4 py-3.5 gap-3" style={{ minHeight: '56px' }}>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-[5px] animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="h-4 w-20 rounded animate-pulse mb-1" style={{ background: 'var(--bg-tertiary)' }} />
                    <div className="h-3 w-14 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
                  </div>
                  <div className="text-right flex-shrink-0 space-y-1">
                    <div className="h-3.5 w-12 rounded animate-pulse ml-auto" style={{ background: 'var(--bg-tertiary)' }} />
                    <div className="h-3 w-14 rounded animate-pulse ml-auto" style={{ background: 'var(--bg-tertiary)' }} />
                    <div className="h-2.5 w-16 rounded animate-pulse ml-auto" style={{ background: 'var(--bg-tertiary)' }} />
                  </div>
                  <div className="h-12 w-12 rounded-xl animate-pulse flex-shrink-0" style={{ background: 'var(--bg-tertiary)' }} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <BottomNavShell active="/transactions" />
    </div>
  )
}

function BottomNavShell({ active }: { active: string }) {
  const pill: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    borderRadius: 28,
    boxShadow: '0 8px 28px rgba(0,0,0,0.13), 0 2px 6px rgba(0,0,0,0.07)',
  }
  const tabs = [
    { href: '/allocation',   label: 'Allocation',   icon: <svg className="w-[25px] h-[25px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg> },
    { href: '/bands',        label: 'Bands',    icon: <svg className="w-[25px] h-[25px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg> },
    { href: '/transactions', label: 'Transactions', icon: <svg className="w-[25px] h-[25px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg> },
    { href: '/plan',         label: 'Plan',         icon: <svg className="w-[25px] h-[25px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg> },
  ]
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-2.5 px-3"
         style={{ paddingBottom: 'max(8px, calc(env(safe-area-inset-bottom, 0px) - 16px))', paddingTop: 8 }}>
      <div className="flex items-center justify-around flex-1 p-2" style={pill}>
        {tabs.map(({ href, label, icon }) => {
          const isActive = active === href
          return (
            <div key={href} className="flex flex-col items-center gap-1 px-3 py-2 rounded-2xl"
                 style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', background: isActive ? 'var(--border)' : 'transparent' }}>
              {icon}
              <span className="text-[10px] leading-none" style={{ fontWeight: isActive ? 600 : 500 }}>{label}</span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-center" style={{ ...pill, padding: '23px 18px' }}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} style={{ color: 'var(--text-primary)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
      </div>
    </div>
  )
}
