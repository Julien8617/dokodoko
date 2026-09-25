import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { useI18n, interpolate, type Dictionary } from '../i18n'
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
  addReferenceToScope,
  createInventaire,
  deleteCasierLignesForRef,
  getActiveInventaire,
  getInventaireSynthese,
  getOrCreateCasier,
  listInventaireSaisies,
  markCasierVisite,
  moveCasierLigne,
  MoveCasierLignePartialError,
  saveCasierLigne,
  scopeRefCodes,
  type SaisieLine,
  type SyntheseLigneEmplacement,
  type SyntheseReference,
} from '../lib/inventaireDb'
import type { Client, Conditionnement, Inventaire, Reference, ScopeKind } from '../lib/types'
import SearchSelect from '../components/SearchSelect'
import ComboInput from '../components/ComboInput'
import CountStepper from '../components/CountStepper'
import Modal from '../components/Modal'

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
  // Le titre nomme le type de document, jamais le périmètre — confusion
  // du 19 septembre, corrigée en spec 2.53 : les deux pages retrouvent une
  // structure parallèle, titre puis 対象.
  titreSynthese: '棚卸差異報告',
  statut: '進行中 ― 未確定',
  perimetre: '対象',
  dateImpression: '印刷日時',
  // Valeur du champ 対象, dérivée de `inventaires.scope_kind` (spec 2.53) —
  // jamais saisie. Raccourcie par rapport à 2.52 (「全体」 et non
  // 「全体棚卸」) pour ne pas répéter 棚卸, déjà dans le titre.
  perimetreTout: '全体',
  perimetreClientPrefix: '得意先',
  perimetreReferencesPrefix: '品目指定',
  perimetreAuDela: '他{count}件', // {count} remplacé manuellement, pas interpolate() ici
  // Deux dates qui ne disent pas la même chose (spec 2.52-2.53) : la date
  // du comptage — une seule date, jamais un intervalle, le minimum des
  // horodatages déjà en main — et le frozen_ts qui rend l'écart
  // interprétable.
  dateComptage: '棚卸実施日',
  dateGel: '基準日時',
  totalLignes: '全{count}行', // {count} remplacé manuellement — repli sans dépendance si la pagination CSS ne s'affiche pas (spec 2.52)
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

// Même convention, date seule — 棚卸実施日 est "la date du travail", pas un
// horodatage (spec 2.52).
function formatPrintDateOnly(iso: string | number | Date): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

// 棚卸実施日 (spec 2.52) : date de la première saisie, ou intervalle
// première/dernière si le comptage s'étale sur plusieurs jours — la date
// que cherche un lecteur, distincte de `frozen_ts` (基準日時) qui rend
// l'écart interprétable. Repli sur la date de lancement si rien n'a encore
// été saisi (cas non prévu par la spec — un inventaire tout juste ouvert).
//
// Approximation connue, non résolue : `saisies` vient de
// listInventaireSaisies -> listLatestCasierLignes, qui NE GARDE QUE la
// dernière valeur par triplet (latest-wins, par construction). Une
// correction faite depuis l'écran des Écarts plusieurs jours après le
// comptage remplace le `ts` d'origine par celui de la correction : la
// borne haute de l'intervalle avance, faisant paraître le comptage plus
// étalé qu'il ne l'a été. Obtenir le vrai premier `ts` par ligne
// demanderait de lire le journal AVANT déduplication (nouvelle requête,
// non demandée) — signalé tel quel plutôt que construit sans arbitrage.
// Date unique (spec 2.53, revient sur l'intervalle de 2.52) : le minimum
// des horodatages déjà en main, jamais un intervalle. L'intervalle
// première/dernière était une addition non demandée, et c'est elle qui
// étirait la plage dès qu'une correction passait depuis les Écarts
// plusieurs jours après le comptage — une correction n'est pas du
// comptage. Aucune requête supplémentaire : `saisies` (latest-wins) suffit
// puisque les lignes non corrigées gardent l'horodatage du comptage.
function workDateLabel(saisies: SaisieLine[], fallbackIso: string): string {
  if (saisies.length === 0) return formatPrintDateOnly(fallbackIso)
  const earliest = saisies.reduce((min, s) => (s.ts < min ? s.ts : min), saisies[0].ts)
  return formatPrintDateOnly(earliest)
}

// Valeur du champ 対象 (spec 2.53) : dérivée de `inventaires.scope_kind`,
// jamais saisie. Le titre, lui, ne bouge pas — il nomme le document, pas
// le périmètre (correction du 19 septembre : les deux avaient été confondus).
function printScope(inventaire: Inventaire, clients: Client[], referencesScope: string[] | undefined): string {
  if (inventaire.scope_kind === 'tout') return PRINT_JA.perimetreTout
  if (inventaire.scope_kind === 'client') {
    const nom = clients.find((c) => c.code === inventaire.scope_client_code)?.nom ?? inventaire.scope_client_code ?? ''
    return `${PRINT_JA.perimetreClientPrefix} ${nom}`
  }
  const codes = [...(referencesScope ?? [])].sort()
  const shown = codes.slice(0, 3).join(', ')
  const rest = codes.length > 3 ? ` ${PRINT_JA.perimetreAuDela.replace('{count}', String(codes.length - 3))}` : ''
  return `${PRINT_JA.perimetreReferencesPrefix}（${shown}${rest}）`
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

// Un déplacement partiel (spec 2.58 §6.5, MoveCasierLignePartialError,
// inventaireDb.ts) n'est PAS une erreur ordinaire à réessayer telle
// quelle : la ligne a déjà été écrite au casier cible, un réessai naïf la
// duplique une seconde fois. Message dédié, jamais le message générique —
// partagée entre la marche (Modifier) et l'écran des écarts (Déplacer),
// les deux seuls appelants de moveCasierLigne.
function describeSaveError(err: unknown, t: Dictionary): string {
  if (err instanceof MoveCasierLignePartialError) return t.inventory.moveDuplicatedError
  return extractErrorMessage(err, t.common.unknownError)
}

// Saisie en attente du choix "remplacer ou ajouter" (spec v2 §6.5) —
// posée après résolution complète de la saisie tapée, avant tout appel
// réseau d'écriture.
interface PendingDuplicate extends EntryKey {
  cartonsValue: number
  piecesValue: number
  // Quantité déjà présente à la destination (spec 2.61 §6.5) : depuis que
  // cette question peut naître d'un déplacement en mode modification, la
  // valeur en place peut être un second comptage réel, ailleurs sur
  // l'écran (l'opérateur n'est plus devant ce casier) — sans ce nombre, le
  // choix remplacer/ajouter se ferait à l'aveugle.
  existingCartons: number
  existingPieces: number
}

// Saisie en attente de la confirmation d'extension de périmètre (spec
// 2.54, point 2) — posée avant même la résolution du casier/comptage,
// donc pas de `comptageId` ici contrairement à PendingDuplicate.
interface PendingScopeExtension extends EntryKey {
  cartonsValue: number
  piecesValue: number
}

// Changement de casier en mode modification (spec 2.60 §6.5) : le casier du
// formulaire est la destination, le changer n'est pas une correction de
// champ mais un déplacement — même récapitulatif de confirmation que
// "Déplacer" sur l'écran des écarts, jamais un update silencieux.
interface PendingMove extends EntryKey {
  fromEmplacementCode: string
  cartonsValue: number
  piecesValue: number
  // Quantité de la ligne AVANT modification (spec 2.65 §6.5) : la marche
  // passe par le formulaire de saisie, dont les champs de quantité restent
  // éditables pendant un déplacement — contrairement aux Écarts, qui n'ont
  // pas de champ de quantité. Défaut constaté le 24 septembre : la
  // confirmation nommait le déplacement et taisait le changement de
  // quantité, un opérateur croyant scinder perdait le reliquat sans le
  // voir. Sert uniquement à détecter et afficher l'écart avec
  // `cartonsValue`/`piecesValue` ci-dessus — jamais à borner ce qui est
  // écrit.
  originalCartons: number
  originalPieces: number
  // Collision à la destination (spec 2.62 §6.5) : détectée AU MOMENT où le
  // récapitulatif de déplacement se pose, pas après confirmation — pour que
  // les deux questions ("déplacer ?" et "remplacer ou ajouter ?") se
  // fondent dans un seul écran plutôt que de s'enchaîner. Deux dialogues
  // d'affilée feraient confirmer un déplacement avant d'en connaître la
  // conséquence, et découperaient en deux gestes ce qui est un seul choix.
  // `undefined` : aucune collision, le simple récapitulatif de déplacement
  // suffit. Union explicite plutôt qu'un `?` optionnel — exactOptionalPropertyTypes
  // interdit d'assigner `undefined` à un champ simplement optionnel.
  collision: { existingCartons: number; existingPieces: number } | undefined
}

// Trois variantes plutôt qu'une chaîne toujours-les-deux-unités (spec 2.65
// §6.5) : l'exemple de spec ne nomme que l'unité qui change. `null` = rien
// n'a changé, la ligne ne s'affiche pas.
function moveQuantityChangeLabel(move: PendingMove, t: Dictionary): string | null {
  const cartonsChanged = move.cartonsValue !== move.originalCartons
  const piecesChanged = move.piecesValue !== move.originalPieces
  if (cartonsChanged && piecesChanged) {
    return interpolate(t.inventory.moveQuantityChangeBoth, {
      fromCartons: move.originalCartons,
      toCartons: move.cartonsValue,
      fromPieces: move.originalPieces,
      toPieces: move.piecesValue,
    })
  }
  if (cartonsChanged) {
    return interpolate(t.inventory.moveQuantityChangeCartons, { from: move.originalCartons, to: move.cartonsValue })
  }
  if (piecesChanged) {
    return interpolate(t.inventory.moveQuantityChangePieces, { from: move.originalPieces, to: move.piecesValue })
  }
  return null
}

// Construit un PendingMove (spec 2.66 point 4 ter) : fonction partagée entre
// la marche et les Écarts, seule la source de `existingAtTarget` diffère
// (`saisies` d'un côté, `ref.parEmplacement` de l'autre — les deux appelants
// font eux-mêmes cette recherche et ne passent ici que son résultat).
function buildPendingMove(params: {
  key: EntryKey
  fromEmplacementCode: string
  cartonsValue: number
  piecesValue: number
  originalCartons: number
  originalPieces: number
  existingAtTarget: { cartons: number; pieces: number } | undefined
}): PendingMove {
  return {
    ...params.key,
    fromEmplacementCode: params.fromEmplacementCode,
    cartonsValue: params.cartonsValue,
    piecesValue: params.piecesValue,
    originalCartons: params.originalCartons,
    originalPieces: params.originalPieces,
    collision: params.existingAtTarget
      ? { existingCartons: params.existingAtTarget.cartons, existingPieces: params.existingAtTarget.pieces }
      : undefined,
  }
}

// Quantité réellement écrite (spec 2.62 §6.5, "ajouter" somme sur l'état
// local déjà connu, jamais une relecture serveur) — partagée entre la
// marche et les Écarts.
function computeMoveFinalQuantity(
  move: PendingMove,
  mode: 'remplacer' | 'ajouter' | undefined,
): { cartons: number; pieces: number } {
  if (mode === 'ajouter' && move.collision) {
    return {
      cartons: move.cartonsValue + move.collision.existingCartons,
      pieces: move.piecesValue + move.collision.existingPieces,
    }
  }
  return { cartons: move.cartonsValue, pieces: move.piecesValue }
}

// Composant de confirmation partagé entre la marche et les Écarts (spec 2.66
// point 4 ter) : avant ce commit, deux copies alignées à la main avaient déjà
// produit deux défauts distincts (spec 2.62, 2.64 §6.5). Fenêtre modale sans
// `onClose` (spec 2.64 §6.5) : cette confirmation écrit, elle exige un choix
// explicite par bouton. Ligne de quantité (spec 2.65 §6.5) affichée
// seulement si elle change — toujours absente côté Écarts, qui n'a pas de
// champ de quantité, `originalCartons`/`originalPieces` y valant toujours
// `cartonsValue`/`piecesValue`. `error` (spec 2.66 point 4, dette assumée en
// spec) : un échec d'écriture pendant la confirmation s'affichait hors de la
// modale, donc derrière le fond assombri — invisible. L'appelant garde son
// propre paragraphe d'erreur pour les échecs hors confirmation (casier
// invalide avant validation, etc.) ; celui-ci ne double que le cas où la
// modale est ouverte. Affiché avant le bloc collision et ses boutons, pas
// après : `.modal-dialog` défile en interne (max-height 80vh) et le message
// le plus long (MoveCasierLignePartialError) ne doit pas finir sous les
// boutons, dans la partie qu'il faudrait faire défiler pour lire — même
// défaut que le test 7 (spec 2.64 §6.5), un niveau plus bas.
function MoveConfirmDialog({
  move,
  t,
  saving,
  error,
  onConfirm,
  onCancel,
}: {
  move: PendingMove
  t: Dictionary
  saving: boolean
  error: string | null
  onConfirm: (mode?: 'remplacer' | 'ajouter') => void
  onCancel: () => void
}) {
  const quantityChange = moveQuantityChangeLabel(move, t)
  return (
    <Modal>
      <p>
        {interpolate(t.inventory.moveConfirm, {
          refCode: move.refCode,
          from: move.fromEmplacementCode,
          to: move.emplacementCode,
        })}
      </p>
      {quantityChange && <p>{quantityChange}</p>}
      {error && <p className="form-status form-error">{error}</p>}
      {move.collision ? (
        <>
          <p>
            {interpolate(t.inventory.moveCollisionExisting, {
              emplacement: move.emplacementCode,
              cartons: move.collision.existingCartons,
              pieces: move.collision.existingPieces,
            })}
          </p>
          <button type="button" onClick={() => onConfirm('ajouter')} disabled={saving}>
            {t.inventory.addEntry} ({move.cartonsValue + move.collision.existingCartons}c +{' '}
            {move.piecesValue + move.collision.existingPieces}p)
          </button>
          <button type="button" onClick={() => onConfirm('remplacer')} disabled={saving}>
            {t.inventory.replaceEntry} ({move.cartonsValue}c + {move.piecesValue}p)
          </button>
        </>
      ) : (
        <button type="button" onClick={() => onConfirm()} disabled={saving}>
          {t.common.confirm}
        </button>
      )}
      <button type="button" className="back-link" onClick={onCancel} disabled={saving}>
        {t.common.cancel}
      </button>
    </Modal>
  )
}

// Suggestions du champ casier, partagées entre la saisie (marche) et la
// boîte de déplacement (écarts) — spec 2.60 §6.5 : "un composant recopié
// perd ses correctifs un par un". Entrée déjà complète (tirets posés, ou
// zone+chiffres sans tiret) : résolution stricte, pas de recherche floue,
// sinon un code plus long qui partage le même préfixe compact réapparaîtrait
// à tort. Sinon, recherche floue tant que la saisie est incomplète.
function emplacementFieldSuggestions(value: string, known: string[]): { value: string; label: string }[] {
  const resolved = resolveEmplacementInput(value)
  return (
    resolved
      ? resolved === value.trim().toUpperCase()
        ? []
        : [resolved]
      : matchEmplacements(value, known)
  ).map((code) => ({ value: code, label: code }))
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
  // Quantité de la ligne éditée, capturée AU MOMENT où le mode modification
  // s'ouvre (spec 2.65 §6.5) — jamais redérivée de `saisies` au moment de
  // valider, dont la ligne peut avoir disparu entre-temps (l'opérateur
  // pouvant supprimer via le menu "…" la ligne même qu'il édite). Sert
  // uniquement à détecter et afficher un changement de quantité dans la
  // confirmation de déplacement.
  const [editingOriginalQuantity, setEditingOriginalQuantity] = useState<{ cartons: number; pieces: number } | null>(
    null,
  )
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null)
  // Étiquette de conditionnement par id, pour l'afficher dans la liste des
  // saisies (spec v2 §6.5 : "casier, référence, conditionnement, quantité")
  // — sans elle, deux lignes de la même réf sur deux conditionnements
  // distincts semblent identiques dans la liste.
  const [conditionnementLabels, setConditionnementLabels] = useState<Map<string, string>>(new Map())
  // Inventaire partiel (spec 2.54, §6.5) : liste explicite du périmètre
  // quand scope_kind === 'references' — undefined pour les deux autres
  // périmètres, sans signification particulière dans ces cas (pas
  // d'inventaire partiel à signaler sur un inventaire complet ou par
  // client, §6.5 "rien ne change").
  const [referencesScope, setReferencesScope] = useState<string[] | undefined>(undefined)
  // Confirmation avant d'écrire une référence hors périmètre (spec 2.54,
  // point 2) : jamais en silence.
  const [pendingScopeExtension, setPendingScopeExtension] = useState<PendingScopeExtension | null>(null)
  // Confirmation de déplacement en mode modification (spec 2.60 §6.5) :
  // changer le casier du formulaire pendant une édition n'est jamais un
  // update silencieux — même récapitulatif que "Déplacer" côté écarts.
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  // Rappel des références à compter (spec 2.56 §6.5) : ouvert depuis un
  // bouton, jamais affiché en flux — un déroulant en place repousserait le
  // formulaire, qui sert en permanence, pour une liste qui sert rarement.
  const [scopeChecklistOpen, setScopeChecklistOpen] = useState(false)
  // Double appui avant "Supprimer" (spec 2.58 §6.5) : action immédiate et
  // irréversible, même motif que confirmArmed/deleteArmed ailleurs dans
  // l'app. Un seul id à la fois — comparer à `entry.ligneId` dans le
  // callback du minuteur (pas un simple `null`) pour ne pas effacer
  // l'armement d'une ligne réarmée entre-temps par un second appui rapide.
  const [armedRemoveId, setArmedRemoveId] = useState<string | null>(null)
  // Menu "…" par saisie (spec 2.58 §6.5) : un seul ouvert à la fois.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // Position mesurée au clic, en coordonnées d'écran (spec 2.60 §6.5) : la
  // dernière ligne d'une liste plus longue que l'écran ouvrait un menu
  // coupé, boutons inaccessibles — `.casier-list` défile sur lui-même
  // (`overflow-y: auto`), donc un positionnement `absolute` relatif à la
  // ligne se fait rogner par cette boîte, pas seulement par le bord de
  // l'écran. `position: fixed`, calculé depuis `getBoundingClientRect()`,
  // échappe à tout ancêtre qui défile ou qui rogne — la seule mesure fiable
  // quelle que soit la hauteur d'écran ou la longueur de la liste.
  const [openMenuAnchor, setOpenMenuAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null)
  function closeEntryMenu() {
    setOpenMenuId(null)
    setOpenMenuAnchor(null)
    setArmedRemoveId(null)
  }
  // Hauteur approximative du menu (deux entrées de 44px + marges) : mieux
  // vaut une estimation généreuse qui ouvre vers le haut un peu trop tôt
  // qu'une exacte qui laisse un pixel de bouton coupé.
  const ENTRY_MENU_HEIGHT_ESTIMATE = 110
  function openEntryMenu(entry: SaisieLine, e: MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setOpenMenuAnchor({ top: rect.top, bottom: rect.bottom, right: window.innerWidth - rect.right })
    setOpenMenuId(entry.ligneId)
  }

  // Extrait pour être réappelable : au montage, sur l'événement `online`, et
  // à la volée depuis handleSave si la garde de périmètre trouve `undefined`
  // (spec 2.56 : une garde qui échoue fermé doit savoir se rouvrir). Renvoie
  // la valeur fraîchement chargée — jamais l'état React, qui ne serait à
  // jour qu'au rendu suivant et laisserait handleSave juger sur une valeur
  // périmée dans le même appel.
  const loadReferencesScope = useCallback(async (): Promise<string[] | undefined> => {
    const codes = await scopeRefCodes(inventaire)
    const resolved = inventaire.scope_kind === 'references' ? codes : undefined
    setReferencesScope(resolved)
    return resolved
  }, [inventaire])

  useEffect(() => {
    listEmplacements()
      .then((list) => setKnownEmplacements(list.map((e) => e.code)))
      .catch(() => {})
    listReferences().then(setAllReferences).catch(() => {})
    listInventaireSaisies(inventaire.id).then(setSaisies).catch(() => {})
    loadReferencesScope().catch(() => {})
  }, [inventaire, loadReferencesScope])

  // Rechargement au retour réseau (spec 2.56) : sans lui, une coupure
  // pendant la marche laissait la garde refusée en permanence — le
  // périmètre n'était rechargé qu'au montage de l'écran, jamais ensuite.
  useEffect(() => {
    if (inventaire.scope_kind !== 'references') return
    const onOnline = () => {
      loadReferencesScope().catch(() => {})
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [inventaire, loadReferencesScope])

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

  // Résolution stricte pour la navigation aux flèches (stepEmplacement) —
  // les suggestions du champ viennent de emplacementFieldSuggestions,
  // partagée avec la boîte de déplacement des écarts (spec 2.60 §6.5).
  const resolvedEmplacement = resolveEmplacementInput(emplacementCode)
  const emplacementSuggestions = emplacementFieldSuggestions(emplacementCode, knownEmplacements)

  // Inventaire partiel (spec 2.54, point 1) : la liste déroulante ne
  // propose que les références du périmètre — mais le champ reste libre,
  // un code tapé en entier est toujours accepté (voir handleSave, qui
  // propose d'étendre le périmètre plutôt que de refuser). Sans objet sur
  // un inventaire complet ou par client (`referencesScope` reste undefined).
  // Référence inactive (spec 2.66 point 4 bis) : retirée des suggestions,
  // jamais de `allReferences` lui-même — une saisie déjà comptée sur une
  // référence depuis désactivée doit garder son libellé dans la liste des
  // saisies et le rappel de périmètre (lignes 1461/1545 plus bas), qui
  // lisent `allReferences` directement. Un code tapé en entier reste
  // accepté (même règle que le périmètre partiel ci-dessus) : la
  // désactivation retire du sélecteur, elle ne bloque pas la saisie.
  const suggestableReferences = (
    inventaire.scope_kind === 'references' && referencesScope
      ? allReferences.filter((r) => referencesScope.includes(r.code))
      : allReferences
  ).filter((r) => r.actif)

  // matchReferences (db.ts) : code ("65"/"265"/"REU26" trouvent "REU265",
  // pas seulement au clavier chiffres) ET libellé par jetons normalisés
  // (§6.2, spec 2.20) — même recherche que Recherche et Mouvement.
  const referenceSuggestions = matchReferences(refCode, suggestableReferences)
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

  // Aligné sur la saisie manuelle du casier, qui n'efface jamais rien (spec
  // 2.60 §6.5, revient sur spec 2.25) : passer au casier suivant déplace la
  // cible, ce qui est déjà tapé reste tapé — y compris référence et
  // quantité, y compris en mode modification, où changer le casier aux
  // flèches est un choix de destination, pas un abandon de la correction en
  // cours. Seule la validation d'une saisie vide les champs (commitSave),
  // parce que là le contenu a été écrit quelque part. pendingDuplicate,
  // pendingScopeExtension et pendingMove restent liés à une tentative de
  // soumission précise : naviguer les referme, sans quoi une question posée
  // à l'ancien casier resterait affichée au nouveau.
  function goToEmplacement(code: string) {
    setEmplacementCode(code)
    setPendingDuplicate(null)
    setPendingScopeExtension(null)
    setPendingMove(null)
    closeEntryMenu()
  }

  const selectedConditionnement = conditionnements.find((c) => c.id === conditionnementId) ?? null
  const totalPieces = selectedConditionnement
    ? (Number(cartons) || 0) * selectedConditionnement.pieces_par_carton + (Number(pieces) || 0)
    : null
  const matchedReference = allReferences.find((r) => r.code === refCode.trim().toUpperCase()) ?? null

  // Partagée entre handleSave (chemin normal) et confirmScopeExtension
  // (après avoir accepté d'étendre le périmètre) : le contrôle de doublon
  // ne change pas selon la façon dont on y arrive. En mode modification, la
  // question ne disparaît pas — elle change de cible (spec 2.61 §6.5,
  // corrige une erreur de 2.60) :
  //   - collision AVEC SOI-MÊME (sameKey(editingKey, key)) : le triplet ne
  //     change pas, ce n'est pas une collision, c'est l'objet même de la
  //     correction — aucune question.
  //   - collision avec une AUTRE ligne déjà présente à la destination :
  //     exactement le cas pour lequel la question a été écrite. Deux
  //     comptages réels distincts (deux étagères effectivement comptées)
  //     se retrouveraient au même endroit ; écraser sans demander perd l'un
  //     des deux sans trace. La question se pose donc à la destination,
  //     avant écriture — resolveDuplicate appelle ensuite commitSave avec
  //     `key` (la destination), qui détecte lui-même le déplacement
  //     (editingKey encore défini, différent de `key`) et retire la ligne
  //     d'origine dans les deux branches, remplacer comme ajouter.
  function checkDuplicateThenSave(key: EntryKey, cartonsValue: number, piecesValue: number): Promise<void> {
    if (editingKey && sameKey(editingKey, key)) return commitSave(key, cartonsValue, piecesValue)
    const existing = saisies.find((s) => sameKey(s, key))
    if (existing) {
      setStatus({ kind: 'idle' })
      setPendingDuplicate({
        ...key,
        existingCartons: existing.cartons,
        existingPieces: existing.pieces,
        cartonsValue,
        piecesValue,
      })
      return Promise.resolve()
    }
    return commitSave(key, cartonsValue, piecesValue)
  }

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

      // Inventaire partiel (spec 2.56) : si le périmètre n'a pas fini de
      // charger (ou que son chargement a échoué), tenter d'abord de le
      // recharger — ne refuser que si cette tentative échoue elle-même.
      // `scope` (variable locale), jamais `referencesScope` (état React),
      // sert de base au reste de cet appel : un `setState` ne relit pas
      // dans la même fermeture, un contrôle fait juste après sur
      // `referencesScope` verrait encore `undefined` même en cas de succès.
      let scope = referencesScope
      if (inventaire.scope_kind === 'references' && !scope) {
        scope = await loadReferencesScope().catch(() => undefined)
        if (!scope) {
          setStatus({ kind: 'error', message: t.inventory.scopeLoadError })
          return
        }
      }

      // Inventaire partiel (spec 2.54, point 2) : jamais enregistrer une
      // référence hors périmètre en silence — proposer d'étendre le
      // périmètre d'abord. Priorité sur le contrôle de doublon ci-dessous :
      // tant que la référence n'est pas dans le périmètre, la question à
      // trancher est "appartient-elle à cet inventaire", pas "remplacer ou
      // ajouter".
      if (inventaire.scope_kind === 'references' && scope && !scope.includes(code)) {
        setStatus({ kind: 'idle' })
        setPendingScopeExtension({ ...key, cartonsValue, piecesValue })
        return
      }

      // Mode modification : le casier du formulaire est la destination
      // (spec 2.60 §6.5). Le changer n'est pas une correction de champ,
      // c'est un déplacement — même récapitulatif de confirmation que
      // "Déplacer" côté écarts, jamais un update silencieux. Référence ou
      // conditionnement changés SANS le casier ne posent pas cette
      // question : seul le casier rend le déplacement visible pour
      // l'opérateur (spec 2.59 les traite identiquement en écriture, mais
      // spec 2.60 ne demande la confirmation que sur celui-ci).
      if (editingKey && editingKey.emplacementCode !== key.emplacementCode) {
        setStatus({ kind: 'idle' })
        // Collision détectée ICI, avant de poser la question (spec 2.62
        // §6.5) : pour fusionner "déplacer ?" et "remplacer ou ajouter ?"
        // en un seul écran plutôt que de les enchaîner. Recherche dans
        // `saisies` (état local), jamais une relecture serveur — même
        // règle que resolveDuplicate, et pour la même raison.
        const existing = saisies.find((s) => sameKey(s, key))
        setPendingMove(
          buildPendingMove({
            key,
            fromEmplacementCode: editingKey.emplacementCode,
            cartonsValue,
            piecesValue,
            // Capturée à l'ouverture du mode modification (editEntry), jamais
            // redérivée de `saisies` ici — cette ligne peut avoir disparu de
            // l'état local entre-temps (spec 2.65 §6.5, voir commentaire sur
            // `editingOriginalQuantity`).
            originalCartons: editingOriginalQuantity?.cartons ?? cartonsValue,
            originalPieces: editingOriginalQuantity?.pieces ?? piecesValue,
            existingAtTarget: existing ? { cartons: existing.cartons, pieces: existing.pieces } : undefined,
          }),
        )
        return
      }

      await checkDuplicateThenSave(key, cartonsValue, piecesValue)
    } catch (err) {
      setStatus({ kind: 'error', message: describeSaveError(err, t) })
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

    // Correction via "Modifier" (spec 2.58, §6.5) : dès que le triplet
    // (casier, réf, conditionnement) change — pas seulement le casier —
    // ce n'est PAS une simple écriture à la nouvelle clé : la ligne
    // d'origine doit disparaître de son comptage d'origine, sinon elle se
    // retrouve comptée aux deux endroits (le même défaut existe qu'on
    // corrige le casier ou la référence — advisor l'a relevé après une
    // première version qui ne couvrait que le casier). Même chemin que
    // "Déplacer" sur l'écran des écarts (moveCasierLigne), jamais un
    // update de comptages.emplacement_code.
    const relocatingFrom =
      editingKey && !sameKey(editingKey, key) ? saisies.find((s) => sameKey(s, editingKey)) : undefined

    let comptageId: string
    if (relocatingFrom) {
      const result = await moveCasierLigne(
        inventaire.id,
        ligneId,
        ligneTs,
        {
          comptageId: relocatingFrom.comptageId,
          refCode: relocatingFrom.refCode,
          conditionnementId: relocatingFrom.conditionnementId,
        },
        { emplacementCode: key.emplacementCode, refCode: key.refCode, conditionnementId: key.conditionnementId, cartons: cartonsValue, pieces: piecesValue },
        auteur,
      )
      comptageId = result.comptageId
    } else {
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
      comptageId = comptage.id
    }

    setEmplacementCode(key.emplacementCode) // forme canonique réellement enregistrée (ex. "A11" -> "A-01-1")
    setSaisies((prev) => [
      {
        ligneId,
        comptageId,
        emplacementCode: key.emplacementCode,
        refCode: key.refCode,
        conditionnementId: key.conditionnementId,
        cartons: cartonsValue,
        pieces: piecesValue,
        ts: ligneTs,
      },
      ...prev.filter((s) => !sameKey(s, key) && !(relocatingFrom && s.ligneId === relocatingFrom.ligneId)),
    ])

    setRefCode('')
    setConditionnements([])
    setConditionnementId(null)
    setCartons('')
    setPieces('')
    setEditingKey(null)
    setEditingOriginalQuantity(null)
    setPendingDuplicate(null)
    setStatus({ kind: 'idle' })
  }

  // "Ajouter" somme sur la valeur LOCALE (`existingCartons`/`existingPieces`,
  // déjà connue au moment où la collision a été détectée), jamais une
  // relecture serveur (spec 2.62 §6.5, revient sur une règle antérieure
  // écrite pour la raison inverse) : sur un seul appareil, l'état local est
  // la vue la PLUS complète, puisqu'il intègre les écritures encore en file
  // hors ligne que le serveur ignore encore — une relecture donnerait la
  // mauvaise valeur précisément quand une saisie est en attente, et
  // poserait une dépendance réseau au milieu d'une confirmation, en allée,
  // où la coupure est le cas courant. Cette règle ne tient QUE tant qu'un
  // seul appareil écrit — voir §14 : le jour d'un second compteur,
  // l'addition doit devenir un incrément atomique côté serveur.
  async function resolveDuplicate(mode: 'remplacer' | 'ajouter') {
    if (!pendingDuplicate) return
    const { cartonsValue, piecesValue, existingCartons, existingPieces } = pendingDuplicate
    const key: EntryKey = {
      emplacementCode: pendingDuplicate.emplacementCode,
      refCode: pendingDuplicate.refCode,
      conditionnementId: pendingDuplicate.conditionnementId,
    }
    setStatus({ kind: 'saving' })
    try {
      const finalCartons = mode === 'ajouter' ? cartonsValue + existingCartons : cartonsValue
      const finalPieces = mode === 'ajouter' ? piecesValue + existingPieces : piecesValue
      // En mode modification (editingKey encore défini, différent de `key`
      // puisque c'est ce qui a déclenché la collision) : commitSave détecte
      // lui-même le déplacement et retire la ligne d'origine, remplacer
      // comme ajouter (spec 2.61 §6.5) — rien de spécial à faire ici.
      await commitSave(key, finalCartons, finalPieces)
    } catch (err) {
      setStatus({ kind: 'error', message: describeSaveError(err, t) })
    }
  }

  function cancelDuplicate() {
    setPendingDuplicate(null)
    setStatus({ kind: 'idle' })
  }

  // "Oui" à « ajouter au périmètre » (spec 2.54, point 2) : la référence
  // entre dans inventaire_references, puis la saisie suit son chemin
  // normal (contrôle de doublon inclus — une référence hors périmètre
  // ajoutée peut très bien être une correction d'une saisie déjà là).
  async function confirmScopeExtension() {
    if (!pendingScopeExtension) return
    const { cartonsValue, piecesValue, ...key } = pendingScopeExtension
    setStatus({ kind: 'saving' })
    try {
      await addReferenceToScope(inventaire.id, key.refCode)
      setReferencesScope((prev) => (prev ? [...prev, key.refCode] : [key.refCode]))
      setPendingScopeExtension(null)
      await checkDuplicateThenSave(key, cartonsValue, piecesValue)
    } catch (err) {
      setStatus({ kind: 'error', message: describeSaveError(err, t) })
    }
  }

  // "Non" : rien n'est écrit (spec 2.54, point 2) — jamais en silence,
  // jamais forcé non plus.
  function cancelScopeExtension() {
    setPendingScopeExtension(null)
    setStatus({ kind: 'idle' })
  }

  // Confirmation du déplacement en mode modification (spec 2.62 §6.5) : la
  // collision, s'il y en a une, a déjà été détectée quand pendingMove a été
  // posé — appelle directement commitSave (jamais checkDuplicateThenSave,
  // qui reposerait une question déjà résolue ici), qui détecte lui-même le
  // déplacement en comparant le triplet avant/après et retire la ligne
  // d'origine. `mode` n'a de sens que si pendingMove.collision existe ;
  // absent sinon (simple confirmation, pas de choix à faire).
  async function confirmPendingMove(mode?: 'remplacer' | 'ajouter') {
    if (!pendingMove) return
    // Reconstruit explicitement plutôt qu'un rest-spread : PendingMove porte
    // des champs qu'EntryKey n'a pas, un rest-spread les aurait laissés
    // traîner dans `key` sans que tsc s'en plaigne (assignable, pas exact).
    const key: EntryKey = {
      emplacementCode: pendingMove.emplacementCode,
      refCode: pendingMove.refCode,
      conditionnementId: pendingMove.conditionnementId,
    }
    setStatus({ kind: 'saving' })
    try {
      const { cartons: finalCartons, pieces: finalPieces } = computeMoveFinalQuantity(pendingMove, mode)
      await commitSave(key, finalCartons, finalPieces)
      setPendingMove(null)
    } catch (err) {
      setStatus({ kind: 'error', message: describeSaveError(err, t) })
    }
  }

  function cancelPendingMove() {
    setPendingMove(null)
    setStatus({ kind: 'idle' })
  }

  async function undo(entry: SaisieLine) {
    await deleteCasierLignesForRef(entry.comptageId, entry.refCode, entry.conditionnementId)
    setSaisies((prev) => prev.filter((s) => !sameKey(s, entry)))
  }

  // Double appui (spec 2.58 §6.5) : premier appui arme (fond rouge, texte
  // blanc), retombe seul après 3 s ; second appui, pendant que c'est encore
  // armé, exécute réellement la suppression. Comparer à `entry.ligneId` dans
  // le minuteur, jamais mettre `null` sans condition : un second appui
  // rapide sur une AUTRE ligne pendant la fenêtre de 3 s ne doit pas être
  // effacé par le minuteur de la première.
  function handleRemoveClick(entry: SaisieLine) {
    if (armedRemoveId !== entry.ligneId) {
      setArmedRemoveId(entry.ligneId)
      setTimeout(() => {
        setArmedRemoveId((current) => (current === entry.ligneId ? null : current))
      }, 3000)
      return
    }
    setOpenMenuId(null)
    setArmedRemoveId(null)
    void undo(entry)
  }

  // Remonte au formulaire de saisie, préempli, en mode modification visible
  // (spec 2.60 §6.5, revient sur spec 2.56 : plus de second chemin
  // d'édition sur l'écran des écarts pour la marche — c'est là qu'on
  // saisit, c'est donc là qu'on corrige). Pas de suppression :
  // réenregistrer crée simplement une nouvelle ligne plus récente pour le
  // même triplet (casier, réf, conditionnement), qui prévaut sur
  // l'ancienne (dernière valeur connue), en gardant l'historique complet.
  async function editEntry(entry: SaisieLine) {
    setEmplacementCode(entry.emplacementCode)
    setRefCode(entry.refCode)
    setCartons(String(entry.cartons))
    setPieces(String(entry.pieces))
    setStatus({ kind: 'idle' })
    setPendingDuplicate(null)
    setPendingScopeExtension(null)
    setPendingMove(null)
    setArmedRemoveId(null)
    setEditingKey({
      emplacementCode: entry.emplacementCode,
      refCode: entry.refCode,
      conditionnementId: entry.conditionnementId,
    })
    setEditingOriginalQuantity({ cartons: entry.cartons, pieces: entry.pieces })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    const list = await listConditionnements(entry.refCode)
    setConditionnements(list)
    setConditionnementId(entry.conditionnementId)
  }

  // Sortie du mode modification sans écrire (spec 2.60 §6.5) : le formulaire
  // doit offrir cette sortie visiblement, pas seulement se refermer au
  // prochain enregistrement.
  function cancelEdit() {
    setEditingKey(null)
    setEditingOriginalQuantity(null)
    setRefCode('')
    setConditionnements([])
    setConditionnementId(null)
    setCartons('')
    setPieces('')
    setStatus({ kind: 'idle' })
    setPendingDuplicate(null)
    setPendingScopeExtension(null)
    setPendingMove(null)
  }

  return (
    <main className="inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.title}</h1>

      <form className="settings-form" onSubmit={handleSave}>
        {/* Mode modification visible (spec 2.60 §6.5) : le formulaire dit
            quelle ligne il modifie et offre une sortie sans écrire — jamais
            un second champ de saisie sous la ligne, une seule surface
            d'édition sur cet écran. */}
        {editingKey && (
          <p className="form-status editing-banner">
            {interpolate(t.inventory.editingBanner, {
              refCode: editingKey.refCode,
              emplacement: editingKey.emplacementCode,
            })}
            <button type="button" className="back-link" onClick={cancelEdit} disabled={status.kind === 'saving'}>
              {t.common.cancel}
            </button>
          </p>
        )}
        <label className="field-label">
          {t.inventory.casier}
          <div className="casier-nav">
            <button
              type="button"
              className="step-button"
              onClick={() => stepEmplacement(-1)}
              disabled={status.kind === 'saving' || pendingDuplicate !== null || pendingScopeExtension !== null || pendingMove !== null}
              aria-label={t.inventory.previousCasier}
            >
              ←
            </button>
            <ComboInput
              value={emplacementCode}
              onChange={setEmplacementCode}
              suggestions={emplacementSuggestions}
              placeholder={t.inventory.casierPlaceholder}
              disabled={status.kind === 'saving' || pendingDuplicate !== null || pendingScopeExtension !== null || pendingMove !== null}
              selectOnFocus
            />
            <button
              type="button"
              className="step-button"
              onClick={() => stepEmplacement(1)}
              disabled={status.kind === 'saving' || pendingDuplicate !== null || pendingScopeExtension !== null || pendingMove !== null}
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
            disabled={status.kind === 'saving' || pendingDuplicate !== null || pendingScopeExtension !== null || pendingMove !== null}
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
        <button type="submit" disabled={status.kind === 'saving' || pendingDuplicate !== null || pendingScopeExtension !== null || pendingMove !== null}>
          {t.common.save}
        </button>
        {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
      </form>

      {/* Rappel des références à compter (spec 2.54 point 3, repositionné en
          spec 2.56 §6.5) : en inventaire partiel uniquement — sur un
          périmètre complet ou par client, ce serait une liste de trois
          cents lignes, du bruit. Sorti du flux — le formulaire sert en
          permanence, la liste sert rarement — et ouvert depuis ce simple
          bouton, sans compteur de progression (ni ici ni dans la fenêtre) :
          "4 sur 12 comptées" laisserait croire qu'il n'y a plus rien à
          compter sur une référence déjà rencontrée une fois. */}
      {inventaire.scope_kind === 'references' && referencesScope && (
        <button type="button" className="checklist-toggle" onClick={() => setScopeChecklistOpen(true)}>
          {t.inventory.scopeChecklistTitle}
        </button>
      )}

      {scopeChecklistOpen && referencesScope && (
        <Modal onClose={() => setScopeChecklistOpen(false)}>
          <h2>{t.inventory.scopeChecklistTitle}</h2>
          {/* Liste uniforme, sans marqueur d'état (spec 2.58 §6.5,
              revient sur spec 2.54) : une référence éparpillée sur
              plusieurs casiers reste à compter ailleurs même une fois
              rencontrée une fois — la griser ou dire "comptée dans N
              casier(s)" laisserait croire à une complétude que rien ne
              garantit. Même raisonnement que l'abandon du compteur
              "4/12 comptées". Tri alphabétique fixe (naturel : les codes
              REU003/REU009/REU010 partagent la même largeur de suffixe,
              donc l'ordre lexicographique suffit déjà), position stable
              d'une ouverture à l'autre. */}
          <ul className="casier-list">
            {[...referencesScope].sort().map((code) => {
              const libelle = allReferences.find((r) => r.code === code)?.libelle
              return (
                <li key={code} className="casier-row checklist-row">
                  <span>
                    {code}
                    {libelle ? ` — ${libelle}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </Modal>
      )}

      {/* Fenêtre modale sans `onClose` (spec 2.63 §6.5) : cette confirmation
          écrit, elle exige donc un choix explicite par bouton — pas de
          fermeture au toucher extérieur. Partage le même risque de
          position que le test 7 (spec 2.64 §6.5), et se déclenche plus
          souvent : à chaque référence déjà relevée au même casier. */}
      {pendingDuplicate && (
        <Modal>
          <p>
            {interpolate(t.inventory.duplicateEntry, {
              emplacement: pendingDuplicate.emplacementCode,
              refCode: pendingDuplicate.refCode,
              cartons: pendingDuplicate.existingCartons,
              pieces: pendingDuplicate.existingPieces,
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
        </Modal>
      )}

      {/* Fenêtre modale sans `onClose` (spec 2.63 §6.5) : même raison que
          pendingDuplicate ci-dessus — cette confirmation écrit. */}
      {pendingScopeExtension && (
        <Modal>
          <p>
            {interpolate(t.inventory.scopeExtensionQuestion, { refCode: pendingScopeExtension.refCode })}
          </p>
          <button type="button" onClick={confirmScopeExtension} disabled={status.kind === 'saving'}>
            {t.common.confirm}
          </button>
          <button
            type="button"
            className="back-link"
            onClick={cancelScopeExtension}
            disabled={status.kind === 'saving'}
          >
            {t.common.cancel}
          </button>
        </Modal>
      )}

      {/* Déplacement en mode modification (spec 2.60 §6.5) — confirmation
          rendue par le composant partagé MoveConfirmDialog (spec 2.66 point
          4 ter), commun à la marche et aux Écarts. Voir le commentaire sur
          MoveConfirmDialog pour le détail des règles qu'il applique. */}
      {pendingMove && (
        <MoveConfirmDialog
          move={pendingMove}
          t={t}
          saving={status.kind === 'saving'}
          error={status.kind === 'error' ? status.message : null}
          onConfirm={confirmPendingMove}
          onCancel={cancelPendingMove}
        />
      )}

      {saisies.length > 0 && (
        <ul className="casier-list saisies-list">
          {(showAllSaisies ? saisies : saisies.slice(0, 20)).map((entry) => {
            // Libellé de la référence, pas seulement du conditionnement
            // (§6.2/§6.5, spec 2.23) : confirme après coup qu'on a compté
            // la bonne référence, comme la ligne sous le champ le confirme
            // avant.
            const refLibelle = allReferences.find((r) => r.code === entry.refCode)?.libelle
            return (
              <li key={entry.ligneId}>
                {/* Trois lignes (spec 2.58 §6.5) : une saisie tenait sur une
                    seule ligne trop chargée, qui prenait trop de place à
                    l'écran. Emplacement / référence+libellé / quantité,
                    chacun sur sa propre ligne. */}
                <div className="casier-row">
                  <div className="entry-lines">
                    <span className="entry-line-emplacement">{entry.emplacementCode}</span>
                    <span className="entry-line-reference">
                      {entry.refCode}
                      {refLibelle ? ` — ${refLibelle}` : ''}
                    </span>
                    <span className="entry-line-quantity">
                      {conditionnementLabels.has(entry.conditionnementId)
                        ? `(${conditionnementLabels.get(entry.conditionnementId)}) `
                        : ''}
                      {entry.cartons}c + {entry.pieces}p
                    </span>
                  </div>
                  <div className="entry-menu-wrapper">
                    <button
                      type="button"
                      className="entry-menu-toggle"
                      aria-label={t.inventory.entryMenuLabel}
                      onClick={(e) => (openMenuId === entry.ligneId ? closeEntryMenu() : openEntryMenu(entry, e))}
                    >
                      ⋯
                    </button>
                    {openMenuId === entry.ligneId && openMenuAnchor && (
                      <>
                        <div className="menu-scrim" onClick={closeEntryMenu} />
                        <div
                          className="entry-menu"
                          style={
                            window.innerHeight - openMenuAnchor.bottom < ENTRY_MENU_HEIGHT_ESTIMATE
                              ? { bottom: window.innerHeight - openMenuAnchor.top + 4, right: openMenuAnchor.right }
                              : { top: openMenuAnchor.bottom + 4, right: openMenuAnchor.right }
                          }
                        >
                          <button
                            type="button"
                            className="entry-menu-item"
                            onClick={() => {
                              closeEntryMenu()
                              editEntry(entry)
                            }}
                          >
                            {t.inventory.editLine}
                          </button>
                          {/* Double appui conservé, à l'intérieur du menu
                              (spec 2.58 §6.5) : action immédiate et
                              irréversible — premier appui arme (fond rouge,
                              texte blanc), second exécute, retombe seul
                              après 3 s. Vocabulaire "Supprimer", jamais
                              "Annuler" (réservé à l'abandon/la clôture). */}
                          <button
                            type="button"
                            className={`entry-menu-item entry-menu-item-danger${armedRemoveId === entry.ligneId ? ' armed' : ''}`}
                            onClick={() => handleRemoveClick(entry)}
                          >
                            {armedRemoveId === entry.ligneId ? t.inventory.removeArmed : t.inventory.removeLine}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
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
  // Feuille de contre-validation (spec 2.49) : source = journal complet des
  // saisies, PAS `references`/`parEmplacement` (filtrée par
  // getInventaireSynthese sur statut === 'clos', dette §14) — un document
  // censé être complet ne peut pas hériter de ce filtre fragile.
  const [saisies, setSaisies] = useState<SaisieLine[]>([])
  const [refLibelleByCode, setRefLibelleByCode] = useState<Map<string, string | null>>(new Map())
  const [conditionnementById, setConditionnementById] = useState<Map<string, Conditionnement>>(new Map())
  // Titre du document imprimé (spec 2.52) : liste explicite des codes du
  // périmètre pour scope_kind === 'references' — undefined pour les deux
  // autres périmètres, sans signification particulière dans ces cas.
  const [referencesScope, setReferencesScope] = useState<string[] | undefined>(undefined)
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [editingLigneId, setEditingLigneId] = useState<string | null>(null)
  const [editCartons, setEditCartons] = useState('')
  const [editPieces, setEditPieces] = useState('')
  const [editStatus, setEditStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  // Double appui sur Supprimer (spec 2.58 §6.5) : un seul panneau d'édition
  // ouvert à la fois (editingLigneId), donc un seul booléen suffit — remis
  // à zéro à chaque ouverture/fermeture de panneau (voir toggleEdit).
  const [deleteArmed, setDeleteArmed] = useState(false)
  // Déplacement d'une saisie vers un autre casier (spec 2.58 §6.5) :
  // moveTarget est la saisie brute ; pendingMove, construit par
  // buildPendingMove une fois le casier validé, porte le récapitulatif ET
  // la collision de destination éventuelle (spec 2.66 point 4 ter — même
  // type et même composant de confirmation que la marche, `MoveConfirmDialog`
  // ; seule la source des données diffère : `ref.parEmplacement` ici,
  // `saisies` côté marche).
  const [movingLigneId, setMovingLigneId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [moveStatus, setMoveStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  // Pour les suggestions du champ casier de la boîte de déplacement (spec
  // 2.60 §6.5, emplacementFieldSuggestions) — même liste que la marche.
  const [knownEmplacements, setKnownEmplacements] = useState<string[]>([])
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

  // Inventaire partiel (spec 2.54, point 2/4) : une saisie hors périmètre
  // déjà enregistrée n'est jamais ignorée (voir getInventaireSynthese, qui
  // bucketise toute référence réellement comptée) — elle est marquée
  // "hors périmètre" ici, avec la même action que côté saisie.
  const [scopeActionError, setScopeActionError] = useState<string | null>(null)
  async function addToScope(refCode: string) {
    setScopeActionError(null)
    try {
      await addReferenceToScope(inventaire.id, refCode)
      setReferencesScope((prev) => (prev ? [...prev, refCode] : [refCode]))
      await refresh()
    } catch (err) {
      setScopeActionError(extractErrorMessage(err, t.common.unknownError))
    }
  }

  useEffect(() => {
    let cancelled = false
    listClients().then((list) => {
      if (!cancelled) setClients(list)
    }).catch(() => {})
    // Best-effort, comme listClients ci-dessus : sert seulement les
    // suggestions du champ casier de la boîte de déplacement, jamais les
    // chiffres imprimés — un échec ne doit pas bloquer l'écran des écarts.
    listEmplacements()
      .then((list) => {
        if (!cancelled) setKnownEmplacements(list.map((e) => e.code))
      })
      .catch(() => {})
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
      scopeRefCodes(inventaire),
    ])
      .then(([synthese, saisieList, refList, condByRef, refScope]) => {
        if (cancelled) return
        setReferences(synthese.references)
        setSaisies(saisieList)
        setRefLibelleByCode(new Map(refList.map((r) => [r.code, r.libelle])))
        const byId = new Map<string, Conditionnement>()
        for (const list of condByRef.values()) for (const c of list) byId.set(c.id, c)
        setConditionnementById(byId)
        setReferencesScope(inventaire.scope_kind === 'references' ? refScope : undefined)
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
    setDeleteArmed(false)
    cancelMove()
  }

  // Ouvre/ferme le panneau d'édition — remet l'armement de Supprimer et le
  // déplacement en cours à zéro dans les deux cas (spec 2.58 §6.5) : rouvrir
  // le panneau, ou en ouvrir un autre, ne doit jamais hériter d'un état
  // laissé par la ligne précédente.
  function toggleEdit(l: SyntheseLigneEmplacement) {
    if (editingLigneId === l.ligneId) {
      setEditingLigneId(null)
      setDeleteArmed(false)
      cancelMove()
    } else {
      startEdit(l)
    }
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

  // Double appui (spec 2.58 §6.5) : elle partait au premier appui —
  // corrigé, même motif que partout ailleurs dans l'app pour une action
  // immédiate et irréversible. Un seul panneau d'édition ouvert à la fois,
  // donc un simple booléen suffit (pas besoin de comparer un id).
  function handleDeleteEditClick(ref: SyntheseReference, l: SyntheseLigneEmplacement) {
    if (!deleteArmed) {
      setDeleteArmed(true)
      setTimeout(() => setDeleteArmed(false), 3000)
      return
    }
    setDeleteArmed(false)
    void deleteEdit(ref, l)
  }

  // Déplacement d'une saisie vers un autre casier (spec 2.58 §6.5) : jamais
  // un update de comptages.emplacement_code — voir moveCasierLigne
  // (inventaireDb.ts), même chemin que "Modifier" dans la marche quand le
  // casier change. Confirmation simple avec récapitulatif, PAS un double
  // appui : rien n'est détruit, le contenu est relocalisé. Le casier cible
  // se valide comme à la saisie (parseEmplacementCode/resolveEmplacementInput,
  // abréviations acceptées) ; il n'a pas à appartenir au périmètre de
  // l'inventaire, qui ne porte que sur les références. Si le casier cible
  // porte déjà une saisie pour ce triplet (collision), un déplacement qui
  // écrirait par-dessus sans poser la question détruirait silencieusement
  // le comptage de destination — même règle et même écran fusionné que la
  // marche (spec 2.62 §6.5) : Ajouter/Remplacer avec totaux sur les
  // boutons, jamais un "confirmer" muet.
  function startMove(l: SyntheseLigneEmplacement) {
    setMovingLigneId(l.ligneId)
    setMoveTarget('')
    setPendingMove(null)
    setMoveStatus({ kind: 'idle' })
  }

  function cancelMove() {
    setMovingLigneId(null)
    setMoveTarget('')
    setPendingMove(null)
    setMoveStatus({ kind: 'idle' })
  }

  function validateMoveTarget(ref: SyntheseReference, l: SyntheseLigneEmplacement) {
    const typed = moveTarget.trim().toUpperCase()
    const targetCode = parseEmplacementCode(typed) ? typed : resolveEmplacementInput(typed) ?? typed
    if (!targetCode || !parseEmplacementCode(targetCode)) {
      setMoveStatus({ kind: 'error', message: t.inventory.invalidEmplacement })
      return
    }
    if (targetCode === l.emplacementCode) {
      setMoveStatus({ kind: 'error', message: t.inventory.moveSameEmplacement })
      return
    }
    setMoveStatus({ kind: 'idle' })
    const existing = ref.parEmplacement.find((x) => x.emplacementCode === targetCode && x.compte !== null)
    // Écarts n'a pas de champ de quantité (spec 2.65 §6.5) : original =
    // valeur déplacée, donc moveQuantityChangeLabel ne s'affiche jamais ici
    // — pas un cas particulier, une conséquence de valeurs égales.
    setPendingMove(
      buildPendingMove({
        key: { emplacementCode: targetCode, refCode: ref.refCode, conditionnementId: ref.conditionnementId },
        fromEmplacementCode: l.emplacementCode,
        cartonsValue: l.cartons ?? 0,
        piecesValue: l.pieces ?? 0,
        originalCartons: l.cartons ?? 0,
        originalPieces: l.pieces ?? 0,
        existingAtTarget: existing ? { cartons: existing.cartons ?? 0, pieces: existing.pieces ?? 0 } : undefined,
      }),
    )
  }

  async function confirmMove(ref: SyntheseReference, l: SyntheseLigneEmplacement, mode?: 'remplacer' | 'ajouter') {
    if (!auteur || !l.comptageId || !pendingMove) return
    const ligneId = crypto.randomUUID()
    const ligneTs = new Date().toISOString()
    setMoveStatus({ kind: 'saving' })
    try {
      await ensureEmplacement(pendingMove.emplacementCode)
      const { cartons: finalCartons, pieces: finalPieces } = computeMoveFinalQuantity(pendingMove, mode)
      await moveCasierLigne(
        inventaire.id,
        ligneId,
        ligneTs,
        { comptageId: l.comptageId, refCode: ref.refCode, conditionnementId: ref.conditionnementId },
        {
          emplacementCode: pendingMove.emplacementCode,
          refCode: ref.refCode,
          conditionnementId: ref.conditionnementId,
          cartons: finalCartons,
          pieces: finalPieces,
        },
        auteur,
      )
      cancelMove()
      setEditingLigneId(null)
      await refresh()
    } catch (err) {
      setMoveStatus({ kind: 'error', message: describeSaveError(err, t) })
      // Déplacement partiel : la ligne existe réellement aux deux casiers
      // en base malgré l'erreur — rafraîchir pour que l'écran le montre,
      // plutôt que de laisser afficher un état déjà faux.
      if (err instanceof MoveCasierLignePartialError) await refresh()
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
          references.map((r) => ({ code: r.refCode, libelle: r.refLibelle, client_code: '', actif: true })),
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
    // Inventaire partiel (spec 2.54, points 2 et 4) : une saisie hors
    // périmètre n'est jamais ignorée par cet écran (voir getInventaireSynthese),
    // mais rien ne la distinguait d'un écart ordinaire — marquée ici, avec
    // la même action "ajouter au périmètre" que côté saisie.
    const outOfScope =
      inventaire.scope_kind === 'references' && referencesScope !== undefined && !referencesScope.includes(ref.refCode)
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

        {outOfScope && (
          <div className="quantity-row">
            <span className="ecart-badge ecart-reel">{t.inventory.scopeOutOfPerimeter}</span>
            <button type="button" onClick={() => addToScope(ref.refCode)}>
              {t.inventory.scopeAddButton}
            </button>
          </div>
        )}

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
                  <button type="button" className="casier-row" onClick={() => toggleEdit(l)}>
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
                      {/* Double appui (spec 2.58 §6.5) : elle partait au
                          premier appui — corrigé, même motif que partout
                          ailleurs pour une action immédiate et
                          irréversible. */}
                      <button
                        type="button"
                        className={`entry-menu-item-danger${deleteArmed ? ' armed' : ''}`}
                        onClick={() => handleDeleteEditClick(ref, l)}
                        disabled={editStatus.kind === 'saving'}
                      >
                        {deleteArmed ? t.inventory.removeArmed : t.inventory.deleteEntry}
                      </button>
                      {editStatus.kind === 'error' && <p className="form-status form-error">{editStatus.message}</p>}

                      {/* Déplacement vers un autre casier (spec 2.58 §6.5) :
                          confirmation simple avec récapitulatif, pas de
                          double appui — rien n'est détruit, le contenu est
                          relocalisé. Champ casier partagé avec la saisie
                          (ComboInput + emplacementFieldSuggestions, spec
                          2.60 §6.5) — un champ recopié perd ses correctifs
                          un par un. Confirmation rendue par le composant
                          partagé MoveConfirmDialog (spec 2.66 point 4 ter),
                          commun à la marche et aux Écarts — seule la source
                          de la collision diffère (`ref.parEmplacement` ici,
                          `saisies` côté marche). */}
                      {movingLigneId === l.ligneId ? (
                        <div className="settings-form">
                          <label className="field-label">
                            {t.inventory.casier}
                            <ComboInput
                              value={moveTarget}
                              onChange={(value) => {
                                setMoveTarget(value)
                                setPendingMove(null)
                              }}
                              suggestions={emplacementFieldSuggestions(moveTarget, knownEmplacements)}
                              placeholder={t.inventory.casierPlaceholder}
                              disabled={moveStatus.kind === 'saving'}
                            />
                          </label>
                          {!pendingMove ? (
                            <button
                              type="button"
                              onClick={() => validateMoveTarget(ref, l)}
                              disabled={!moveTarget.trim() || moveStatus.kind === 'saving'}
                            >
                              {t.common.validate}
                            </button>
                          ) : (
                            <MoveConfirmDialog
                              move={pendingMove}
                              t={t}
                              saving={moveStatus.kind === 'saving'}
                              error={moveStatus.kind === 'error' ? moveStatus.message : null}
                              onConfirm={(mode) => confirmMove(ref, l, mode)}
                              onCancel={cancelMove}
                            />
                          )}
                          {moveStatus.kind === 'error' && <p className="form-status form-error">{moveStatus.message}</p>}
                        </div>
                      ) : (
                        <button type="button" className="back-link" onClick={() => startMove(l)}>
                          {t.inventory.moveEntry}
                        </button>
                      )}
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
  const printScopeValue = printScope(inventaire, clients, referencesScope)
  const workDate = workDateLabel(saisies, inventaire.created_at)
  const frozenDate = formatPrintDate(inventaire.frozen_ts)

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
        {scopeActionError && <p className="form-status form-error">{scopeActionError}</p>}

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
        <h1>{PRINT_JA.titreSynthese}</h1>
        <p className="print-banner">{PRINT_JA.statut}</p>
        <p>
          {PRINT_JA.perimetre}：{printScopeValue}
        </p>
        <p>
          {PRINT_JA.dateComptage}：{workDate}
        </p>
        <p>
          {PRINT_JA.dateGel}：{frozenDate}
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

        {/* Feuille de contre-validation (spec 2.49-2.53) : second document,
            un saut de page plus loin — le relevé complet du comptage, une
            ligne par saisie. Source : `saisies` (listInventaireSaisies),
            PAS `references`/`parEmplacement` — cette dernière est filtrée
            par `getInventaireSynthese` sur `statut === 'clos'` (dette
            §14 sur `comptages.statut`), donc un casier dont le marquage
            "visité" aurait échoué disparaîtrait silencieusement d'une
            feuille censée être complète. `listInventaireSaisies` existe
            précisément sans ce filtre. Triée par RÉFÉRENCE puis
            emplacement (révision du 19 septembre, spec 2.52) : l'usage
            réel est la revérification ciblée d'une ligne fautive, qui part
            de la référence — pas un contrôle en marchant, qui aurait voulu
            l'ordre de tournée. Bénéfice supplémentaire : même ordre qu'en
            page 1. Son propre titre et son propre bloc 対象/date (spec
            2.50) : cette feuille est faite pour être détachée et emportée
            dans l'entrepôt — sans eux, séparée de la page 1, elle redevient
            une liste anonyme de nombres alors que c'est elle qui sera
            signée. */}
        <div className="print-page-break">
          <h1>{PRINT_JA.titreConfirmation}</h1>
          <p>
            {PRINT_JA.perimetre}：{printScopeValue}
          </p>
          <p>
            {PRINT_JA.dateComptage}：{workDate}
          </p>
          <p>
            {PRINT_JA.dateGel}：{frozenDate}
          </p>
          <p>
            {PRINT_JA.dateImpression}：{printedAt}
          </p>
          {/* Repli sans dépendance pour détecter une page manquante (spec
              2.52) si counter(page)/counter(pages) ne s'affiche pas — voir
              le commentaire sur .print-page-number en CSS pour l'état
              (non vérifié) de cette tentative. */}
          <p>{PRINT_JA.totalLignes.replace('{count}', String(saisies.length))}</p>
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
                // Référence puis emplacement (spec 2.52) : révision de
                // l'ordre de tournée, voir le commentaire au-dessus.
                rows.sort(
                  (a, b) =>
                    a.refCode.localeCompare(b.refCode) || a.emplacementCode.localeCompare(b.emplacementCode),
                )
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
