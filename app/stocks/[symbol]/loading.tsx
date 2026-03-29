import BottomNav from '@/components/BottomNav'

export default function Loading() {
  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Back nav */}
        <div
          className="sticky top-0 z-10 border-b px-4 pb-3"
          style={{
            background: 'var(--bg-nav)',
            borderColor: 'var(--border)',
            paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
          }}>
          <div className="flex items-center justify-between pt-1">
            <a href="/allocation" className="flex items-center gap-1 text-[17px]" style={{ color: '#0A84FF' }}>
              <svg className="w-[25px] h-[25px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Allocation
            </a>
            <div className="h-8 w-8 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>

        {/* Symbol + name */}
        <div className="px-4 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <div className="h-7 w-32 rounded-lg animate-pulse mb-2" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="h-4 w-24 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
        </div>

        {/* Metrics row */}
        <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <div className="grid grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i}>
                <div className="h-6 w-16 rounded animate-pulse mb-1" style={{ background: 'var(--bg-tertiary)' }} />
                <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
              </div>
            ))}
          </div>
        </div>

        {/* Buy zone bar */}
        <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <div className="h-3 w-20 rounded animate-pulse mb-3" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="h-4 w-full rounded animate-pulse mb-2" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="flex justify-between">
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>

        {/* Tranches */}
        <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <div className="h-3 w-16 rounded animate-pulse mb-3" style={{ background: 'var(--bg-tertiary)' }} />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex justify-between mb-3">
              <div className="h-3 w-16 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
              <div className="h-3 w-20 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </>
  )
}
