export function Divider({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{ height: 1, background: 'var(--border-faint)', ...style }}
    />
  );
}
