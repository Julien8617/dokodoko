import { useMemo, useState } from 'react'

export interface SearchSelectOption {
  value: string
  label: string
}

interface SearchSelectProps {
  options: SearchSelectOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder: string
}

// Sélecteur avec filtrage incrémental, sans focus automatique (repris de la
// logique de recherche v1, §6.2) — utilisé pour référence et emplacement
// tant que l'écran Recherche dédié n'existe pas.
export default function SearchSelect({ options, value, onChange, placeholder }: SearchSelectProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    )
  }, [options, query])

  const selected = options.find((o) => o.value === value)

  return (
    <div className="search-select">
      <input
        type="text"
        value={open ? query : (selected?.label ?? '')}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="search-select-list">
          {filtered.map((o) => (
            <li key={o.value}>
              <button type="button" onMouseDown={() => { onChange(o.value); setOpen(false) }}>
                {o.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="search-select-empty">—</li>}
        </ul>
      )}
    </div>
  )
}
