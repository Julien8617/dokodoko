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
  deleteCasierLignesForRef,
  getActiveInventaire,
  getInventaireSynthese,
  getOrCreateCasier,
  listInventaireSaisies,
  listLatestCasierLignes,
  markCasierVisite,
  saveCasierLigne,
  type SaisieLine,
  type SyntheseLigneEmplacement,
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
    return <Ecarts inventaire={inventaire} auteur={auteur} onBack={() => setPhase('walk')} />
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

type WalkStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }

// Casier + réf + conditionnement identifient une saisie de façon unique
// dans un inventaire (une ligne par couple, latest-wins) — sert à la fois
// à détecter un doublon et à savoir si une soumission est la correction en
// cours plutôt qu'une nouvelle saisie qui tombe par coïncidence sur le
// même couple.
interface EntryKey {
  emplacementCode: string
  refCode: string
  conditionnementId: string
}

function sameKey(a: EntryKey, b: EntryKey): boolean {
  return (
    a.emplacementCode === b.emplacementCode &&
    a.refCode === b.refCode &&
    a.conditionnementId === b.conditionnementId
  )
}

// Saisie en attente du choix "remplacer ou ajouter" (spec v2 §6.5) —
// posée après résolution complète de la saisie tapée, avant tout appel
// réseau d'écriture.
interface PendingDuplicate extends EntryKey {
  comptageId: string
  cartonsValue: number
  piecesValue: number
}

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
  // État effectif de tout l'inventaire (pas seulement de cette session) —
  // chargé au montage, tenu à jour localement à chaque écriture pour
  // éviter un refetch complet à chaque saisie (spec v2 §6.5).
  const [saisies, setSaisies] = useState<SaisieLine[]>([])
  const [showAllSaisies, setShowAllSaisies] = useState(false)
  // Couple (casier, réf, conditionnement) chargé dans le formulaire via
  // "modifier" — une resoumission sur exactement ce couple est la
  // correction attendue, pas un doublon à trancher.
  const [editingKey, setEditingKey] = useState<EntryKey | null>(null)
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null)
  // Étiquette de conditionnement par id, pour l'afficher dans la liste des
  // saisies (spec v2 §6.5 : "casier, référence, conditionnement, quantité")
  // — sans elle, deux lignes de la même réf sur deux conditionnements
  // distincts semblent identiques dans la liste.
  const [conditionnementLabels, setConditionnementLabels] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    listEmplacements()
      .then((list) => setKnownEmplacements(list.map((e) => e.code)))
      .catch(() => {})
    listReferences().then(setAllReferences).catch(() => {})
    listInventaireSaisies(inventaire.id).then(setSaisies).catch(() => {})
  }, [inventaire.id])

  // Ne relit les conditionnements que pour les réf effectivement présentes
  // dans la liste — pas à chaque frappe, seulement quand l'ensemble des réf
  // saisies change (une nouvelle réf apparaît, jamais un simple changement
  // de quantité sur une réf déjà connue).
  const saisieRefCodes = [...new Set(saisies.map((s) => s.refCode))].sort().join(',')
  useEffect(() => {
    if (!saisieRefCodes) return
    let cancelled = false
    Promise.all(saisieRefCodes.split(',').map((code) => listConditionnements(code)))
      .then((lists) => {
        if (cancelled) return
        const map = new Map<string, string>()
        for (const list of lists) {
          for (const c of list) map.set(c.id, c.libelle_court ?? `${c.pieces_par_carton}p/c`)
        }
        setConditionnementLabels(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [saisieRefCodes])

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

      const cartonsValue = Number(cartons) || 0
      const piecesValue = Number(pieces) || 0
      const key: EntryKey = { emplacementCode: empl, refCode: code, conditionnementId: condId }

      // "modifier" cliqué sur exactement ce couple : la resoumission est la
      // correction attendue, jamais un doublon à trancher — même si le
      // couple existe déjà dans `saisies` (c'est justement la ligne qu'on
      // corrige). Un couple différent de celui chargé (casier ou réf changé
      // entre-temps) retombe dans le cas normal ci-dessous.
      const existing = editingKey && sameKey(editingKey, key)
        ? null
        : saisies.find((s) => sameKey(s, key))

      if (existing) {
        setStatus({ kind: 'idle' })
        setPendingDuplicate({ ...key, comptageId: existing.comptageId, cartonsValue, piecesValue })
        return
      }

      await commitSave(key, cartonsValue, piecesValue)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Écrit réellement la ligne — appelé directement (pas de doublon détecté)
  // ou après le choix "remplacer"/"ajouter" sur un doublon.
  async function commitSave(key: EntryKey, cartonsValue: number, piecesValue: number) {
    // Ne devrait jamais arriver : handleSave vérifie déjà `auteur` avant
    // d'atteindre ce point, y compris via le détour par pendingDuplicate.
    // Un throw ici remonte dans le catch de l'appelant (message d'erreur
    // visible) au lieu de laisser le bouton bloqué en "saving" sans rien
    // afficher.
    if (!auteur) throw new Error('auteur manquant')
    // Capturés au moment du geste (l'appui sur Enregistrer, ou sur
    // remplacer/ajouter), jamais plus tard : voir le commentaire sur
    // saveCasierLigne pour la raison exacte (file hors ligne, spec v2 §3).
    const ligneId = crypto.randomUUID()
    const ligneTs = new Date().toISOString()

    await ensureEmplacement(key.emplacementCode)
    const { comptage } = await getOrCreateCasier(inventaire.id, key.emplacementCode)
    await saveCasierLigne(
      ligneId,
      ligneTs,
      comptage.id,
      key.refCode,
      key.conditionnementId,
      cartonsValue,
      piecesValue,
      auteur,
    )
    await markCasierVisite(comptage.id) // "touché" = compté, dans ce modèle il n'y a pas d'état intermédiaire

    setEmplacementCode(key.emplacementCode) // forme canonique réellement enregistrée (ex. "A11" -> "A-01-1")
    setSaisies((prev) => [
      {
        ligneId,
        comptageId: comptage.id,
        emplacementCode: key.emplacementCode,
        refCode: key.refCode,
        conditionnementId: key.conditionnementId,
        cartons: cartonsValue,
        pieces: piecesValue,
        ts: ligneTs,
      },
      ...prev.filter((s) => !sameKey(s, key)),
    ])

    setRefCode('')
    setConditionnements([])
    setConditionnementId(null)
    setCartons('')
    setPieces('')
    setEditingKey(null)
    setPendingDuplicate(null)
    setStatus({ kind: 'idle' })
  }

  // "Ajouter" somme sur la valeur SERVEUR au moment du choix, jamais sur
  // `saisies` : cet état est un instantané chargé au montage (reprise
  // d'inventaire, autre onglet) et peut être périmé — sommer dessus
  // écrirait un total faux et silencieux, en latest-wins ce serait la
  // valeur retenue (même principe que la relecture des conditionnements
  // dans handleSave, jamais se fier à un état local pour un calcul).
  async function resolveDuplicate(mode: 'remplacer' | 'ajouter') {
    if (!pendingDuplicate) return
    const { comptageId, cartonsValue, piecesValue, ...key } = pendingDuplicate
    setStatus({ kind: 'saving' })
    try {
      let finalCartons = cartonsValue
      let finalPieces = piecesValue
      if (mode === 'ajouter') {
        const currentLines = await listLatestCasierLignes(comptageId)
        const current = currentLines.find(
          (l) => l.ref_code === key.refCode && l.conditionnement_id === key.conditionnementId,
        )
        finalCartons += current?.cartons ?? 0
        finalPieces += current?.pieces ?? 0
      }
      await commitSave(key, finalCartons, finalPieces)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  function cancelDuplicate() {
    setPendingDuplicate(null)
    setStatus({ kind: 'idle' })
  }

  async function undo(entry: SaisieLine) {
    await deleteCasierLignesForRef(entry.comptageId, entry.refCode, entry.conditionnementId)
    setSaisies((prev) => prev.filter((s) => !sameKey(s, entry)))
  }

  // Recharge une saisie existante dans le formulaire pour la corriger (ex.
  // un carton oublié) — pas de suppression : réenregistrer crée simplement
  // une nouvelle ligne plus récente pour le même (casier, réf), qui prévaut
  // sur l'ancienne (dernière valeur connue), en gardant l'historique
  // complet. Même chemin de modification que l'écran des écarts : une
  // nouvelle ligne via saveCasierLigne, jamais un second mécanisme.
  async function editEntry(entry: SaisieLine) {
    setEmplacementCode(entry.emplacementCode)
    setRefCode(entry.refCode)
    setCartons(String(entry.cartons))
    setPieces(String(entry.pieces))
    setStatus({ kind: 'idle' })
    setPendingDuplicate(null)
    setEditingKey({
      emplacementCode: entry.emplacementCode,
      refCode: entry.refCode,
      conditionnementId: entry.conditionnementId,
    })
    const list = await listConditionnements(entry.refCode)
    setConditionnements(list)
    setConditionnementId(entry.conditionnementId)
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
            disabled={status.kind === 'saving' || pendingDuplicate !== null}
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
            disabled={status.kind === 'saving' || pendingDuplicate !== null}
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
        <button type="submit" disabled={status.kind === 'saving' || pendingDuplicate !== null}>
          {t.common.save}
        </button>
        {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
      </form>

      {pendingDuplicate && (
        <div className="form-status">
          <p>
            {interpolate(t.inventory.duplicateEntry, {
              emplacement: pendingDuplicate.emplacementCode,
              refCode: pendingDuplicate.refCode,
            })}
          </p>
          <button type="button" onClick={() => resolveDuplicate('remplacer')} disabled={status.kind === 'saving'}>
            {t.inventory.replaceEntry}
          </button>
          <button type="button" onClick={() => resolveDuplicate('ajouter')} disabled={status.kind === 'saving'}>
            {t.inventory.addEntry}
          </button>
          <button type="button" className="back-link" onClick={cancelDuplicate} disabled={status.kind === 'saving'}>
            {t.common.cancel}
          </button>
        </div>
      )}

      {saisies.length > 0 && (
        <ul className="casier-list">
          {(showAllSaisies ? saisies : saisies.slice(0, 20)).map((entry) => (
            <li key={entry.ligneId}>
              <div className="casier-row">
                <span>
                  {entry.emplacementCode} — {entry.refCode}
                  {conditionnementLabels.has(entry.conditionnementId)
                    ? ` (${conditionnementLabels.get(entry.conditionnementId)})`
                    : ''}{' '}
                  : {entry.cartons}c + {entry.pieces}p
                </span>
                <span className="recent-entry-actions">
                  <button type="button" className="back-link" onClick={() => editEntry(entry)}>
                    {t.inventory.editLine}
                  </button>
                  <button type="button" className="back-link" onClick={() => undo(entry)}>
                    {t.inventory.removeLine}
                  </button>
                </span>
              </div>
            </li>
          ))}
          {!showAllSaisies && saisies.length > 20 && (
            <li>
              <button type="button" className="back-link" onClick={() => setShowAllSaisies(true)}>
                {t.inventory.showMore}
              </button>
            </li>
          )}
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

function Ecarts({
  inventaire,
  auteur,
  onBack,
}: {
  inventaire: Inventaire
  auteur: string | null
  onBack: () => void
}) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [references, setReferences] = useState<SyntheseReference[]>([])
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [editingLigneId, setEditingLigneId] = useState<string | null>(null)
  const [editCartons, setEditCartons] = useState('')
  const [editPieces, setEditPieces] = useState('')
  const [editStatus, setEditStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function refresh() {
    const result = await getInventaireSynthese(inventaire)
    setReferences(result.references)
  }

  useEffect(() => {
    let cancelled = false
    getInventaireSynthese(inventaire).then((result) => {
      if (cancelled) return
      setReferences(result.references)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [inventaire])

  function startEdit(l: SyntheseLigneEmplacement) {
    setEditingLigneId(l.ligneId)
    setEditCartons(String(l.cartons ?? 0))
    setEditPieces(String(l.pieces ?? 0))
    setEditStatus({ kind: 'idle' })
  }

  // Corriger ou retirer une saisie DEPUIS l'écran Écarts, sans repasser par
  // la marche (2026-09-14, retour terrain) : on est déjà en train de
  // regarder l'écart, c'est le bon moment pour le corriger.
  async function saveEdit(ref: SyntheseReference, l: SyntheseLigneEmplacement) {
    if (!auteur || !l.comptageId) return
    // Nouvelle ligne (latest-wins), donc nouvel id — capturé ici, au geste,
    // pas dans saveCasierLigne (voir son commentaire).
    const ligneId = crypto.randomUUID()
    const ligneTs = new Date().toISOString()
    setEditStatus({ kind: 'saving' })
    try {
      await saveCasierLigne(
        ligneId,
        ligneTs,
        l.comptageId,
        ref.refCode,
        ref.conditionnementId,
        Number(editCartons) || 0,
        Number(editPieces) || 0,
        auteur,
      )
      setEditingLigneId(null)
      await refresh()
    } catch (err) {
      setEditStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Même chemin de suppression que la marche (arbitrage 2026-09-16) : sur
  // l'ensemble des lignes du couple (casier, réf, conditionnement), jamais
  // sur la seule dernière — voir deleteCasierLignesForRef.
  async function deleteEdit(ref: SyntheseReference, l: SyntheseLigneEmplacement) {
    if (!l.comptageId) return
    setEditStatus({ kind: 'saving' })
    try {
      await deleteCasierLignesForRef(l.comptageId, ref.refCode, ref.conditionnementId)
      setEditingLigneId(null)
      await refresh()
    } catch (err) {
      setEditStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Un casier théorique jamais compté vaut 0 dans le calcul (règle du
  // 2026-09-14 : "je compte ce que je compte, si ce n'est pas compté, c'est
  // un écart") — pas de statut "en attente" séparé, l'écart parle seul.
  const enEcart = references.filter((r) => r.ecartTotal !== 0 || r.compense)
  const sansEcart = references.filter((r) => r.ecartTotal === 0 && !r.compense)

  // Fonction (pas un composant JSX) : une réf corrigée depuis ce même écran
  // peut passer d'"en écart" à "sans écart" après `refresh()`, donc les deux
  // listes doivent pouvoir afficher/éditer la même ligne sans qu'elle
  // disparaisse ni perde son état déplié (2026-09-14, retour terrain).
  function renderReferenceRow(ref: SyntheseReference) {
    const key = `${ref.refCode}|${ref.conditionnementId}`
    return (
      <div className="inventory-line" key={key}>
        <button
          type="button"
          className="casier-row"
          onClick={() => setOpenRef(openRef === key ? null : key)}
        >
          <span>
            {ref.refCode}
            {ref.libelleCourt ? ` — ${ref.libelleCourt}` : ''}
          </span>
          <span className="casier-status">
            {ref.theoriqueTotal} → {ref.compteTotal} ({ref.ecartTotal > 0 ? '+' : ''}
            {ref.ecartTotal})
          </span>
        </button>
        <p className="quantity-formula">
          {ref.compense
            ? t.inventory.ecartCompense
            : ref.ecartTotal !== 0
              ? t.inventory.ecartReel
              : t.inventory.sansEcartLabel}
        </p>

        {openRef === key && (
          <div className="settings-form">
            <h2>{t.inventory.detailByEmplacement}</h2>
            {ref.parEmplacement.map((l) =>
              l.compte === null ? (
                <p className="quantity-formula" key={l.emplacementCode}>
                  {l.emplacementCode} — {l.theorique} → ({t.inventory.notAllVisited})
                </p>
              ) : (
                <div key={l.emplacementCode}>
                  <button
                    type="button"
                    className="casier-row"
                    onClick={() => (editingLigneId === l.ligneId ? setEditingLigneId(null) : startEdit(l))}
                  >
                    <span>
                      {l.emplacementCode} — {l.theorique} → {l.compte}
                    </span>
                  </button>
                  {editingLigneId === l.ligneId && (
                    <div className="settings-form">
                      <div className="quantity-row">
                        <label className="field-label">
                          {t.inventory.cartons}
                          <CountStepper value={editCartons} onChange={setEditCartons} />
                        </label>
                        <label className="field-label">
                          {t.inventory.pieces}
                          <CountStepper value={editPieces} onChange={setEditPieces} />
                        </label>
                      </div>
                      <button type="button" onClick={() => saveEdit(ref, l)} disabled={editStatus.kind === 'saving'}>
                        {t.common.save}
                      </button>
                      <button
                        type="button"
                        className="back-link"
                        onClick={() => deleteEdit(ref, l)}
                        disabled={editStatus.kind === 'saving'}
                      >
                        {t.inventory.removeLine}
                      </button>
                      {editStatus.kind === 'error' && <p className="form-status form-error">{editStatus.message}</p>}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <main className="inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.ecartsTitle}</h1>
      <p className="login-hint">{t.inventory.phase1Notice}</p>

      {loading ? (
        <p className="form-status">{t.inventory.loading}</p>
      ) : (
        <>
          <h2>{t.inventory.syntheseTitle}</h2>
          {enEcart.length === 0 && <p className="form-status">{t.inventory.noEcart}</p>}
          {enEcart.map(renderReferenceRow)}

          {sansEcart.length > 0 && (
            <>
              <h2>{t.inventory.sansEcartLabel}</h2>
              {sansEcart.map(renderReferenceRow)}
            </>
          )}
        </>
      )}
    </main>
  )
}
