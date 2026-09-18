import { useEffect, useState, type FormEvent } from 'react'
import { useI18n, interpolate } from '../i18n'
import ja from '../i18n/ja'
import { supabase } from '../lib/supabase'
import { extractErrorMessage } from '../lib/errors'
import {
  ensureEmplacement,
  listClients,
  listConditionnements,
  listConditionnementsByRef,
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

// Document imprimé (spec 2.49, §6.5) : toujours en japonais, quelle que
// soit la langue de l'interface — l'interface sert l'opérateur, le
// document sert ses lecteurs, deux publics différents. Volontairement HORS
// du dictionnaire `Dictionary` (donc pas dans fr.ts/en.ts) : ce n'est pas
// une chaîne d'interface traduisible mais un vocabulaire d'entrepôt fixe,
// même régime que les en-têtes de fichiers d'import/export (CLAUDE.md) —
// ne jamais le faire dépendre du sélecteur de langue, ne jamais
// « corriger » une traduction ici, ces termes viennent de la spec telle
// quelle.
const PRINT_JA = {
  titre: '棚卸差異報告',
  statut: '進行中 ― 未確定',
  perimetre: '対象',
  dateImpression: '印刷日時',
  emplacement: '棚番',
  codeArticle: '品番',
  designation: '品名',
  stockTheorique: '理論在庫',
  quantiteComptee: '実棚数量',
  ecart: '差異',
  cartons: 'ケース',
  pieces: 'バラ',
  total: '合計',
  quantiteTotale: '合計数量',
  ecartTotal: '差異合計',
  confirmation: '確認',
  piedConfirmateur: '確認者 ／ 日付',
  // Feuille de contre-validation (spec 2.50) : destinée à être détachée et
  // emportée dans l'entrepôt — sans son propre titre et son propre bloc
  // 対象/date, séparée de la page 1 elle redevient une liste anonyme de
  // nombres, alors que c'est elle qui sera signée.
  titreConfirmation: '棚卸確認表',
}

// Convention japonaise imposée pour le document imprimé (spec 2.49),
// indépendante de la langue de l'interface — "2026/09/18 14:32", sans
// secondes.
function formatPrintDate(iso: string | number | Date): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
  // Ordre de tournée (§8 : zone/baie/niveau, celui de `listEmplacements`) —
  // sert uniquement à trier la feuille de contre-validation (spec 2.49) :
  // la personne qui contrôle marche dans l'entrepôt, un tri par référence
  // lui ferait faire des allers-retours.
  const [emplacementOrder, setEmplacementOrder] = useState<string[]>([])
  // Feuille de contre-validation (spec 2.49) : source = journal complet des
  // saisies, PAS `references`/`parEmplacement` (filtrée par
  // getInventaireSynthese sur statut === 'clos', dette §14) — un document
  // censé être complet ne peut pas hériter de ce filtre fragile.
  const [saisies, setSaisies] = useState<SaisieLine[]>([])
  const [refLibelleByCode, setRefLibelleByCode] = useState<Map<string, string | null>>(new Map())
  const [conditionnementById, setConditionnementById] = useState<Map<string, Conditionnement>>(new Map())
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
    listEmplacements().then((list) => {
      if (!cancelled) setEmplacementOrder(list.map((e) => e.code))
    }).catch(() => {})
    // Groupées avec la synthèse (pas en best-effort séparé) : ce sont les
    // données de la feuille de contre-validation, un document destiné à
    // être signé — un échec silencieux de `listConditionnementsByRef`
    // ferait imprimer un 合計 tronqué (taux manquant = 0) sans que rien ne
    // le signale.
    Promise.all([
      getInventaireSynthese(inventaire),
      listInventaireSaisies(inventaire.id),
      listReferences(),
      listConditionnementsByRef(),
    ])
      .then(([synthese, saisieList, refList, condByRef]) => {
        if (cancelled) return
        setReferences(synthese.references)
        setSaisies(saisieList)
        setRefLibelleByCode(new Map(refList.map((r) => [r.code, r.libelle])))
        const byId = new Map<string, Conditionnement>()
        for (const list of condByRef.values()) for (const c of list) byId.set(c.id, c)
        setConditionnementById(byId)
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

  // Une seule capture (spec 2.50) : la feuille de contre-validation peut
  // être détachée et emportée séparément de la page 1 — les deux doivent
  // afficher la même heure d'impression pour rester traçables l'une à
  // l'autre, ce qu'un second `new Date()` au rendu ne garantirait pas.
  const printedAt = formatPrintDate(new Date())

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

      {/* Document imprimé (spec 2.49 §6.5) : masqué à l'écran, visible
          seulement via @media print — la seule partie de l'écran qui reste
          visible à l'impression (voir global.css). Toujours en japonais
          (PRINT_JA), quelle que soit la langue de l'interface — l'écran
          sert l'opérateur, le document sert ses lecteurs. Format unique,
          celui de la phase 2, construit dès maintenant : les colonnes
          théorique/écart restent même à zéro, pour ne pas devoir refaire
          la mise en page à l'amorçage. Un inventaire en cours reste
          imprimable (révision du 18 septembre) — d'où la mention non
          dissimulable, inconditionnelle tant que la clôture n'existe pas. */}
      <div className="print-summary">
        <h1>{PRINT_JA.titre}</h1>
        <p className="print-banner">{PRINT_JA.statut}</p>
        <p>
          {PRINT_JA.perimetre}：{scopeLabel(inventaire, clients, ja)}
        </p>
        <p>
          {PRINT_JA.dateImpression}：{printedAt}
        </p>
        <div className="print-totals">
          <p>
            {PRINT_JA.quantiteTotale}：{references.reduce((sum, r) => sum + r.compteTotal, 0)}
          </p>
          <p>
            {PRINT_JA.ecartTotal}：{references.reduce((sum, r) => sum + r.ecartTotal, 0)}
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th className="print-col-code">{PRINT_JA.codeArticle}</th>
              <th>{PRINT_JA.designation}</th>
              <th>{PRINT_JA.stockTheorique}</th>
              <th>{PRINT_JA.quantiteComptee}</th>
              <th>{PRINT_JA.ecart}</th>
            </tr>
          </thead>
          <tbody>
            {references.map((r) => (
              <tr key={`${r.refCode}|${r.conditionnementId}`}>
                <td className="print-col-code">{r.refCode}</td>
                <td>{[r.refLibelle, r.conditionnementLabel].filter(Boolean).join(' · ')}</td>
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

        {/* Feuille de contre-validation (spec 2.49-2.50) : second document,
            un saut de page plus loin — le relevé complet du comptage, une
            ligne par saisie. Source : `saisies` (listInventaireSaisies),
            PAS `references`/`parEmplacement` — cette dernière est filtrée
            par `getInventaireSynthese` sur `statut === 'clos'` (dette
            §14 sur `comptages.statut`), donc un casier dont le marquage
            "visité" aurait échoué disparaîtrait silencieusement d'une
            feuille censée être complète. `listInventaireSaisies` existe
            précisément sans ce filtre. Triée par emplacement dans l'ordre
            de tournée (§8), pas par référence — la personne qui contrôle
            marche dans l'entrepôt. Son propre titre et son propre bloc
            対象/date (spec 2.50) : cette feuille est faite pour être
            détachée et emportée dans l'entrepôt — sans eux, séparée de la
            page 1, elle redevient une liste anonyme de nombres alors que
            c'est elle qui sera signée. */}
        <div className="print-page-break">
          <h1>{PRINT_JA.titreConfirmation}</h1>
          <p>
            {PRINT_JA.perimetre}：{scopeLabel(inventaire, clients, ja)}
          </p>
          <p>
            {PRINT_JA.dateImpression}：{printedAt}
          </p>
          <table>
            <thead>
              <tr>
                <th className="print-col-check">{PRINT_JA.confirmation}</th>
                <th className="print-col-code">{PRINT_JA.emplacement}</th>
                <th className="print-col-code">{PRINT_JA.codeArticle}</th>
                <th>{PRINT_JA.designation}</th>
                <th>{PRINT_JA.cartons}</th>
                <th>{PRINT_JA.pieces}</th>
                <th>{PRINT_JA.total}</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const orderIndex = new Map(emplacementOrder.map((code, i) => [code, i]))
                const rows = saisies.map((s) => {
                  const cond = conditionnementById.get(s.conditionnementId)
                  const pieceRate = cond?.pieces_par_carton ?? 0
                  const label = [refLibelleByCode.get(s.refCode), cond?.libelle_court]
                    .filter(Boolean)
                    .join(' · ')
                  return {
                    emplacementCode: s.emplacementCode,
                    refCode: s.refCode,
                    refLibelle: label,
                    cartons: s.cartons,
                    pieces: s.pieces,
                    total: s.cartons * pieceRate + s.pieces,
                  }
                })
                rows.sort((a, b) => {
                  const ia = orderIndex.get(a.emplacementCode) ?? Number.MAX_SAFE_INTEGER
                  const ib = orderIndex.get(b.emplacementCode) ?? Number.MAX_SAFE_INTEGER
                  if (ia !== ib) return ia - ib
                  return (
                    a.emplacementCode.localeCompare(b.emplacementCode) || a.refCode.localeCompare(b.refCode)
                  )
                })
                return rows.map((row, i) => (
                  <tr key={`${row.emplacementCode}|${row.refCode}|${i}`}>
                    <td className="print-col-check">
                      <span className="print-checkbox" />
                    </td>
                    <td className="print-col-code">{row.emplacementCode}</td>
                    <td className="print-col-code">{row.refCode}</td>
                    <td>{row.refLibelle}</td>
                    <td>{row.cartons}</td>
                    <td>{row.pieces}</td>
                    <td>{row.total}</td>
                  </tr>
                ))
              })()}
            </tbody>
          </table>
          <p className="print-footer">{PRINT_JA.piedConfirmateur}：＿＿＿＿＿＿＿＿＿＿ ／ ＿＿＿＿＿＿</p>
        </div>
      </div>
    </main>
  )
}
