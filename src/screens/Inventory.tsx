import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { useI18n, interpolate, type Dictionary } from '../i18n'
import { supabase } from '../lib/supabase'
import { extractErrorMessage } from '../lib/errors'
import {
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
  listInventaireSaisies,
  MoveCasierLignePartialError,
  reactivationNeeded,
  ReactivationRequiredError,
  scopeRefCodes,
  writeSaisie,
  type NeverTouchedReference,
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
  // Deux confirmations au lancement (spec 2.74 §6.5) : deux décisions sans
  // rapport, jamais fusionnées sous un seul bouton. `step` distingue la
  // question des inactives (sautée si aucune n'est concernée) de la
  // confirmation du périmètre, toujours affichée ensuite.
  type PendingLaunch = {
    scopeKind: ScopeKind
    options: { clientCode?: string; refCodes?: string[] }
    inactiveCodes: string[]
    step: 'inactive' | 'confirm'
  }
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null)
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

  // Premier pas des deux confirmations (spec 2.78 §6.5) : jamais appelé
  // directement par un bouton "Démarrer" — c'est lui qui décide si la
  // fenêtre informative des inactives doit s'afficher avant la confirmation
  // de périmètre. Depuis la 2.78, aucun périmètre ne filtre les inactives
  // (ni `references`, ni `client`, ni `tout` — `scopeRefCodes` §6.5) :
  // cette fenêtre peut donc s'afficher sur les trois modes, calculée
  // directement depuis le catalogue plutôt que depuis un périmètre déjà
  // résolu, qui demanderait un aller-retour réseau supplémentaire pour
  // "tout" et "client". "tout" : toutes les inactives du catalogue : le
  // périmètre, c'est tout, donc c'est la même liste. "client" : celles de
  // ce client. "references" : celles désignées à la main. Purement
  // informative (voir la fenêtre plus bas) : plus aucun risque d'action de
  // masse, contrairement à la version à trois boutons de la spec 2.74/2.75.
  function requestLaunch(scopeKind: ScopeKind, options: { clientCode?: string; refCodes?: string[] } = {}) {
    const inactiveCodes =
      scopeKind === 'tout'
        ? references.filter((r) => !r.actif).map((r) => r.code)
        : scopeKind === 'client'
          ? references.filter((r) => !r.actif && r.client_code === options.clientCode).map((r) => r.code)
          : references.filter((r) => !r.actif && (options.refCodes ?? []).includes(r.code)).map((r) => r.code)
    setLaunchError(null)
    setPendingLaunch({ scopeKind, options, inactiveCodes, step: inactiveCodes.length > 0 ? 'inactive' : 'confirm' })
  }

  // Fenêtre 1 (spec 2.78 §6.5) : un seul bouton, aucune décision. La
  // version antérieure en offrait trois, dont une réactivation immédiate —
  // demander à l'opérateur de trancher au seul moment où il ne peut pas
  // savoir s'il va en trouver. La fenêtre ne demande plus, elle prévient :
  // avance simplement à la confirmation du périmètre, sans rien écrire. Si
  // du stock apparaît pendant le comptage, la question de réactivation se
  // pose alors, au bon moment (§6.8).
  function acknowledgeInactiveNotice() {
    if (!pendingLaunch) return
    setPendingLaunch({ ...pendingLaunch, step: 'confirm' })
  }

  // "Revenir au choix" (spec 2.74 §6.5), pour la fenêtre 2 : laisse l'écran
  // en l'état, sans effacer la sélection en cours — mode, clientCode,
  // selectedRefs restent intacts, seule pendingLaunch se ferme.
  function cancelPendingLaunch() {
    setPendingLaunch(null)
  }

  // Libellé du périmètre dans la seconde confirmation (spec 2.74 §6.5) :
  // "la liste des références, ou le nom du client, ou « tout l'entrepôt »"
  // — la valeur littérale, jamais un mot générique comme scopeLabel()
  // ailleurs dans ce fichier (qui sert un inventaire déjà créé, pas encore
  // celui-ci).
  function pendingLaunchScopeText(pending: PendingLaunch): string {
    if (pending.scopeKind === 'tout') return t.inventory.scopeTout
    if (pending.scopeKind === 'client') {
      return clients.find((c) => c.code === pending.options.clientCode)?.nom ?? pending.options.clientCode ?? ''
    }
    return [...(pending.options.refCodes ?? [])].sort().join(', ')
  }

  // Bâti une seule fois, référencé depuis les trois écrans de lancement
  // (menu, client, references) — un composant recopié perd ses correctifs
  // un par un (spec 2.60 §6.5, même défaut visé par la factorisation du
  // déplacement en spec 2.66 point 4 ter).
  const launchModals = (
    <>
      {/* Fenêtre 1 (spec 2.78 §6.5) : purement informative, un seul bouton.
          Pas de `onClose` malgré l'absence d'écriture — cohérent avec la
          fenêtre 2 juste en dessous, dont elle est la première étape d'un
          même geste ; fermer l'une au toucher extérieur sans l'autre
          brouillerait la séquence. */}
      {pendingLaunch && pendingLaunch.step === 'inactive' && (
        <Modal>
          <p>{t.inventory.launchInactiveIntro}</p>
          <p className="quantity-formula">{[...pendingLaunch.inactiveCodes].sort().join(', ')}</p>
          <button type="button" className="arm-button" onClick={acknowledgeInactiveNotice}>
            {t.inventory.launchInactiveAck}
          </button>
        </Modal>
      )}

      {pendingLaunch && pendingLaunch.step === 'confirm' && (
        <Modal>
          <p>{t.inventory.launchConfirmTitle}</p>
          <p className="quantity-formula">{pendingLaunchScopeText(pendingLaunch)}</p>
          <button
            type="button"
            className="arm-button"
            onClick={() => start(pendingLaunch.scopeKind, pendingLaunch.options)}
            disabled={busy}
          >
            {t.inventory.launchConfirmButton}
          </button>
          <button type="button" className="back-link" onClick={cancelPendingLaunch} disabled={busy}>
            {t.inventory.launchBackToChoice}
          </button>
          {launchError && <p className="form-status form-error">{launchError}</p>}
        </Modal>
      )}
    </>
  )

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
          onClick={() => requestLaunch('client', { clientCode: clientCode! })}
        >
          {t.inventory.start}
        </button>
        {launchError && <p className="form-status form-error">{launchError}</p>}
        {launchModals}
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
                  {/* Spec 2.71 §6.8 : choisir une inactive à la main reste
                      libre, mais on doit pouvoir le voir — avant le
                      comptage, pas pendant. Même clé que partout. */}
                  {!r.actif ? ` · ${t.catalogue.inactiveLabel}` : ''}
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
          onClick={() => requestLaunch('references', { refCodes: [...selectedRefs] })}
        >
          {t.inventory.start}
        </button>
        {launchError && <p className="form-status form-error">{launchError}</p>}
        {launchModals}
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
        <button className="home-action" disabled={busy} onClick={() => requestLaunch('tout')}>
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
      {launchModals}
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
// les deux appelants de writeSaisie. ReactivationRequiredError : verrou de
// writeSaisie, rien n'a été écrit — ne devrait jamais atteindre l'opérateur
// (la question est posée avant), mais traduit s'il l'atteint.
function describeSaveError(err: unknown, t: Dictionary): string {
  if (err instanceof MoveCasierLignePartialError) return t.inventory.moveDuplicatedError
  if (err instanceof ReactivationRequiredError) {
    return interpolate(t.inventory.reactivationNotConfirmedError, { refCode: err.refCode })
  }
  return extractErrorMessage(err, t.common.unknownError)
}

// Écriture en attente d'une réponse de l'opérateur (spec 3.0 §6.5, « une
// écriture ne pose qu'une question ») : UN seul type, UN seul état par
// écran, UNE seule fenêtre (WriteConfirmDialog). Quel que soit le nombre de
// conditions qu'une saisie déclenche — réactivation, extension de
// périmètre, déplacement, collision — l'opérateur répond une fois, dans une
// fenêtre qui les nomme toutes. Avant ce type, trois états séparés
// (doublon, extension/réactivation, déplacement) s'enchaînaient : confirmer
// une réactivation ouvrait ensuite la question de doublon, et une
// modification qui changeait de casier sur une référence inactive ou hors
// périmètre partait sans jamais montrer le récapitulatif de déplacement.
interface PendingWrite extends EntryKey {
  cartonsValue: number
  piecesValue: number
  // Changement de casier (spec 2.60 §6.5) : récapitulatif de déplacement.
  // `originalCartons`/`originalPieces` = quantité de la ligne AVANT
  // modification (spec 2.65) — servent uniquement à afficher un changement
  // de quantité, jamais à borner ce qui est écrit. Côté Écarts (pas de
  // champ de quantité), ils valent toujours `cartonsValue`/`piecesValue`.
  move: { fromEmplacementCode: string; originalCartons: number; originalPieces: number } | undefined
  // Autre ligne déjà présente au triplet de destination (spec 2.61-2.62) :
  // Ajouter / Remplacer, totaux affichés. `undefined` aussi quand cette
  // ligne porte 0/0 — les deux branches donnent alors le même résultat,
  // la question ne se pose pas (buildPendingWrite).
  collision: { existingCartons: number; existingPieces: number } | undefined
  needsScopeExtension: boolean
  // Au moins une branche donne du stock à une inactive. La confirmation
  // autorise la réactivation ; writeSaisie ne la fait que si la quantité
  // finalement écrite en donne (Remplacer par 0 ne réactive rien).
  reactivation: boolean
}

// Construit la question — ou décide qu'il n'y en a pas (`null` : écrire
// directement). Partagé entre la marche et les Écarts : les deux règles
// « branches convergentes » et « réactivation annoncée » ne s'écrivent
// qu'ici, jamais chez les appelants, qui ne passent que les faits bruts.
// `existingAtTarget` : une AUTRE ligne au triplet de destination — jamais la
// ligne qu'on corrige elle-même (collision avec soi-même = l'objet de la
// correction, spec 2.61) ; c'est à l'appelant de l'exclure.
function buildPendingWrite(params: {
  key: EntryKey
  cartonsValue: number
  piecesValue: number
  move: PendingWrite['move']
  existingAtTarget: { cartons: number; pieces: number } | undefined
  referenceActif: boolean
  needsScopeExtension: boolean
}): PendingWrite | null {
  const { key, cartonsValue, piecesValue, existingAtTarget: existing } = params
  // Spec 3.0 §6.5 : « une question dont les branches donnent le même
  // résultat ne se pose pas » — ligne existante à 0 carton et 0 pièce,
  // Ajouter = Remplacer, on écrit sans demander.
  const collision =
    existing && (existing.cartons !== 0 || existing.pieces !== 0)
      ? { existingCartons: existing.cartons, existingPieces: existing.pieces }
      : undefined
  const reactivation =
    reactivationNeeded(params.referenceActif, cartonsValue, piecesValue) ||
    (collision !== undefined &&
      reactivationNeeded(
        params.referenceActif,
        cartonsValue + collision.existingCartons,
        piecesValue + collision.existingPieces,
      ))
  if (!params.move && !collision && !params.needsScopeExtension && !reactivation) return null
  return {
    emplacementCode: key.emplacementCode,
    refCode: key.refCode,
    conditionnementId: key.conditionnementId,
    cartonsValue,
    piecesValue,
    move: params.move,
    collision,
    needsScopeExtension: params.needsScopeExtension,
    reactivation,
  }
}

// Trois variantes plutôt qu'une chaîne toujours-les-deux-unités (spec 2.65
// §6.5) : l'exemple de spec ne nomme que l'unité qui change. `null` = rien
// n'a changé (ou pas de déplacement), la ligne ne s'affiche pas.
function moveQuantityChangeLabel(pending: PendingWrite, t: Dictionary): string | null {
  const move = pending.move
  if (!move) return null
  const cartonsChanged = pending.cartonsValue !== move.originalCartons
  const piecesChanged = pending.piecesValue !== move.originalPieces
  if (cartonsChanged && piecesChanged) {
    return interpolate(t.inventory.moveQuantityChangeBoth, {
      fromCartons: move.originalCartons,
      toCartons: pending.cartonsValue,
      fromPieces: move.originalPieces,
      toPieces: pending.piecesValue,
    })
  }
  if (cartonsChanged) {
    return interpolate(t.inventory.moveQuantityChangeCartons, { from: move.originalCartons, to: pending.cartonsValue })
  }
  if (piecesChanged) {
    return interpolate(t.inventory.moveQuantityChangePieces, { from: move.originalPieces, to: pending.piecesValue })
  }
  return null
}

// Quantité réellement écrite (spec 2.62 §6.5, "ajouter" somme sur l'état
// local déjà connu, jamais une relecture serveur) — partagée entre la
// marche et les Écarts.
function computeFinalQuantity(
  pending: PendingWrite,
  mode: 'remplacer' | 'ajouter' | undefined,
): { cartons: number; pieces: number } {
  if (mode === 'ajouter' && pending.collision) {
    return {
      cartons: pending.cartonsValue + pending.collision.existingCartons,
      pieces: pending.piecesValue + pending.collision.existingPieces,
    }
  }
  return { cartons: pending.cartonsValue, pieces: pending.piecesValue }
}

// LA fenêtre de confirmation d'une écriture, partagée entre la marche et
// les Écarts (spec 2.66 point 4 ter, généralisée spec 3.0 §6.5) : elle
// nomme toutes les conditions de la saisie, et pose un seul choix. Fenêtre
// modale sans `onClose` (spec 2.64 §6.5) : elle écrit, elle exige un choix
// explicite par bouton. `error` affiché DANS la fenêtre, avant les boutons :
// hors de la modale il serait derrière le fond assombri, et après les
// boutons dans la partie qu'il faudrait faire défiler (`.modal-dialog`,
// max-height 80vh) — même défaut que le test 7 (spec 2.64 §6.5).
function WriteConfirmDialog({
  pending,
  t,
  saving,
  error,
  onConfirm,
  onCancel,
}: {
  pending: PendingWrite
  t: Dictionary
  saving: boolean
  error: string | null
  onConfirm: (mode?: 'remplacer' | 'ajouter') => void
  onCancel: () => void
}) {
  const quantityChange = moveQuantityChangeLabel(pending, t)
  const collision = pending.collision
  return (
    <Modal>
      {pending.reactivation && (
        <p>{interpolate(t.inventory.inactiveReferenceQuestion, { refCode: pending.refCode })}</p>
      )}
      {pending.needsScopeExtension && (
        <p>{interpolate(t.inventory.scopeExtensionQuestion, { refCode: pending.refCode })}</p>
      )}
      {pending.move && (
        <p>
          {interpolate(t.inventory.moveConfirm, {
            refCode: pending.refCode,
            from: pending.move.fromEmplacementCode,
            to: pending.emplacementCode,
          })}
        </p>
      )}
      {quantityChange && <p>{quantityChange}</p>}
      {collision && (
        <p>
          {pending.move
            ? interpolate(t.inventory.moveCollisionExisting, {
                emplacement: pending.emplacementCode,
                cartons: collision.existingCartons,
                pieces: collision.existingPieces,
              })
            : interpolate(t.inventory.duplicateEntry, {
                emplacement: pending.emplacementCode,
                refCode: pending.refCode,
                cartons: collision.existingCartons,
                pieces: collision.existingPieces,
              })}
        </p>
      )}
      {error && <p className="form-status form-error">{error}</p>}
      {collision ? (
        <>
          {/* Remplacer avant Ajouter (choix explicite de l'utilisateur,
              5 octobre 2026) : c'était l'ordre historique de la fenêtre de
              doublon sur la marche, où ce choix se pose le plus souvent —
              un appui réflexe par habitude doit retomber sur "remplacer",
              pas sur "ajouter". Même ordre pour le déplacement : une seule
              fenêtre partagée ne doit pas avoir deux ordres. */}
          <button type="button" onClick={() => onConfirm('remplacer')} disabled={saving}>
            {t.inventory.replaceEntry} ({pending.cartonsValue}c + {pending.piecesValue}p)
          </button>
          <button type="button" onClick={() => onConfirm('ajouter')} disabled={saving}>
            {t.inventory.addEntry} ({pending.cartonsValue + collision.existingCartons}c +{' '}
            {pending.piecesValue + collision.existingPieces}p)
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
  // La seule question en attente (spec 3.0 §6.5, voir PendingWrite) —
  // remplace les trois états séparés qui s'enchaînaient.
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null)
  // Étiquette de conditionnement par id, pour l'afficher dans la liste des
  // saisies (spec v2 §6.5 : "casier, référence, conditionnement, quantité")
  // — sans elle, deux lignes de la même réf sur deux conditionnements
  // distincts semblent identiques dans la liste.
  const [conditionnementLabels, setConditionnementLabels] = useState<Map<string, string>>(new Map())
  // Inventaire partiel (spec 2.54, §6.5) : liste explicite du périmètre
  // quand scope_kind === 'references' — undefined pour les deux autres.
  // Porte uniquement la garde de saisie et la question d'extension ; le
  // rappel des références à compter, lui, couvre tous les scope_kind
  // (spec 2.71, voir checklistCodes).
  const [referencesScope, setReferencesScope] = useState<string[] | undefined>(undefined)
  // Périmètre "client" (spec 2.71 §6.5) : sert au rappel des références à
  // compter et aux suggestions du champ référence (spec 3.0 §6.8), jamais
  // à la garde de saisie. Volontairement distinct de `referencesScope`, qui
  // porte la garde de saisie et la question d'extension — deux mécanismes
  // séparés, pour qu'élargir le rappel ne change jamais ce qui est refusé
  // ou confirmé à l'enregistrement.
  const [clientScopeCodes, setClientScopeCodes] = useState<string[] | undefined>(undefined)
  // Rappel des références à compter (spec 2.56 §6.5) : ouvert depuis un
  // bouton, jamais affiché en flux — un déroulant en place repousserait le
  // formulaire, qui sert en permanence, pour une liste qui sert rarement.
  const [scopeChecklistOpen, setScopeChecklistOpen] = useState(false)
  // Filtre de la fenêtre (spec 2.74 §6.5) : remplace le seuil de taille
  // abandonné — une liste de deux cents lignes reste utilisable dès qu'on
  // peut y chercher. Remis à zéro à chaque ouverture, jamais conservé
  // d'une ouverture à l'autre.
  const [scopeChecklistQuery, setScopeChecklistQuery] = useState('')
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
    setClientScopeCodes(inventaire.scope_kind === 'client' ? codes : undefined)
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
    if (inventaire.scope_kind === 'tout') return
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

  // Pendant un inventaire, c'est le périmètre qui gouverne, pas le drapeau
  // (spec 3.1 §6.8) : une référence du périmètre est suggérée quel que soit
  // son état — sinon le rappel demande de compter une référence que ce
  // champ refuse de suggérer, et il faut taper son code entier. Tranché par
  // l'architecture le 5 octobre, contre l'implémentation antérieure : les
  // suggestions sont le périmètre et rien d'autre, quel que soit le genre
  // de périmètre — une exception pour `client` (actives hors périmètre
  // incluses) aurait fait de « c'est le périmètre qui gouverne » un usage
  // au lieu d'une règle, et aurait laissé une liste déborder de ce qui
  // appartient à cet inventaire.
  //   - `tout` : le périmètre est le catalogue entier, la règle est sans
  //     effet (tout y est déjà) ;
  //   - `references` : un code hors périmètre tapé en entier reste
  //     accepté, handleSave pose la question d'extension (needsScopeExtension) ;
  //   - `client` : AUCUNE question d'extension n'existe pour ce genre de
  //     périmètre — handleSave ne la calcule que pour `references`
  //     (needsScopeExtension plus bas), et scopeRefCodes dérive le
  //     périmètre `client` de `references.client_code`, pas de
  //     `inventaire_references` : y construire une extension n'a pas de
  //     sens tant que l'architecture n'en a pas décidé. Un code d'un autre
  //     client tapé en entier s'écrit donc aujourd'hui SANS AUCUNE
  //     question, et l'écran des écarts ne le marque pas non plus "hors
  //     périmètre" (`outOfScope`, plus bas, ne teste que `references`).
  //     Signalé à l'architecture le 5 octobre, pas corrigé ici : rien dans
  //     la spec ne couvre ce cas, et ce n'est pas à cette fonction de
  //     l'inventer.
  //   Tant que le périmètre choisi n'est pas chargé, les deux dernières
  //   branches retombent sur les seules actives — jamais une liste vide,
  //   mais c'est le même débordement que la règle ci-dessus vient de
  //   fermer, cette fois côté réseau plutôt que côté genre de périmètre.
  //   Signalé aussi, pas corrigé : hors réseau, en allée, ce repli dure.
  const suggestableReferences = (() => {
    if (inventaire.scope_kind === 'tout') return allReferences
    const scope = inventaire.scope_kind === 'references' ? referencesScope : clientScopeCodes
    return scope ? allReferences.filter((r) => scope.includes(r.code)) : allReferences.filter((r) => r.actif)
  })()

  // Rappel des références à compter (spec 2.78 §6.5) : liste le périmètre
  // TEL QU'IL EST, jamais "les actives du périmètre" — la règle finale,
  // la plus simple des quatre qui se sont succédé ici : aucun périmètre ne
  // filtre les inactives, ni `references`, ni `client`, ni `tout`. Le
  // drapeau `actif` ne compose plus aucun périmètre — il vit dans les
  // suggestions de l'écran Mouvement et l'affichage du Catalogue, nulle
  // part ailleurs. Les trois branches ci-dessous n'ont donc plus besoin de
  // filtrer chacune à sa façon : "tout" prend tout le catalogue (aucune
  // liste de `scopeRefCodes`, volontairement sans restriction, §6.5) ;
  // "client" et "references" prennent leurs codes tels que `scopeRefCodes`
  // les renvoie, inactives comprises — affichées comme les autres, avec
  // leur mention « · Inactif » (rendu plus bas). `undefined` tant que le
  // périmètre client n'est pas chargé — pas de bouton plutôt qu'une liste
  // vide qui se lirait comme « rien à compter ».
  const checklistReferences: Reference[] | undefined = (() => {
    if (inventaire.scope_kind === 'tout') return allReferences
    const codes = inventaire.scope_kind === 'client' ? clientScopeCodes : referencesScope
    if (codes === undefined) return undefined
    const codeSet = new Set(codes)
    return allReferences.filter((r) => codeSet.has(r.code))
  })()
  // `allReferences` encore vide au montage (avant la résolution de
  // listReferences(), ou si elle échoue) donnerait un "tout" à liste vide
  // sans que ce soit un signal de périmètre non chargé — sans ce second
  // test, le bouton s'ouvrirait sur rien plutôt que de rester caché.
  const showChecklist = checklistReferences !== undefined && allReferences.length > 0
  // Même recherche que le champ de saisie ci-dessus (matchReferences,
  // §6.2) — jamais une seconde implémentation de filtre (spec 2.74 §6.5).
  const checklistFiltered = scopeChecklistQuery.trim()
    ? matchReferences(scopeChecklistQuery, checklistReferences ?? [])
    : (checklistReferences ?? [])

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
  // parce que là le contenu a été écrit quelque part. pendingWrite reste
  // lié à une tentative de soumission précise : naviguer le referme, sans
  // quoi une question posée à l'ancien casier resterait affichée au nouveau.
  function goToEmplacement(code: string) {
    setEmplacementCode(code)
    setPendingWrite(null)
    closeEntryMenu()
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

      // Toutes les conditions de cette saisie sont réunies ICI, avant toute
      // question (spec 3.0 §6.5, « une écriture ne pose qu'une question ») :
      // buildPendingWrite en fait une seule fenêtre, ou décide qu'il n'y a
      // rien à demander.
      //
      // Inventaire partiel (spec 2.54, point 2) : jamais enregistrer une
      // référence hors périmètre en silence — proposer d'étendre.
      const needsScopeExtension = inventaire.scope_kind === 'references' && !!scope && !scope.includes(code)
      // Référence inactive tapée en entier (spec 2.67 §6.2) : acceptée, pas
      // refusée — des cartons devant soi sont un fait physique (§4). Lu dans
      // `allReferences` déjà chargé, jamais une relecture réseau (§6.5) ;
      // potentiellement périmé si une désactivation a lieu ailleurs pendant
      // la marche, mais une référence couverte par l'inventaire en cours ne
      // peut pas être désactivée (§6.8). La condition elle-même
      // (reactivationNeeded) vit dans inventaireDb.ts, nulle part ici.
      const referenceActif = allReferences.find((r) => r.code === code)?.actif ?? true
      // Collision : une AUTRE ligne au triplet de destination. Avec soi-même
      // (le triplet ne change pas), ce n'est pas une collision, c'est
      // l'objet de la correction (spec 2.61 §6.5). Recherche dans `saisies`
      // (état local), jamais une relecture serveur (spec 2.62).
      const existing = editingKey && sameKey(editingKey, key) ? undefined : saisies.find((s) => sameKey(s, key))
      const pending = buildPendingWrite({
        key,
        cartonsValue,
        piecesValue,
        // Mode modification : le casier du formulaire est la destination
        // (spec 2.60 §6.5) — le changer est un déplacement, récapitulatif
        // obligatoire. Référence ou conditionnement changés SANS le casier
        // ne le montrent pas (spec 2.60 ne le demande que pour le casier),
        // mais writeSaisie les traite bien en déplacement à l'écriture.
        move:
          editingKey && editingKey.emplacementCode !== key.emplacementCode
            ? {
                fromEmplacementCode: editingKey.emplacementCode,
                // Capturée à l'ouverture du mode modification (editEntry),
                // jamais redérivée de `saisies` ici (spec 2.65 §6.5).
                originalCartons: editingOriginalQuantity?.cartons ?? cartonsValue,
                originalPieces: editingOriginalQuantity?.pieces ?? piecesValue,
              }
            : undefined,
        existingAtTarget: existing ? { cartons: existing.cartons, pieces: existing.pieces } : undefined,
        referenceActif,
        needsScopeExtension,
      })
      if (pending) {
        setStatus({ kind: 'idle' })
        setPendingWrite(pending)
        return
      }

      await commitSave(key, cartonsValue, piecesValue, false)
    } catch (err) {
      setStatus({ kind: 'error', message: describeSaveError(err, t) })
    }
  }

  // Écrit réellement la ligne — appelé directement (aucune question) ou
  // depuis confirmWrite. Toute la décision d'écriture (correction de valeur
  // ou déplacement, réactivation) appartient à writeSaisie, partagée avec
  // l'écran des écarts : rien de cela ne se décide ici.
  async function commitSave(key: EntryKey, cartonsValue: number, piecesValue: number, reactivationConfirmed: boolean) {
    // Ne devrait jamais arriver : handleSave vérifie déjà `auteur` avant
    // d'atteindre ce point. Un throw ici remonte dans le catch de
    // l'appelant (message d'erreur visible) au lieu de laisser le bouton
    // bloqué en "saving" sans rien afficher.
    if (!auteur) throw new Error('auteur manquant')
    // Capturés au moment du geste (l'appui sur Enregistrer, ou sur un
    // bouton de la confirmation), jamais plus tard : voir le commentaire
    // sur saveCasierLigne pour la raison exacte (file hors ligne, spec v2 §3).
    const ligneId = crypto.randomUUID()
    const ligneTs = new Date().toISOString()

    // Correction via "Modifier" (spec 2.58, §6.5) : la ligne d'origine, si
    // elle existe encore dans l'état local (l'opérateur peut l'avoir
    // supprimée via le menu "…" pendant qu'il l'éditait). writeSaisie
    // compare elle-même le triplet avant/après.
    const relocatingFrom =
      editingKey && !sameKey(editingKey, key) ? saisies.find((s) => sameKey(s, editingKey)) : undefined

    const { comptageId, reactivated } = await writeSaisie({
      inventaireId: inventaire.id,
      ligneId,
      ts: ligneTs,
      auteur,
      source: relocatingFrom
        ? {
            comptageId: relocatingFrom.comptageId,
            emplacementCode: relocatingFrom.emplacementCode,
            refCode: relocatingFrom.refCode,
            conditionnementId: relocatingFrom.conditionnementId,
          }
        : undefined,
      target: { ...key, cartons: cartonsValue, pieces: piecesValue },
      referenceActif: allReferences.find((r) => r.code === key.refCode)?.actif ?? true,
      reactivationConfirmed,
    })
    if (reactivated) {
      setAllReferences((prev) => prev.map((r) => (r.code === key.refCode ? { ...r, actif: true } : r)))
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
    setPendingWrite(null)
    setStatus({ kind: 'idle' })
  }

  // Réponse à LA question (spec 3.0 §6.5) : résout chaque condition
  // nommée par la fenêtre, puis écrit — la confirmation conclut l'action
  // qu'elle confirme, aucune seconde fenêtre ne suit (défaut du 30
  // septembre). "Ajouter" somme sur la valeur LOCALE déjà connue
  // (computeFinalQuantity), jamais une relecture serveur (spec 2.62 §6.5) :
  // sur un seul appareil, l'état local est la vue la plus complète. Cette
  // règle ne tient QUE tant qu'un seul appareil écrit — voir §14.
  // `key` reconstruit explicitement plutôt qu'un rest-spread : PendingWrite
  // porte des champs qu'EntryKey n'a pas, un rest-spread les laisserait
  // traîner sans que tsc s'en plaigne.
  async function confirmWrite(mode?: 'remplacer' | 'ajouter') {
    if (!pendingWrite) return
    const key: EntryKey = {
      emplacementCode: pendingWrite.emplacementCode,
      refCode: pendingWrite.refCode,
      conditionnementId: pendingWrite.conditionnementId,
    }
    setStatus({ kind: 'saving' })
    try {
      if (pendingWrite.needsScopeExtension) {
        // Rejouable (ignoreDuplicates) : un réessai après un échec de
        // l'écriture qui suit ne crée rien de plus.
        await addReferenceToScope(inventaire.id, key.refCode)
        setReferencesScope((prev) =>
          prev ? (prev.includes(key.refCode) ? prev : [...prev, key.refCode]) : [key.refCode],
        )
      }
      const { cartons: finalCartons, pieces: finalPieces } = computeFinalQuantity(pendingWrite, mode)
      await commitSave(key, finalCartons, finalPieces, pendingWrite.reactivation)
    } catch (err) {
      setStatus({ kind: 'error', message: describeSaveError(err, t) })
    }
  }

  // Annuler : rien n'est écrit (spec 2.54 point 2) — jamais en silence,
  // jamais forcé non plus.
  function cancelWrite() {
    setPendingWrite(null)
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
    setPendingWrite(null)
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
    setPendingWrite(null)
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
              disabled={status.kind === 'saving' || pendingWrite !== null}
              aria-label={t.inventory.previousCasier}
            >
              ←
            </button>
            <ComboInput
              value={emplacementCode}
              onChange={setEmplacementCode}
              suggestions={emplacementSuggestions}
              placeholder={t.inventory.casierPlaceholder}
              disabled={status.kind === 'saving' || pendingWrite !== null}
              selectOnFocus
            />
            <button
              type="button"
              className="step-button"
              onClick={() => stepEmplacement(1)}
              disabled={status.kind === 'saving' || pendingWrite !== null}
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
            disabled={status.kind === 'saving' || pendingWrite !== null}
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
            {!matchedReference.actif ? ` · ${t.catalogue.inactiveLabel}` : ''}
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
        <button type="submit" disabled={status.kind === 'saving' || pendingWrite !== null}>
          {t.common.save}
        </button>
        {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
      </form>

      {/* Rappel des références à compter (spec 2.54 point 3, repositionné en
          spec 2.56 §6.5, plus de seuil de taille depuis spec 2.74) : affiché
          dès qu'un périmètre existe, quel que soit son mode de composition.
          Sorti du flux — le formulaire sert en permanence, la liste sert
          rarement — et ouvert depuis ce simple bouton, sans compteur de
          progression (ni ici ni dans la fenêtre) : "4 sur 12 comptées"
          laisserait croire qu'il n'y a plus rien à compter sur une référence
          déjà rencontrée une fois. */}
      {showChecklist && (
        <button
          type="button"
          className="checklist-toggle"
          onClick={() => {
            setScopeChecklistQuery('')
            setScopeChecklistOpen(true)
          }}
        >
          {t.inventory.scopeChecklistTitle}
        </button>
      )}

      {scopeChecklistOpen && checklistReferences && (
        <Modal onClose={() => setScopeChecklistOpen(false)}>
          <h2>{t.inventory.scopeChecklistTitle}</h2>
          {/* Champ de filtre (spec 2.74 §6.5) : remplace le seuil de taille
              abandonné — un périmètre de deux cents références reste
              parcourable dès qu'on peut y chercher. Même recherche que le
              champ de saisie (matchReferences, §6.2). */}
          <input
            value={scopeChecklistQuery}
            onChange={(e) => setScopeChecklistQuery(e.target.value)}
            placeholder={t.inventory.referenceSearch}
          />
          {/* Liste uniforme, sans marqueur d'état (spec 2.58 §6.5,
              revient sur spec 2.54) : une référence éparpillée sur
              plusieurs casiers reste à compter ailleurs même une fois
              rencontrée une fois — la griser ou dire "comptée dans N
              casier(s)" laisserait croire à une complétude que rien ne
              garantit. Même raisonnement que l'abandon du compteur
              "4/12 comptées". Tri alphabétique fixe (naturel : les codes
              REU003/REU009/REU010 partagent la même largeur de suffixe,
              donc l'ordre lexicographique suffit déjà), position stable
              d'une ouverture à l'autre — la recherche filtre l'ensemble,
              elle ne réordonne jamais par pertinence. */}
          <ul className="casier-list">
            {[...checklistFiltered]
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((r) => (
                <li key={r.code} className="casier-row checklist-row">
                  <span>
                    {r.code}
                    {r.libelle ? ` — ${r.libelle}` : ''}
                    {/* Distinct du marqueur d'état interdit ci-dessus (spec
                        2.75 §6.5) : `actif` est un fait stocké, pas une
                        déduction de progression — une inactive gardée au
                        périmètre `references` doit s'y voir comme partout
                        ailleurs (spec 2.71 §6.8). Même clé. */}
                    {!r.actif ? ` · ${t.catalogue.inactiveLabel}` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </Modal>
      )}

      {/* LA question d'une écriture (spec 3.0 §6.5) — composant partagé
          avec l'écran des écarts, voir WriteConfirmDialog. */}
      {pendingWrite && (
        <WriteConfirmDialog
          pending={pendingWrite}
          t={t}
          saving={status.kind === 'saving'}
          error={status.kind === 'error' ? status.message : null}
          onConfirm={confirmWrite}
          onCancel={cancelWrite}
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
  // Références du périmètre qu'aucune saisie n'a touchées (spec 2.78 §6.5)
  // : à part de `references` ci-dessus, qui n'en contient aucune trace —
  // ni théorique ni comptée, donc absente de tout bucket de la fusion. Pas
  // un état de la clôture (non implémentée) : afficher "non comptée donc
  // zéro" est juste, écrire un ajustement sur cette base détruirait du
  // stock réel sur la foi d'une absence — CLAUDE.md, module Inventaire.
  const [neverTouched, setNeverTouched] = useState<NeverTouchedReference[]>([])
  const [clients, setClients] = useState<Client[]>([])
  // Feuille de contre-validation (spec 2.49) : source = journal complet des
  // saisies, PAS `references`/`parEmplacement` (filtrée par
  // getInventaireSynthese sur statut === 'clos', dette §14) — un document
  // censé être complet ne peut pas hériter de ce filtre fragile.
  const [saisies, setSaisies] = useState<SaisieLine[]>([])
  const [refLibelleByCode, setRefLibelleByCode] = useState<Map<string, string | null>>(new Map())
  // Drapeau `actif` par référence (spec 3.0 §6.5) : writeSaisie l'exige —
  // la détection de réactivation appartient à l'écriture, et cet écran
  // écrivait jusqu'ici une quantité sans aucun contrôle sur `actif`.
  // Absent de la map (chargement échoué) = traité comme actif, même
  // convention que la marche.
  const [actifByCode, setActifByCode] = useState<Map<string, boolean>>(new Map())
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
  // Correction de quantité en attente de confirmation (spec 3.0 §6.5) —
  // aujourd'hui seulement la réactivation d'une inactive, mais construite
  // par buildPendingWrite et rendue par WriteConfirmDialog comme toute
  // autre écriture : pas une fenêtre propre à cet écran.
  const [pendingEdit, setPendingEdit] = useState<PendingWrite | null>(null)
  // Double appui sur Supprimer (spec 2.58 §6.5) : un seul panneau d'édition
  // ouvert à la fois (editingLigneId), donc un seul booléen suffit — remis
  // à zéro à chaque ouverture/fermeture de panneau (voir toggleEdit).
  const [deleteArmed, setDeleteArmed] = useState(false)
  // Déplacement d'une saisie vers un autre casier (spec 2.58 §6.5) :
  // moveTarget est la saisie brute ; pendingMove, construit par
  // buildPendingWrite une fois le casier validé, porte le récapitulatif, la
  // collision de destination et la réactivation éventuelles (même type et
  // même composant de confirmation que la marche, `WriteConfirmDialog` ;
  // seule la source des données diffère : `ref.parEmplacement` ici,
  // `saisies` côté marche).
  const [movingLigneId, setMovingLigneId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [pendingMove, setPendingMove] = useState<PendingWrite | null>(null)
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
    setNeverTouched(result.neverTouched)
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
        setNeverTouched(synthese.neverTouched)
        setSaisies(saisieList)
        setRefLibelleByCode(new Map(refList.map((r) => [r.code, r.libelle])))
        setActifByCode(new Map(refList.map((r) => [r.code, r.actif])))
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
    setPendingEdit(null)
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
      setPendingEdit(null)
      cancelMove()
    } else {
      startEdit(l)
    }
  }

  // Corriger ou retirer une saisie DEPUIS l'écran Écarts, sans repasser par
  // la marche (2026-09-14, retour terrain) : on est déjà en train de
  // regarder l'écart, c'est le bon moment pour le corriger. Même question
  // que la marche, construite par le même buildPendingWrite (spec 3.0
  // §6.5) : une ligne posée à zéro pendant la marche puis portée à cinq
  // cartons ici donne du stock à une inactive — la réactivation doit être
  // demandée, et writeSaisie refuse d'écrire sinon.
  function saveEdit(ref: SyntheseReference, l: SyntheseLigneEmplacement) {
    if (!auteur || !l.comptageId) return
    const cartonsValue = Number(editCartons) || 0
    const piecesValue = Number(editPieces) || 0
    const pending = buildPendingWrite({
      key: { emplacementCode: l.emplacementCode, refCode: ref.refCode, conditionnementId: ref.conditionnementId },
      cartonsValue,
      piecesValue,
      move: undefined,
      // Même triplet que la ligne corrigée : collision avec soi-même, donc
      // pas une collision (spec 2.61 §6.5).
      existingAtTarget: undefined,
      referenceActif: actifByCode.get(ref.refCode) ?? true,
      // Une ligne déjà en base hors périmètre est marquée ici avec sa
      // propre action « ajouter au périmètre » (spec 2.54 point 4) : la
      // corriger ne pose pas la question d'extension.
      needsScopeExtension: false,
    })
    if (pending) {
      setEditStatus({ kind: 'idle' })
      setPendingEdit(pending)
      return
    }
    void commitEdit(ref, l, cartonsValue, piecesValue, false)
  }

  async function commitEdit(
    ref: SyntheseReference,
    l: SyntheseLigneEmplacement,
    cartonsValue: number,
    piecesValue: number,
    reactivationConfirmed: boolean,
  ) {
    if (!auteur || !l.comptageId) return
    // Nouvelle ligne (latest-wins), donc nouvel id — capturé ici, au geste,
    // pas dans saveCasierLigne (voir son commentaire).
    const ligneId = crypto.randomUUID()
    const ligneTs = new Date().toISOString()
    setEditStatus({ kind: 'saving' })
    try {
      const { reactivated } = await writeSaisie({
        inventaireId: inventaire.id,
        ligneId,
        ts: ligneTs,
        auteur,
        source: {
          comptageId: l.comptageId,
          emplacementCode: l.emplacementCode,
          refCode: ref.refCode,
          conditionnementId: ref.conditionnementId,
        },
        target: {
          emplacementCode: l.emplacementCode,
          refCode: ref.refCode,
          conditionnementId: ref.conditionnementId,
          cartons: cartonsValue,
          pieces: piecesValue,
        },
        referenceActif: actifByCode.get(ref.refCode) ?? true,
        reactivationConfirmed,
      })
      if (reactivated) setActifByCode((prev) => new Map(prev).set(ref.refCode, true))
      setPendingEdit(null)
      setEditingLigneId(null)
      setEditStatus({ kind: 'idle' })
      await refresh()
    } catch (err) {
      setEditStatus({ kind: 'error', message: describeSaveError(err, t) })
    }
  }

  function cancelPendingEdit() {
    setPendingEdit(null)
    setEditStatus({ kind: 'idle' })
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
    // Toujours une fenêtre ici (`move` défini), jamais `null`.
    setPendingMove(
      buildPendingWrite({
        key: { emplacementCode: targetCode, refCode: ref.refCode, conditionnementId: ref.conditionnementId },
        cartonsValue: l.cartons ?? 0,
        piecesValue: l.pieces ?? 0,
        move: {
          fromEmplacementCode: l.emplacementCode,
          originalCartons: l.cartons ?? 0,
          originalPieces: l.pieces ?? 0,
        },
        existingAtTarget: existing ? { cartons: existing.cartons ?? 0, pieces: existing.pieces ?? 0 } : undefined,
        referenceActif: actifByCode.get(ref.refCode) ?? true,
        needsScopeExtension: false,
      }),
    )
  }

  async function confirmMove(ref: SyntheseReference, l: SyntheseLigneEmplacement, mode?: 'remplacer' | 'ajouter') {
    if (!auteur || !l.comptageId || !pendingMove) return
    const ligneId = crypto.randomUUID()
    const ligneTs = new Date().toISOString()
    setMoveStatus({ kind: 'saving' })
    try {
      const { cartons: finalCartons, pieces: finalPieces } = computeFinalQuantity(pendingMove, mode)
      const { reactivated } = await writeSaisie({
        inventaireId: inventaire.id,
        ligneId,
        ts: ligneTs,
        auteur,
        source: {
          comptageId: l.comptageId,
          emplacementCode: l.emplacementCode,
          refCode: ref.refCode,
          conditionnementId: ref.conditionnementId,
        },
        target: {
          emplacementCode: pendingMove.emplacementCode,
          refCode: ref.refCode,
          conditionnementId: ref.conditionnementId,
          cartons: finalCartons,
          pieces: finalPieces,
        },
        referenceActif: actifByCode.get(ref.refCode) ?? true,
        reactivationConfirmed: pendingMove.reactivation,
      })
      if (reactivated) setActifByCode((prev) => new Map(prev).set(ref.refCode, true))
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
  // Même filtre de recherche, appliqué à la liste séparée (spec 2.78 §6.5)
  // — `neverTouched` n'a pas de clé conditionnement, matchReferences n'en a
  // pas besoin.
  const visibleNeverTouched = query.trim()
    ? matchReferences(
        query,
        neverTouched.map((r) => ({ code: r.refCode, libelle: r.refLibelle, client_code: '', actif: true })),
      ).map((m) => neverTouched.find((r) => r.refCode === m.code)!)
    : neverTouched

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
                      {/* Même fenêtre que la marche (spec 3.0 §6.5) ;
                          l'échec s'affiche DANS la fenêtre, jamais derrière
                          le fond assombri. */}
                      {pendingEdit && (
                        <WriteConfirmDialog
                          pending={pendingEdit}
                          t={t}
                          saving={editStatus.kind === 'saving'}
                          error={editStatus.kind === 'error' ? editStatus.message : null}
                          onConfirm={() =>
                            void commitEdit(ref, l, pendingEdit.cartonsValue, pendingEdit.piecesValue, pendingEdit.reactivation)
                          }
                          onCancel={cancelPendingEdit}
                        />
                      )}

                      {/* Déplacement vers un autre casier (spec 2.58 §6.5) :
                          confirmation simple avec récapitulatif, pas de
                          double appui — rien n'est détruit, le contenu est
                          relocalisé. Champ casier partagé avec la saisie
                          (ComboInput + emplacementFieldSuggestions, spec
                          2.60 §6.5) — un champ recopié perd ses correctifs
                          un par un. Confirmation rendue par le composant
                          partagé WriteConfirmDialog (spec 3.0 §6.5),
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
                            <WriteConfirmDialog
                              pending={pendingMove}
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

            {/* Le pendant du rappel affiché pendant la marche (spec 2.78
                §6.5) : là-bas un marqueur d'avancement mentirait (une
                référence peut se trouver dans un casier de plus) ; ici,
                l'opérateur a décidé qu'il avait fini, et savoir ce qu'il
                n'a pas touché est exactement la question utile. Piège à ne
                pas reproduire (CLAUDE.md, module Inventaire) : "non
                comptée donc zéro" est juste à l'affichage, mais ne doit
                jamais nourrir une clôture — écrire un ajustement sur cette
                base détruirait du stock réel sur la foi d'une absence. */}
            {visibleNeverTouched.length > 0 && (
              <>
                <h2>{t.inventory.neverTouchedTitle}</h2>
                <ul className="casier-list">
                  {visibleNeverTouched.map((r) => (
                    <li key={r.refCode} className="casier-row checklist-row">
                      <span>
                        {r.refCode}
                        {r.refLibelle ? ` — ${r.refLibelle}` : ''}
                        {!r.actif ? ` · ${t.catalogue.inactiveLabel}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
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
