import { useState } from 'react'

interface ComboInputProps {
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  placeholder?: string
  disabled?: boolean
}

// Zone de texte libre avec suggestions déroulantes. Contrairement à
// SearchSelect, la valeur affichée EST le texte tapé : rien n'oblige à
// choisir dans la liste — un code absent des suggestions reste saisissable
// et validé tel quel (Inventaire, saisie libre en marchant, 2026-09-14 :
// "pas de hint ou chercher" pour les casiers à visiter, mais l'utilisateur
// a ensuite demandé une aide anti-faute de frappe sur le champ casier lui-
// même — ceci reste une aide, pas une liste fermée).
export default function ComboInput({ value, onChange, suggestions, placeholder, disabled }: ComboInputProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="search-select">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && suggestions.length > 0 && (
        <ul className="search-select-list">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(s)
                  setOpen(false)
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
