import BottomNav from '@/components/BottomNav'

export default function Loading() {
  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Nav */}
        <div
          className="sticky top-0 z-10 border-b px-4 pb-3"
          style={{
            background: 'var(--bg-nav)',
            borderColor: 'var(--border)',
            paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
          }}>
          <div className="flex items-center justify-between pt-1">
            <h1 className="text-[28px] font-bold">Buy Bands</h1>
            <div className="flex items-center gap-2">
              <div className="h-9 w-16 rounded-xl animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
              <div className="h-8 w-8 rounded-full animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
            </div>
          </div>
        </div>

        {/* Band rows */}
        <div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="h-5 w-24 rounded animate-pulse mb-1.5" style={{ background: 'var(--bg-tertiary)' }} />
                  <div className="h-3 w-16 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
                </div>
                <div className="h-6 w-16 rounded-lg animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
              </div>
              <div className="h-3 w-full rounded animate-pulse mb-2" style={{ background: 'var(--bg-tertiary)' }} />
              <div className="flex justify-between">
                <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
                <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
                <div className="h-3 w-12 rounded animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </>
  )
}
