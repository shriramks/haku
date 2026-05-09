'use client'

export default function SheetHeader({
  title,
  left,
  right,
}: {
  title: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
}) {
  const has3Col = left !== undefined

  return (
    <div
      className="relative flex items-center px-5 pt-1 pb-3 border-b"
      style={{ borderColor: 'var(--border)', minHeight: 44 }}
    >
      {has3Col && <div style={{ width: 60 }}>{left}</div>}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="font-semibold text-headline text-center">{title}</div>
      </div>
      <div className="flex-1" />
      {right !== undefined && (
        <div style={{ width: 60, textAlign: 'right' }}>{right}</div>
      )}
    </div>
  )
}
