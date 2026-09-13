import type { MouseEvent, TouchEvent } from 'react'

interface CountStepperProps {
  value: string // '' = jamais saisi — distinct de 0 (brief Inventaire §3)
  onChange: (next: string) => void
  onBlur?: () => void
}

// Contrairement au stepper de Mouvement, un champ vide est un état à part :
// "−" depuis vide pose 0 (confirmation explicite qu'il n'y en a plus),
// "+" depuis vide pose 1. preventDefault sur mousedown/touchstart évite que
// le bouton vole le focus et ferme le clavier virtuel iOS.
export default function CountStepper({ value, onChange, onBlur }: CountStepperProps) {
  const keepFocus = (e: MouseEvent | TouchEvent) => e.preventDefault()
  const n = value === '' ? null : Number(value)

  function dec() {
    if (n === null) {
      onChange('0')
      return
    }
    onChange(String(Math.max(0, n - 1)))
  }

  function inc() {
    onChange(String((n ?? 0) + 1))
  }

  return (
    <div className="number-stepper">
      <button type="button" onMouseDown={keepFocus} onTouchStart={keepFocus} onClick={dec}>
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        onBlur={onBlur}
      />
      <button type="button" onMouseDown={keepFocus} onTouchStart={keepFocus} onClick={inc}>
        +
      </button>
    </div>
  )
}
