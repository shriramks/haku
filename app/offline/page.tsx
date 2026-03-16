export default function OfflinePage() {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <p style={{ fontSize: 48 }}>📡</p>
      <p className="text-xl font-semibold">You&apos;re offline</p>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Check your connection and try again.
      </p>
    </div>
  )
}
