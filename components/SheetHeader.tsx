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
      className="flex items-center justify-between px-5 pt-1 pb-3 border-b"
      style={{ borderColor: 'var(--border)' }}
    >
      {has3Col && <div style={{ width: 60 }}>{left}</div>}
      <div className="font-semibold text-headline text-center">{title}</div>
      {right !== undefined && (
        <div style={{ width: 60, textAlign: 'right' }}>{right}</div>
      )}
    </div>
  )
}
