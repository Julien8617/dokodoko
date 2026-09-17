import { useState } from 'react'

export interface ComboSuggestion {
  value: string
  label: string
}

interface ComboInputProps {
  value: string
  onChange: (value: string) => void
  onSelect?: (value: string) => void
  onBlur?: () => void
  suggestions: ComboSuggestion[]
  placeholder?: string
  disabled?: boolean
  // Sélectionne tout le texte au focus au lieu de placer juste le curseur —
  // opt-in (défaut inchangé) pour ne pas modifier le comportement des
  // appelants existants. Sert le champ casier de la marche (spec 2.25,
  // §6.5) : un appui involontaire ne doit rien effacer, mais retaper doit
  // remplacer d'un coup, utile à une main sur un casier qui vient de
  // changer via les flèches de navigation.
  selectOnFocus?: boolean
}

// Zone de texte libre avec suggestions déroulantes. Contrairement à
// SearchSelect, la valeur affichée EST le texte tapé : rien n'oblige à
// choisir dans la liste — un code absent des suggestions reste saisissable
// et validé tel quel (Inventaire, saisie libre en marchant, 2026-09-14 :
// "pas de hint ou chercher" pour les casiers à visiter, mais l'utilisateur
// a ensuite demandé une aide anti-faute de frappe — ceci reste une aide,
// jamais une liste fermée).
export default function ComboInput({
  value,
  onChange,
  onSelect,
  onBlur,
  suggestions,
  placeholder,
  disabled,
  selectOnFocus,
}: ComboInputProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="search-select">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => {
          setOpen(true)
          if (selectOnFocus) e.target.select()
        }}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onBlur={() => {
          onBlur?.()
          setTimeout(() => setOpen(false), 150)
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="search-select-list">
          {suggestions.map((s) => (
            <li key={s.value}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(s.value)
                  onSelect?.(s.value)
                  setOpen(false)
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
