import { useEffect, useState, type FormEvent } from 'react'
import { useI18n, interpolate } from '../i18n'
import { supabase } from '../lib/supabase'
import { extractErrorMessage } from '../lib/errors'
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
  abandonInventaire,
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

  // Abandon (spec 2.46 §6.5) : ferme le comptage sans laisser l'app sur un
  // inventaire qui n'existe plus — retour au lancement, qui ne trouvera
  // alors plus aucun inventaire `en_cours` et proposera d'en ouvrir un
  // nouveau (le comptage suivant en dépend, cf. one_inventaire_en_cours).
  function handleAbandoned() {
    setInventaire(null)
    setPhase('launch')
  }

  if (phase === 'launch' || !inventaire) {
    return <Launch onBack={onBack} onReady={handleReady} />
  }

  if (phase === 'ecarts') {
    return (
      <Ecarts
        inventaire={inventaire}
        auteur={auteur}
        onBack={() => setPhase('walk')}
        onAbandoned={handleAbandoned}
      />
    )
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
  // Sans elle, un lancement qui échoue (hors réseau, entre autres) retombe
  // silencieusement à `busy: false` sans qu'aucun message n'ait jamais été
  // affiché (§3, spec 2.35) — le bouton semble juste n'avoir rien fait.
  const [launchError, setLaunchError] = useState<string | null>(null)
  // Abandon accessible dès cet écran (spec 2.46 §6.5, revu après relecture
  // advisor) : sans lui, un inventaire resté ouvert d'une session
  // précédente n'a comme seule sortie visible que « Reprendre » — il
  // faudrait entrer dans la marche puis atteindre les écarts juste pour
  // fermer un comptage qu'on ne veut pas continuer. Même fonction que sur
  // l'écran des écarts, un second appelant, pas une seconde logique.
  const [showAbandon, setShowAbandon] = useState(false)
  const [abandonMotif, setAbandonMotif] = useState('')
  const [abandonStatus, setAbandonStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function handleAbandon() {
    if (!active || active === 'loading' || !abandonMotif.trim()) return
    setAbandonStatus({ kind: 'saving' })
    try {
      await abandonInventaire(active.id, abandonMotif.trim())
      setActive(null)
      setShowAbandon(false)
      setAbandonMotif('')
      setAbandonStatus({ kind: 'idle' })
    } catch (err) {
      setAbandonStatus({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
    }
  }

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
    setLaunchError(null)
    try {
      const inv = await createInventaire(scopeKind, auteur, options)
      onReady(inv)
    } catch (err) {
      setLaunchError(extractErrorMessage(err, t.common.unknownError))
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
        {!showAbandon ? (
          <button type="button" className="back-link" onClick={() => setShowAbandon(true)}>
            {t.inventory.abandonButton}
          </button>
        ) : (
          <div className="settings-form">
            <p className="quantity-formula">{t.inventory.abandonHint}</p>
            <label className="field-label">
              {t.inventory.abandonMotifLabel}
              <input
                value={abandonMotif}
                onChange={(e) => setAbandonMotif(e.target.value)}
                placeholder={t.inventory.abandonMotifPlaceholder}
                disabled={abandonStatus.kind === 'saving'}
              />
            </label>
            <button
              type="button"
              className="arm-button"
              onClick={handleAbandon}
              disabled={!abandonMotif.trim() || abandonStatus.kind === 'saving'}
            >
              {t.inventory.abandonButton}
            </button>
            {abandonStatus.kind === 'error' && <p className="form-status form-error">{abandonStatus.message}</p>}
          </div>
        )}
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
        {launchError && <p className="form-status form-error">{launchError}</p>}
      </main>
    )
  }

  if (mode === 'references') {
    // Même recherche que la Recherche et Mouvement (§6.2, spec 2.20) —
    // sans quoi cet écran resterait le seul avec sa propre logique
    // naïve. Liste complète tant que rien n'est tapé, comme avant.
    const filtered = query.trim() ? matchReferences(query, references) : references

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
        {launchError && <p className="form-status form-error">{launchError}</p>}
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
      {launchError && <p className="form-status form-error">{launchError}</p>}
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

  // matchReferences (db.ts) : code ("65"/"265"/"REU26" trouvent "REU265",
  // pas seulement au clavier chiffres) ET libellé par jetons normalisés
  // (§6.2, spec 2.20) — même recherche que Recherche et Mouvement.
  const referenceSuggestions = matchReferences(refCode, allReferences)
    .slice(0, 8)
    .map((r) => ({
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

  // Flèches de navigation (spec 2.25, §6.5, ordre défini au §8) : on avance
  // dans la séquence RÉELLE de `knownEmplacements` (déjà triée par
  // `ordre`/zone/baie/niveau via listEmplacements), jamais par calcul
  // arithmétique du code — une inter-allée n'a qu'un niveau 0, une baie
  // peut s'arrêter avant le niveau le plus haut, composer un code produirait
  // un casier fantôme ou un cul-de-sac. Casier vide ou non résolu : la
  // flèche avant part du premier de la liste, l'arrière du dernier. En
  // bout de liste, la flèche ne fait rien (pas de bouclage inventé).
  function stepEmplacement(direction: 1 | -1) {
    if (knownEmplacements.length === 0) return
    const currentIndex = resolvedEmplacement ? knownEmplacements.indexOf(resolvedEmplacement) : -1
    if (currentIndex === -1) {
      goToEmplacement(knownEmplacements[direction === 1 ? 0 : knownEmplacements.length - 1])
      return
    }
    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= knownEmplacements.length) return
    goToEmplacement(knownEmplacements[nextIndex])
  }

  // Changer de casier change ce qui est compté : seul le casier reste
  // (spec 2.25, §6.5 — "on saisit plusieurs références au même casier"
  // n'implique pas l'inverse). Une quantité ou une édition en cours
  // laissée dans le formulaire écrirait un comptage fabriqué au nouveau
  // casier si l'opérateur enregistre sans y avoir touché.
  function goToEmplacement(code: string) {
    setEmplacementCode(code)
    setRefCode('')
    setConditionnements([])
    setConditionnementId(null)
    setCartons('')
    setPieces('')
    setEditingKey(null)
    setPendingDuplicate(null)
  }

  const selectedConditionnement = conditionnements.find((c) => c.id === conditionnementId) ?? null
  const totalPieces = selectedConditionnement
    ? (Number(cartons) || 0) * selectedConditionnement.pieces_par_carton + (Number(pieces) || 0)
    : null
  const matchedReference = allReferences.find((r) => r.code === refCode.trim().toUpperCase()) ?? null

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
      setStatus({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
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
      setStatus({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
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
          <div className="casier-nav">
            <button
              type="button"
              className="step-button"
              onClick={() => stepEmplacement(-1)}
              disabled={status.kind === 'saving' || pendingDuplicate !== null}
              aria-label={t.inventory.previousCasier}
            >
              ←
            </button>
            <ComboInput
              value={emplacementCode}
              onChange={setEmplacementCode}
              suggestions={emplacementSuggestions}
              placeholder={t.inventory.casierPlaceholder}
              disabled={status.kind === 'saving' || pendingDuplicate !== null}
              selectOnFocus
            />
            <button
              type="button"
              className="step-button"
              onClick={() => stepEmplacement(1)}
              disabled={status.kind === 'saving' || pendingDuplicate !== null}
              aria-label={t.inventory.nextCasier}
            >
              →
            </button>
          </div>
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
        {/* Confirmation avant écriture (§6.2, spec 2.23) : ComboInput se
            réduit au code une fois une suggestion choisie (conception du
            composant, contrat partagé jamais modifié pour ce seul écran) —
            cette ligne en lecture seule affiche le libellé pour confirmer
            qu'on compte la bonne référence, sans quoi une faute de frappe
            sur un code voisin fabrique un faux écart. */}
        {matchedReference && (
          <p className="quantity-formula">
            {matchedReference.code}
            {matchedReference.libelle ? ` — ${matchedReference.libelle}` : ''}
          </p>
        )}
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
          {(showAllSaisies ? saisies : saisies.slice(0, 20)).map((entry) => {
            // Libellé de la référence, pas seulement du conditionnement
            // (§6.2/§6.5, spec 2.23) : confirme après coup qu'on a compté
            // la bonne référence, comme la ligne sous le champ le confirme
            // avant.
            const refLibelle = allReferences.find((r) => r.code === entry.refCode)?.libelle
            return (
              <li key={entry.ligneId}>
                <div className="casier-row">
                  <span>
                    {entry.emplacementCode} — {entry.refCode}
                    {refLibelle ? ` — ${refLibelle}` : ''}
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
            )
          })}
          {!showAllSaisies && saisies.length > 20 && (
            <li>
              <button type="button" className="back-link" onClick={() => setShowAllSaisies(true)}>
                {t.inventory.showMore}
              </button>
            </li>
          )}
        </ul>
      )}

      {/* Barre d'action collante (spec 2.46 §6.5) : ce bouton sortait de
          l'écran après quelques saisies et obligeait à faire défiler
          jusqu'au bord — utilisé chaque vendredi, ce frottement se répète
          chaque semaine. Fixé en bas, dans la zone sûre. */}
      <div className="sticky-bottom-bar">
        <button className="arm-button" onClick={onDone}>
          {t.inventory.viewEcarts}
        </button>
      </div>
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
  onAbandoned,
}: {
  inventaire: Inventaire
  auteur: string | null
  onBack: () => void
  onAbandoned: () => void
}) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  // Sans catch, un échec (réseau, entre autres) laissait `loading` à `true`
  // pour toujours — un chargement sans fin plutôt qu'un message (§3, spec
  // 2.35).
  const [loadError, setLoadError] = useState<string | null>(null)
  const [references, setReferences] = useState<SyntheseReference[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [editingLigneId, setEditingLigneId] = useState<string | null>(null)
  const [editCartons, setEditCartons] = useState('')
  const [editPieces, setEditPieces] = useState('')
  const [editStatus, setEditStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  // Filtre de recherche en tête (spec 2.46 §6.5) : sur une gamme entière,
  // atteindre une référence par défilement n'est pas tenable. Même filtre
  // partagé que Recherche/Mouvement/Inventaire (§6.2), pas une logique
  // propre à cet écran.
  const [query, setQuery] = useState('')
  // Abandon (spec 2.46 §6.5, échéance 25/09) : seule sortie possible en
  // phase 1, la clôture écrivant des ajustements qu'on ne veut pas tant
  // qu'aucun stock d'ouverture n'est amorcé.
  const [abandonMotif, setAbandonMotif] = useState('')
  const [abandonStatus, setAbandonStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function refresh() {
    const result = await getInventaireSynthese(inventaire)
    setReferences(result.references)
  }

  useEffect(() => {
    let cancelled = false
    listClients().then((list) => {
      if (!cancelled) setClients(list)
    }).catch(() => {})
    getInventaireSynthese(inventaire)
      .then((result) => {
        if (cancelled) return
        setReferences(result.references)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(extractErrorMessage(err, t.common.unknownError))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [inventaire, t])

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
      setEditStatus({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
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
      setEditStatus({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
    }
  }

  // Ferme le comptage sans écrire aucun mouvement (spec 2.46 §6.5) : seule
  // sortie possible en phase 1, la clôture restant hors périmètre tant
  // qu'aucun stock d'ouverture n'est amorcé (§2). Les lignes de comptage ne
  // sont pas touchées — seul `inventaires.statut` change.
  async function handleAbandon() {
    if (!abandonMotif.trim()) return
    setAbandonStatus({ kind: 'saving' })
    try {
      await abandonInventaire(inventaire.id, abandonMotif.trim())
      onAbandoned()
    } catch (err) {
      setAbandonStatus({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
    }
  }

  // Un casier théorique jamais compté vaut 0 dans le calcul (règle du
  // 2026-09-14 : "je compte ce que je compte, si ce n'est pas compté, c'est
  // un écart") — pas de statut "en attente" séparé, l'écart parle seul.
  // Filtre de recherche (spec 2.46 §6.5) appliqué avant la répartition en
  // deux listes, sur le même filtre partagé que le reste de l'app (§6.2).
  const matchedCodes = query.trim()
    ? new Set(
        matchReferences(
          query,
          references.map((r) => ({ code: r.refCode, libelle: r.refLibelle, client_code: '' })),
        ).map((r) => r.code),
      )
    : null
  const visibleReferences = matchedCodes ? references.filter((r) => matchedCodes.has(r.refCode)) : references
  const enEcart = visibleReferences.filter((r) => r.ecartTotal !== 0 || r.compense)
  const sansEcart = visibleReferences.filter((r) => r.ecartTotal === 0 && !r.compense)

  // Fonction (pas un composant JSX) : une réf corrigée depuis ce même écran
  // peut passer d'"en écart" à "sans écart" après `refresh()`, donc les deux
  // listes doivent pouvoir afficher/éditer la même ligne sans qu'elle
  // disparaisse ni perde son état déplié (2026-09-14, retour terrain).
  function renderReferenceRow(ref: SyntheseReference) {
    const key = `${ref.refCode}|${ref.conditionnementId}`
    // Mise en page revue (spec 2.46 §6.5, retour terrain du 18 septembre) :
    // un libellé long et souvent bilingue repoussait « 0 → 72 (+72) » dans
    // une colonne étroite qui se coupait en trois. Les chiffres passent
    // désormais sur leur propre ligne, sous le libellé, à position
    // horizontale fixe d'une ligne à l'autre — ce qui permet de balayer la
    // colonne du regard plutôt que de la chercher à chaque ligne.
    return (
      <div className="inventory-line" key={key}>
        <button
          type="button"
          className="ecart-row"
          onClick={() => setOpenRef(openRef === key ? null : key)}
        >
          <span className="ecart-row-title">
            {ref.refCode}
            {(() => {
              const suffix = [ref.refLibelle, ref.conditionnementLabel].filter(Boolean).join(' · ')
              return suffix ? ` — ${suffix}` : ''
            })()}
          </span>
          <span className="ecart-row-numbers">
            <span>
              {ref.theoriqueTotal} → {ref.compteTotal} ({ref.ecartTotal > 0 ? '+' : ''}
              {ref.ecartTotal})
            </span>
            <span
              className={`ecart-badge${
                ref.compense ? ' ecart-compense' : ref.ecartTotal !== 0 ? ' ecart-reel' : ''
              }`}
            >
              {ref.compense
                ? t.inventory.ecartCompense
                : ref.ecartTotal !== 0
                  ? t.inventory.ecartReel
                  : t.inventory.sansEcartLabel}
            </span>
          </span>
        </button>

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

  const ecartTotalPieces = references.reduce((sum, r) => sum + r.ecartTotal, 0)

  return (
    <main className="inventory">
      <div className="no-print">
        <button className="back-link" onClick={onBack}>
          ← {t.inventory.back}
        </button>
        <h1>{t.inventory.ecartsTitle}</h1>
        <p className="login-hint">{t.inventory.phase1Notice}</p>

        <div className="quantity-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.inventory.referenceSearch}
          />
          <button type="button" onClick={() => window.print()}>
            {t.inventory.printButton}
          </button>
        </div>

        {loading ? (
          <p className="form-status">{t.inventory.loading}</p>
        ) : loadError ? (
          <p className="form-status form-error">{loadError}</p>
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

        {/* Abandon (spec 2.46 §6.5, échéance ferme le 25 septembre) : sans
            lui, cet inventaire reste `en_cours` et bloque le comptage du
            vendredi suivant. Aucun mouvement écrit, les saisies restent. */}
        <div className="settings-form">
          <h2>{t.inventory.abandonTitle}</h2>
          <p className="quantity-formula">{t.inventory.abandonHint}</p>
          <label className="field-label">
            {t.inventory.abandonMotifLabel}
            <input
              value={abandonMotif}
              onChange={(e) => setAbandonMotif(e.target.value)}
              placeholder={t.inventory.abandonMotifPlaceholder}
              disabled={abandonStatus.kind === 'saving'}
            />
          </label>
          <button
            type="button"
            className="arm-button"
            onClick={handleAbandon}
            disabled={!abandonMotif.trim() || abandonStatus.kind === 'saving'}
          >
            {t.inventory.abandonButton}
          </button>
          {abandonStatus.kind === 'error' && <p className="form-status form-error">{abandonStatus.message}</p>}
        </div>
      </div>

      {/* Synthèse imprimable (spec 2.46 §6.5) : masquée à l'écran, visible
          seulement via @media print — la seule partie de l'écran qui reste
          visible à l'impression (voir global.css). Un inventaire en cours
          est imprimable aussi (révision du 18 septembre) : le besoin de
          justifier un comptage auprès de collègues n'attend pas la
          clôture, qui n'existe pas encore — d'où la mention non
          dissimulable ci-dessous, inconditionnelle tant que la clôture
          n'existe pas. */}
      <div className="print-summary">
        <h1>{t.inventory.printTitle}</h1>
        <p className="print-banner">{t.inventory.printNotClosed}</p>
        <p>{interpolate(t.inventory.resumeSubtitle, { scope: scopeLabel(inventaire, clients, t), date: new Date(inventaire.created_at).toLocaleDateString() })}</p>
        <p>{interpolate(t.inventory.printDate, { date: new Date().toLocaleString() })}</p>
        <p>{interpolate(t.inventory.printEcartTotal, { total: ecartTotalPieces })}</p>
        <table>
          <thead>
            <tr>
              <th>{t.inventory.reference}</th>
              <th>{t.inventory.printTheorique}</th>
              <th>{t.inventory.printCompte}</th>
              <th>{t.inventory.printEcart}</th>
            </tr>
          </thead>
          <tbody>
            {references.map((r) => (
              <tr key={`${r.refCode}|${r.conditionnementId}`}>
                <td>
                  {r.refCode}
                  {[r.refLibelle, r.conditionnementLabel].filter(Boolean).length > 0
                    ? ` — ${[r.refLibelle, r.conditionnementLabel].filter(Boolean).join(' · ')}`
                    : ''}
                </td>
                <td>{r.theoriqueTotal}</td>
                <td>{r.compteTotal}</td>
                <td>
                  {r.ecartTotal > 0 ? '+' : ''}
                  {r.ecartTotal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
