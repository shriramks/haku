import BottomNav from '@/components/BottomNav'

export default function Loading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b flex items-center px-2"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border-faint)', paddingTop: 'max(env(safe-area-inset-top,0px), 14px)', paddingBottom: 12 }}>
        <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
          <svg width="11" height="19" viewBox="0 0 11 19" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 1.5L1.5 9.5L9 17.5" />
          </svg>
        </div>
        <h1 className="text-display font-bold flex-1 pl-1">Portfolio</h1>
        <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
          <div className="w-5 h-5 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid px-4 py-3 border-b"
           style={{ gridTemplateColumns: '1fr 1fr auto', gap: '0', borderColor: 'var(--border-faint)' }}>
        <div className="flex flex-col gap-3">
          <div>
            <div className="h-3 w-20 rounded animate-pulse mb-1.5" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-7 w-28 rounded-lg animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
          <div>
            <div className="h-3 w-10 rounded animate-pulse mb-1.5" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-7 w-20 rounded-lg animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>
        <div className="flex flex-col gap-3 border-l pl-4" style={{ borderColor: 'var(--border-faint)', marginLeft: 14 }}>
          <div>
            <div className="h-3 w-16 rounded animate-pulse mb-1.5" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-7 w-24 rounded-lg animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
          <div>
            <div className="h-3 w-16 rounded animate-pulse mb-1.5" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-7 w-16 rounded-lg animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>
        {/* Pie chart placeholder */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
          <div className="w-[104px] h-[104px] rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="flex flex-col gap-0.5 w-full">
            {[40, 32, 24].map((w, i) => (
              <div key={i} className="h-3 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)', width: w }} />
            ))}
          </div>
        </div>
      </div>

      {/* Section headers */}
      <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
        {['Stocks', 'MF', 'SGB', 'PPF'].map(label => (
          <div key={label}
               className="flex items-center w-full px-4 border-t"
               style={{ minHeight: 52, background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border-faint)' }}>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-headline font-bold" style={{ color: 'var(--text-primary)' }}>{label}</span>
            </div>
            <div className="h-4 w-24 rounded animate-pulse mr-2" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        ))}

        {/* Add button */}
        <div className="px-4 mt-3">
          <div className="w-full rounded-xl animate-pulse" style={{ minHeight: 48, background: 'var(--bg-tertiary)' }} />
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
