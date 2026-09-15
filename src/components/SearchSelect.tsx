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
  // Remplace le filtre par défaut (sous-chaîne sur value+label) quand un
  // appelant a besoin d'une recherche plus riche — ex. matchReferences
  // (§6.2 : jetons, normalisation, ordre code puis libellé), partagée avec
  // la Recherche et l'Inventaire plutôt que réimplémentée ici.
  filter?: (query: string, options: SearchSelectOption[]) => SearchSelectOption[]
}

// Sélecteur avec filtrage incrémental, sans focus automatique (repris de la
// logique de recherche v1, §6.2) — utilisé pour référence et emplacement
// tant que l'écran Recherche dédié n'existe pas.
export default function SearchSelect({ options, value, onChange, placeholder, filter }: SearchSelectProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return options
    if (filter) return filter(q, options)
    const lower = q.toLowerCase()
    return options.filter(
      (o) => o.value.toLowerCase().includes(lower) || o.label.toLowerCase().includes(lower),
    )
  }, [options, query, filter])

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
