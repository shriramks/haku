import BottomNav from '@/components/BottomNav'

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

      <BottomNav />
    </div>
  )
}
