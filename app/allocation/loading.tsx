import BottomNav from '@/components/BottomNav'

export default function Loading() {
  return (
    <div className="pb-4">
      {/* Nav */}
      <div
        className="sticky top-0 z-10 border-b px-4 pb-3"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-[28px] font-bold">Allocation</h1>
          <div className="flex items-center gap-2">
            <div className="h-9 w-16 rounded-xl animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-8 w-8 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="text-center">
              <div className="h-7 w-12 mx-auto rounded-lg animate-pulse mb-1" style={{ background: 'var(--bg-tertiary)' }} />
              <div className="h-3 w-10 mx-auto rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
          ))}
        </div>
        <div className="h-1.5 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
      </div>

      {/* Rows */}
      <div className="mt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
            <div style={{ minWidth: '108px' }}>
              <div className="h-4 w-20 rounded animate-pulse mb-1" style={{ background: 'var(--bg-tertiary)' }} />
              <div className="h-3 w-14 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
            <div className="flex-1">
              <div className="h-1.5 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
            <div className="h-4 w-14 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  )
}
