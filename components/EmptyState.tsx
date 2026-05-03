export default function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>{children}</p>
  )
}
