import { useEffect, useState, type FormEvent } from 'react'
import { useI18n, interpolate } from '../i18n'
import { supabase } from '../lib/supabase'
import {
  ensureEmplacement,
  listClients,
  listConditionnements,
  listEmplacements,
  listReferences,
  matchEmplacements,
  matchReferences,
  parseEmplacementCode,
  resolveEmplacementInput,
} from '../lib/db'
import {
  createInventaire,
  deleteCasierLigne,
  getActiveInventaire,
  getInventaireSynthese,
  getOrCreateCasier,
  markCasierVisite,
  saveCasierLigne,
  type SyntheseReference,
} from '../lib/inventaireDb'
import type { Client, Conditionnement, Inventaire, Reference, ScopeKind } from '../lib/types'
import SearchSelect from '../components/SearchSelect'
import ComboInput from '../components/ComboInput'
import CountStepper from '../components/CountStepper'

type Phase = 'launch' | 'walk' | 'ecarts'

// Module Inventaire v2 (brief 2026-09-14, révisé le même jour après retour
// terrain) : une palette déplacée sans le signaler ne peut jamais apparaître
// dans une liste de casiers "attendus" construite depuis le théorique — elle
// se trouve forcément à un endroit que cette liste ne prévoyait pas. D'où
// l'abandon d'une liste à cocher au profit d'une saisie libre en marchant
// (emplacement + référence + quantité, sans liste ni suggestion) : l'écart
// se découvre à la comparaison finale, pas en amont. Le traitement des
// écarts (recompter/corriger/justifier) et la clôture restent hors phase 1.
export default function Inventory({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('launch')
  const [inventaire, setInventaire] = useState<Inventaire | null>(null)
  const [auteur, setAuteur] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuteur(data.session?.user.email ?? null))
  }, [])

  function handleReady(inv: Inventaire) {
    setInventaire(inv)
    setPhase('walk')
  }

  if (phase === 'launch' || !inventaire) {
    return <Launch onBack={onBack} onReady={handleReady} />
  }

  if (phase === 'ecarts') {
    return <Ecarts inventaire={inventaire} onBack={() => setPhase('walk')} />
  }

  return <Walk inventaire={inventaire} auteur={auteur} onDone={() => setPhase('ecarts')} onBack={onBack} />
}

// ---------------------------------------------------------------------
// Écran 1 — lancement / reprise
// ---------------------------------------------------------------------

function scopeLabel(
  inv: Inventaire,
  clients: Client[],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (inv.scope_kind === 'tout') return t.inventory.scopeTout
  if (inv.scope_kind === 'client') {
    return clients.find((c) => c.code === inv.scope_client_code)?.nom ?? inv.scope_client_code ?? ''
  }
  return t.inventory.scopeReferences
}

function Launch({ onBack, onReady }: { onBack: () => void; onReady: (inv: Inventaire) => void }) {
  const { t } = useI18n()
  const [auteur, setAuteur] = useState<string | null>(null)
  const [active, setActive] = useState<Inventaire | null | 'loading'>('loading')
  const [clients, setClients] = useState<Client[]>([])
  const [mode, setMode] = useState<'menu' | 'client' | 'references'>('menu')
  const [clientCode, setClientCode] = useState<string | null>(null)
  const [references, setReferences] = useState<Reference[]>([])
  const [query, setQuery] = useState('')
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuteur(data.session?.user.email ?? null))
    listClients().then(setClients).catch(() => {})
    listReferences().then(setReferences).catch(() => {})
    getActiveInventaire()
      .then(setActive)
      .catch(() => setActive(null))
  }, [])

  async function start(scopeKind: ScopeKind, options: { clientCode?: string; refCodes?: string[] } = {}) {
    if (!auteur || busy) return
    setBusy(true)
    try {
      const inv = await createInventaire(scopeKind, auteur, options)
      onReady(inv)
    } finally {
      setBusy(false)
    }
  }

  if (active === 'loading') {
    return (
      <main className="inventory">
        <p className="form-status">{t.inventory.loading}</p>
      </main>
    )
  }

  if (active) {
    return (
      <main className="inventory">
        <button className="back-link" onClick={onBack}>
          ← {t.inventory.back}
        </button>
        <h1>{t.inventory.resumeTitle}</h1>
        <p className="quantity-formula">
          {interpolate(t.inventory.resumeSubtitle, {
            scope: scopeLabel(active, clients, t),
            date: new Date(active.created_at).toLocaleDateString(),
          })}
        </p>
        <button className="arm-button" onClick={() => onReady(active)}>
          {t.inventory.resumeButton}
        </button>
      </main>
    )
  }

  if (mode === 'client') {
    const options = clients.map((c) => ({ value: c.code, label: c.nom }))
    return (
      <main className="inventory">
        <button className="back-link" onClick={() => setMode('menu')}>
          ← {t.common.cancel}
        </button>
        <h1>{t.inventory.clientPickTitle}</h1>
        <label className="field-label">
          {t.settings.client}
          <SearchSelect
            options={options}
            value={clientCode}
            onChange={setClientCode}
            placeholder={t.settings.clientSearch}
          />
        </label>
        <button
          className="arm-button"
          disabled={!clientCode || busy}
          onClick={() => start('client', { clientCode: clientCode! })}
        >
          {t.inventory.start}
        </button>
      </main>
    )
  }

  if (mode === 'references') {
    const filtered = references.filter((r) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return r.code.toLowerCase().includes(q) || (r.libelle ?? '').toLowerCase().includes(q)
    })

    function toggle(code: string) {
      setSelectedRefs((prev) => {
        const next = new Set(prev)
        if (next.has(code)) next.delete(code)
        else next.add(code)
        return next
      })
    }

    return (
      <main className="inventory">
        <button className="back-link" onClick={() => setMode('menu')}>
          ← {t.common.cancel}
        </button>
        <h1>{t.inventory.referencesPickTitle}</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.inventory.referenceSearch}
        />
        <ul className="casier-list">
          {filtered.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                className={`casier-row${selectedRefs.has(r.code) ? ' done' : ''}`}
                onClick={() => toggle(r.code)}
              >
                <span>
                  {r.code}
                  {r.libelle ? ` — ${r.libelle}` : ''}
                </span>
                {selectedRefs.has(r.code) && <span className="casier-status">✓</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="quantity-formula">
          {interpolate(t.inventory.selectedCount, { count: selectedRefs.size })}
        </p>
        <button
          className="arm-button"
          disabled={selectedRefs.size === 0 || busy}
          onClick={() => start('references', { refCodes: [...selectedRefs] })}
        >
          {t.inventory.start}
        </button>
      </main>
    )
  }

  return (
    <main className="inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.launchScope}</h1>
      <div className="home-actions">
        <button className="home-action" disabled={busy} onClick={() => start('tout')}>
          {t.inventory.scopeTout}
        </button>
        <button className="home-action" onClick={() => setMode('client')}>
          {t.inventory.scopeClient}
        </button>
        <button className="home-action" onClick={() => setMode('references')}>
          {t.inventory.scopeReferences}
        </button>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------
// Écran 2 — saisie libre en marchant
// ---------------------------------------------------------------------

interface RecentEntry {
  ligneId: string
  emplacementCode: string
  refCode: string
  cartons: number
  pieces: number
}

type WalkStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }

// Pas de liste à cocher, pas d'auto-complétion : l'opérateur marche à son
// rythme et tape ce qu'il voit, où qu'il le voie — y compris une réf qui n'a
// théoriquement aucun stock à cet endroit. C'est ce qui rend une palette
// déplacée détectable. Un code emplacement inconnu est créé à la volée
// (`ensureEmplacement`) ; une référence inconnue est refusée, faute de quoi
// il est impossible de convertir cartons → pièces (aucun conditionnement).
function Walk({
  inventaire,
  auteur,
  onDone,
  onBack,
}: {
  inventaire: Inventaire
  auteur: string | null
  onDone: () => void
  onBack: () => void
}) {
  const { t } = useI18n()
  const [emplacementCode, setEmplacementCode] = useState('')
  const [knownEmplacements, setKnownEmplacements] = useState<string[]>([])
  const [refCode, setRefCode] = useState('')
  const [allReferences, setAllReferences] = useState<Reference[]>([])
  const [conditionnements, setConditionnements] = useState<Conditionnement[]>([])
  const [conditionnementId, setConditionnementId] = useState<string | null>(null)
  const [cartons, setCartons] = useState('')
  const [pieces, setPieces] = useState('')
  const [status, setStatus] = useState<WalkStatus>({ kind: 'idle' })
  const [recent, setRecent] = useState<RecentEntry[]>([])

  useEffect(() => {
    listEmplacements()
      .then((list) => setKnownEmplacements(list.map((e) => e.code)))
      .catch(() => {})
    listReferences().then(setAllReferences).catch(() => {})
  }, [])

  // Une entrée complète (tirets déjà posés, ou zone+chiffres sans tiret) se
  // résout de façon déterministe (règle stricte "A11" -> "A-01-1" seulement)
  // — pas de recherche floue dans ce cas, sinon un code plus long qui
  // partage le même préfixe compact (ex. "A-11-1") réapparaîtrait à tort.
  // La recherche floue ne sert que tant que la saisie est encore incomplète.
  const resolvedEmplacement = resolveEmplacementInput(emplacementCode)
  const emplacementSuggestions = (
    resolvedEmplacement
      ? resolvedEmplacement === emplacementCode.trim().toUpperCase()
        ? []
        : [resolvedEmplacement]
      : matchEmplacements(emplacementCode, knownEmplacements)
  ).map((code) => ({ value: code, label: code }))

  // Recherche floue par sous-chaîne (n'importe où dans le code, y compris
  // juste les chiffres) : "65", "265" ou "REU26" trouvent tous "REU265" —
  // permet de ne taper que des chiffres au clavier iPhone la plupart du
  // temps, sans passer par le clavier lettres (2026-09-14).
  const referenceSuggestions = matchReferences(refCode, allReferences).map((r) => ({
    value: r.code,
    label: r.libelle ? `${r.code} — ${r.libelle}` : r.code,
  }))

  async function lookupReference(codeOverride?: string) {
    const code = (codeOverride ?? refCode).trim().toUpperCase()
    if (!code) {
      setConditionnements([])
      setConditionnementId(null)
      return
    }
    const list = await listConditionnements(code)
    setConditionnements(list)
    setConditionnementId(list[0]?.id ?? null)
  }

  const selectedConditionnement = conditionnements.find((c) => c.id === conditionnementId) ?? null
  const totalPieces = selectedConditionnement
    ? (Number(cartons) || 0) * selectedConditionnement.pieces_par_carton + (Number(pieces) || 0)
    : null

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!auteur || status.kind === 'saving') return

    const typed = emplacementCode.trim().toUpperCase()
    const empl = parseEmplacementCode(typed) ? typed : resolveEmplacementInput(typed) ?? typed
    if (!empl || !parseEmplacementCode(empl)) {
      setStatus({ kind: 'error', message: t.inventory.invalidEmplacement })
      return
    }
    const code = refCode.trim().toUpperCase()
    if (!code) {
      setStatus({ kind: 'error', message: t.inventory.unknownReference })
      return
    }
    if (cartons === '' && pieces === '') {
      setStatus({ kind: 'error', message: t.inventory.emptyQuantity })
      return
    }

    setStatus({ kind: 'saving' })
    try {
      // Toujours relire les conditionnements ici, jamais se fier à l'état
      // `conditionnements` : le stepper cartons/pieces bloque le blur
      // (`keepFocus`), donc le lookup au blur peut ne jamais s'être
      // déclenché avant la soumission clavier — et depuis l'ajout des
      // suggestions, `conditionnements` peut aussi rester celui d'une
      // référence choisie précédemment si le champ est retapé par-dessus
      // sans repasser par le blur ou une sélection.
      const list = await listConditionnements(code)
      const condId = list.some((c) => c.id === conditionnementId) ? conditionnementId : list[0]?.id ?? null
      if (list.length === 0 || !condId) {
        setStatus({ kind: 'error', message: t.inventory.unknownReference })
        return
      }

      await ensureEmplacement(empl)
      const { comptage } = await getOrCreateCasier(inventaire.id, empl)
      const cartonsValue = Number(cartons) || 0
      const piecesValue = Number(pieces) || 0
      const ligneId = await saveCasierLigne(comptage.id, code, condId, cartonsValue, piecesValue, auteur)
      await markCasierVisite(comptage.id) // "touché" = compté, dans ce modèle il n'y a pas d'état intermédiaire

      setEmplacementCode(empl) // affiche la forme canonique réellement enregistrée (ex. "A11" tapé -> "A-01-1")
      setRecent((prev) => [
        {
          ligneId,
          emplacementCode: empl,
          refCode: code,
          cartons: cartonsValue,
          pieces: piecesValue,
        },
        ...prev,
      ].slice(0, 8))

      setRefCode('')
      setConditionnements([])
      setConditionnementId(null)
      setCartons('')
      setPieces('')
      setStatus({ kind: 'idle' })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function undo(entry: RecentEntry) {
    await deleteCasierLigne(entry.ligneId)
    setRecent((prev) => prev.filter((e) => e.ligneId !== entry.ligneId))
  }

  return (
    <main className="inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.title}</h1>

      <form className="settings-form" onSubmit={handleSave}>
        <label className="field-label">
          {t.inventory.casier}
          <ComboInput
            value={emplacementCode}
            onChange={setEmplacementCode}
            suggestions={emplacementSuggestions}
            placeholder={t.inventory.casierPlaceholder}
            disabled={status.kind === 'saving'}
          />
        </label>
        <label className="field-label">
          {t.inventory.reference}
          <ComboInput
            value={refCode}
            onChange={setRefCode}
            onSelect={(code) => lookupReference(code)}
            onBlur={() => lookupReference()}
            suggestions={referenceSuggestions}
            placeholder={t.inventory.referencePlaceholder}
            disabled={status.kind === 'saving'}
          />
        </label>
        {conditionnements.length > 1 && (
          <label className="field-label">
            {t.inventory.conditionnement}
            <select value={conditionnementId ?? ''} onChange={(e) => setConditionnementId(e.target.value)}>
              {conditionnements.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.libelle_court ?? `${c.pieces_par_carton}p/c`}
                  {c.a_ecouler ? ` — ${t.inventory.aEcouler}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="quantity-row">
          <label className="field-label">
            {t.inventory.cartons}
            <CountStepper value={cartons} onChange={setCartons} />
          </label>
          <label className="field-label">
            {t.inventory.pieces}
            <CountStepper value={pieces} onChange={setPieces} />
          </label>
        </div>
        {totalPieces !== null && <p className="quantity-formula">{totalPieces} pièces</p>}
        <button type="submit" disabled={status.kind === 'saving'}>
          {t.common.save}
        </button>
        {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
      </form>

      {recent.length > 0 && (
        <ul className="casier-list">
          {recent.map((entry) => (
            <li key={entry.ligneId}>
              <div className="casier-row">
                <span>
                  {entry.emplacementCode} — {entry.refCode} : {entry.cartons}c + {entry.pieces}p
                </span>
                <button type="button" className="back-link" onClick={() => undo(entry)}>
                  {t.inventory.removeLine}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button className="arm-button" onClick={onDone}>
        {t.inventory.viewEcarts}
      </button>
    </main>
  )
}

// ---------------------------------------------------------------------
// Écran 3 — écarts (synthèse, lecture seule en phase 1)
// ---------------------------------------------------------------------

function Ecarts({ inventaire, onBack }: { inventaire: Inventaire; onBack: () => void }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [emplacements, setEmplacements] = useState<string[]>([])
  const [visites, setVisites] = useState<Set<string>>(new Set())
  const [references, setReferences] = useState<SyntheseReference[]>([])
  const [openRef, setOpenRef] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getInventaireSynthese(inventaire).then((result) => {
      if (cancelled) return
      setEmplacements(result.emplacements)
      setVisites(result.visites)
      setReferences(result.references)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [inventaire])

  const enEcart = references.filter((r) => r.ecartTotal !== null && r.ecartTotal !== 0)
  const sansEcart = references.filter((r) => r.ecartTotal === 0)
  // Casiers attendus (théorique non nul) jamais touchés pendant la marche —
  // c'est ici, à la comparaison, que se découvre un casier oublié (brief
  // révisé du 2026-09-14), pas via une liste à cocher en amont.
  const nonVisites = emplacements.filter((e) => !visites.has(e))

  return (
    <main className="inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.ecartsTitle}</h1>
      <p className="login-hint">{t.inventory.phase1Notice}</p>

      {nonVisites.length > 0 && (
        <p className="form-status form-error">
          {nonVisites.length} {t.inventory.notAllVisited} : {nonVisites.join(', ')}
        </p>
      )}

      {loading ? (
        <p className="form-status">{t.inventory.loading}</p>
      ) : (
        <>
          <h2>{t.inventory.syntheseTitle}</h2>
          {enEcart.length === 0 && <p className="form-status">{t.inventory.noEcart}</p>}

          {enEcart.map((ref) => (
            <div className="inventory-line" key={`${ref.refCode}|${ref.conditionnementId}`}>
              <button
                type="button"
                className="casier-row"
                onClick={() =>
                  setOpenRef(
                    openRef === `${ref.refCode}|${ref.conditionnementId}`
                      ? null
                      : `${ref.refCode}|${ref.conditionnementId}`,
                  )
                }
              >
                <span>
                  {ref.refCode}
                  {ref.libelleCourt ? ` — ${ref.libelleCourt}` : ''}
                </span>
                <span className="casier-status">
                  {ref.theoriqueTotal} → {ref.compteTotal} ({ref.ecartTotal! > 0 ? '+' : ''}
                  {ref.ecartTotal})
                </span>
              </button>
              <p className="quantity-formula">{ref.compense ? t.inventory.ecartCompense : t.inventory.ecartReel}</p>

              {openRef === `${ref.refCode}|${ref.conditionnementId}` && (
                <div className="settings-form">
                  <h2>{t.inventory.detailByEmplacement}</h2>
                  {ref.parEmplacement.map((l) => (
                    <p className="quantity-formula" key={l.emplacementCode}>
                      {l.emplacementCode} — {l.theorique} → {l.compte === null ? `(${t.inventory.notAllVisited})` : l.compte}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}

          {sansEcart.length > 0 && (
            <p className="login-hint">
              {sansEcart.length} / {references.length}
            </p>
          )}
        </>
      )}
    </main>
  )
}
