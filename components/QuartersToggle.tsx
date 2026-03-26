// Bear / Normal / Bull quarter toggle — shared between Bands list and Stock detail.

interface Props {
  twoWeakQuarters: boolean
  twoStrongQuarters: boolean
  onChange: (field: 'two_weak_quarters' | 'two_strong_quarters', value: boolean) => void
}

export default function QuartersToggle({ twoWeakQuarters, twoStrongQuarters, onChange }: Props) {
  const mode = twoWeakQuarters ? 'bear' : twoStrongQuarters ? 'bull' : 'normal'

  function handleClick(m: 'bear' | 'normal' | 'bull') {
    if (m === mode) return
    if (m === 'bear')        onChange('two_weak_quarters', true)
    else if (m === 'bull')   onChange('two_strong_quarters', true)
    else if (twoWeakQuarters)   onChange('two_weak_quarters', false)
    else                        onChange('two_strong_quarters', false)
  }

  return (
    <div className="flex flex-1 rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
      {(['bear', 'normal', 'bull'] as const).map(m => (
        <button key={m} type="button" onClick={() => handleClick(m)}
          className="flex-1 px-2.5 py-2.5 text-subheadline font-medium capitalize transition-colors text-center"
          style={mode === m
            ? m === 'bear'   ? { background: 'rgba(255,159,10,0.15)', color: '#FF9500', fontWeight: 600 }
            : m === 'bull'   ? { background: 'rgba(52,199,89,0.15)',  color: '#34C759', fontWeight: 600 }
            :                  { background: 'var(--bg-tertiary)',     color: 'var(--text-primary)', fontWeight: 600 }
            : { background: 'transparent', color: 'var(--text-faint)' }}>
          {m === 'bear' ? 'Bear' : m === 'normal' ? 'Normal' : 'Bull'}
        </button>
      ))}
    </div>
  )
}
