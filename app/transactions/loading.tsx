import BottomNav from '@/components/BottomNav'

export default function Loading() {
  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto' }}>
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

        <div className="pt-4 space-y-5">
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
      </div>

      <BottomNav />
    </>
  )
}
