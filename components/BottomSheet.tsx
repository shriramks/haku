'use client'

export default function BottomSheet({
  children,
  onClose,
  zIndex = 200,
  className = '',
}: {
  children: React.ReactNode
  onClose: () => void
  zIndex?: number
  className?: string
}) {
  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        style={{ zIndex }}
        onClick={onClose}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 rounded-t-3xl animate-slide-up ${className}`}
        style={{
          zIndex,
          background: 'var(--bg-secondary)',
          paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)',
        }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        {children}
      </div>
    </>
  )
}
