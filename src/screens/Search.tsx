import { useEffect, useState, type FormEvent } from 'react'
import { useI18n, interpolate } from '../i18n'
import { extractErrorMessage } from '../lib/errors'
import {
  listConditionnements,
  listEmplacements,
  listReferences,
  listStockAtEmplacement,
  listStockByReference,
  matchEmplacements,
  matchReferences,
  parseEmplacementCode,
  resolveEmplacementInput,
} from '../lib/db'
import type { Reference } from '../lib/types'
import ComboInput from '../components/ComboInput'

type Mode = 'reference' | 'emplacement'

interface ResultLine {
  key: string
  primary: string
  secondary: string | null
  cartons: number
  pieces: number
  totalPieces: number
}

// Écran Recherche : "où se trouve REU003 ?" / "qu'y a-t-il dans A-05-1 ?".
// Stock COURANT (vue `stock`, jamais figé) — contrairement à l'Inventaire
// qui compare à un instant T, ici on veut toujours la situation actuelle.
export default function Search({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('reference')
  const [query, setQuery] = useState('')
  const [allReferences, setAllReferences] = useState<Reference[]>([])
  const [knownEmplacements, setKnownEmplacements] = useState<string[]>([])
  const [results, setResults] = useState<ResultLine[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Identité de la référence trouvée, affichée en tête des résultats — sans
  // elle, une recherche par nom (§6.2) ne laisse plus voir le libellé une
  // fois la recherche lancée : la liste ci-dessous ne montre que casier et
  // conditionnement, jamais la référence elle-même en toutes lettres.
  const [searchedReference, setSearchedReference] = useState<Reference | null>(null)

  useEffect(() => {
    listReferences().then(setAllReferences).catch(() => {})
    listEmplacements()
      .then((list) => setKnownEmplacements(list.map((e) => e.code)))
      .catch(() => {})
  }, [])

  function switchMode(next: Mode) {
    setMode(next)
    setQuery('')
    setResults([])
    setSearched(false)
    setError(null)
    setSearchedReference(null)
  }

  const resolvedEmplacement = mode === 'emplacement' ? resolveEmplacementInput(query) : null
  // Pas de plafond dans matchReferences elle-même (chaque appelant décide,
  // voir db.ts) : ici un plafond d'affichage reste utile sur un écran de
  // téléphone, mais jamais silencieux — §6.2, spec 2.22 : un plafond muet
  // ferait conclure qu'un article n'existe pas alors qu'il est le neuvième.
  const referenceMatches =
    mode === 'reference'
      ? matchReferences(query, allReferences).filter((r) => r.code.toUpperCase() !== query.trim().toUpperCase())
      : []
  const REFERENCE_SUGGESTIONS_SHOWN = 8
  const suggestions =
    mode === 'reference'
      ? referenceMatches.slice(0, REFERENCE_SUGGESTIONS_SHOWN).map((r) => ({
          value: r.code,
          label: r.libelle ? `${r.code} — ${r.libelle}` : r.code,
        }))
      : (resolvedEmplacement
          ? resolvedEmplacement === query.trim().toUpperCase()
            ? []
            : [resolvedEmplacement]
          : matchEmplacements(query, knownEmplacements)
        ).map((code) => ({ value: code, label: code }))

  async function searchByReference(code: string) {
    // `code` vient toujours de `matches[0].code`, résolu depuis
    // `allReferences` — ne peut pas manquer, pas de repli fabriqué.
    setSearchedReference(allReferences.find((r) => r.code === code) ?? null)
    const conditionnements = await listConditionnements(code)
    const condById = new Map(conditionnements.map((c) => [c.id, c]))
    const rows = await listStockByReference(code)
    setResults(
      rows
        .map((row) => {
          const cond = condById.get(row.conditionnement_id)
          const ppc = cond?.pieces_par_carton ?? 1
          return {
            key: `${row.emplacement_code}|${row.conditionnement_id}`,
            primary: row.emplacement_code,
            secondary: cond?.libelle_court ?? null,
            cartons: Math.floor(row.quantite_pieces / ppc),
            pieces: row.quantite_pieces % ppc,
            totalPieces: row.quantite_pieces,
          }
        })
        .sort((a, b) => a.primary.localeCompare(b.primary)),
    )
  }

  async function searchByEmplacement(empl: string) {
    setSearchedReference(null)
    const rows = await listStockAtEmplacement(empl)
    // Un round-trip par référence distincte, en parallèle — pas un par ligne
    // de stock : un casier avec 8 réfs ne doit pas enchaîner 8 requêtes
    // séquentielles sur un réseau mobile.
    const refCodes = [...new Set(rows.map((row) => row.ref_code))]
    const condById = new Map(
      (await Promise.all(refCodes.map((code) => listConditionnements(code)))).flat().map((c) => [c.id, c]),
    )
    // Plusieurs références différentes peuvent apparaître dans un même
    // casier — le libellé propre à CHAQUE référence doit donc figurer sur
    // sa ligne (§6.2), pas seulement le libellé du conditionnement
    // (ex. "carton de 12", qui décrit l'emballage, pas l'article).
    const refByCode = new Map(allReferences.map((r) => [r.code, r]))
    setResults(
      rows
        .map((row) => {
          const cond = condById.get(row.conditionnement_id)
          const ppc = cond?.pieces_par_carton ?? 1
          const libelle = refByCode.get(row.ref_code)?.libelle
          return {
            key: `${row.ref_code}|${row.conditionnement_id}`,
            primary: row.ref_code,
            secondary: [libelle, cond?.libelle_court].filter(Boolean).join(' — ') || null,
            cartons: Math.floor(row.quantite_pieces / ppc),
            pieces: row.quantite_pieces % ppc,
            totalPieces: row.quantite_pieces,
          }
        })
        .sort((a, b) => a.primary.localeCompare(b.primary)),
    )
  }

  async function runSearch(raw: string) {
    const value = raw.trim().toUpperCase()
    if (!value) return
    setError(null)

    if (mode === 'reference') {
      // La recherche floue accepte "65"/"265" pour trouver "REU265" (mode
      // Inventaire), mais lancer la recherche exige de trancher : un code
      // exact prime, sinon un unique résultat flou suffit — au-delà, on
      // laisse choisir dans la liste plutôt que de deviner.
      const exact = allReferences.find((r) => r.code.toUpperCase() === value)
      const matches = exact ? [exact] : matchReferences(value, allReferences)
      if (matches.length !== 1) {
        setSearched(false)
        setResults([])
        setError(t.search.pickSuggestion)
        return
      }
      setLoading(true)
      setSearched(true)
      try {
        await searchByReference(matches[0].code)
      } catch (err) {
        setError(extractErrorMessage(err, t.common.unknownError))
      } finally {
        setLoading(false)
      }
      return
    }

    const empl = parseEmplacementCode(value) ? value : (resolveEmplacementInput(value) ?? value)
    if (!parseEmplacementCode(empl)) {
      setSearched(false)
      setResults([])
      setError(t.search.invalidEmplacement)
      return
    }
    setLoading(true)
    setSearched(true)
    try {
      await searchByEmplacement(empl)
    } catch (err) {
      setError(extractErrorMessage(err, t.common.unknownError))
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    runSearch(query)
  }

  return (
    <main className="movement">
      <button className="back-link" onClick={onBack}>
        ← {t.search.back}
      </button>
      <h1>{t.search.title}</h1>

      <div className="sens-picker">
        <button
          type="button"
          className={mode === 'reference' ? 'active' : ''}
          onClick={() => switchMode('reference')}
        >
          {t.search.modeReference}
        </button>
        <button
          type="button"
          className={mode === 'emplacement' ? 'active' : ''}
          onClick={() => switchMode('emplacement')}
        >
          {t.search.modeEmplacement}
        </button>
      </div>

      <form className="settings-form" onSubmit={handleSubmit}>
        <label className="field-label">
          {mode === 'reference' ? t.inventory.reference : t.inventory.casier}
          <ComboInput
            value={query}
            onChange={setQuery}
            onSelect={runSearch}
            suggestions={suggestions}
            placeholder={mode === 'reference' ? t.inventory.referencePlaceholder : t.inventory.casierPlaceholder}
          />
        </label>
        {mode === 'reference' && referenceMatches.length > REFERENCE_SUGGESTIONS_SHOWN && (
          <p className="form-status">
            {interpolate(t.search.moreMatches, {
              shown: REFERENCE_SUGGESTIONS_SHOWN,
              total: referenceMatches.length,
            })}
          </p>
        )}
        <button type="submit" disabled={loading}>
          {t.search.searchButton}
        </button>
        {error && <p className="form-status form-error">{error}</p>}
      </form>

      {loading && <p className="form-status">{t.search.loading}</p>}

      {mode === 'reference' && searchedReference && searched && !error && (
        <h2>
          {searchedReference.code}
          {searchedReference.libelle ? ` — ${searchedReference.libelle}` : ''}
        </h2>
      )}

      {!loading && searched && !error && results.length === 0 && (
        <p className="form-status">{t.search.noResults}</p>
      )}

      {results.length > 0 && (
        <ul className="casier-list">
          {results.map((r) => (
            <li key={r.key}>
              <div className="casier-row">
                <span>
                  {r.primary}
                  {r.secondary ? ` — ${r.secondary}` : ''}
                </span>
                <span className="casier-status">
                  {r.cartons}c + {r.pieces}p ({r.totalPieces})
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
