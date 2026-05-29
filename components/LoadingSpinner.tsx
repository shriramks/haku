export function LoadingSpinner() {
  return (
    <div
      className="w-6 h-6 border-2 rounded-full animate-spin"
      style={{ borderColor: 'var(--border)', borderTopColor: 'var(--text-primary)' }}
    />
  );
}
