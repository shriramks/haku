export function ProgressBar({
  percent,
  color = 'var(--c-positive)',
  height = 8,
  className,
}: {
  percent: number;
  color?: string;
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={`rounded-full overflow-hidden${className ? ` ${className}` : ''}`}
      style={{ height, background: 'var(--border-faint)' }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${percent}%`, background: color }}
      />
    </div>
  );
}
