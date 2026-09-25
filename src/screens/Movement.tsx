import { useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react'
import { useI18n, interpolate, type MotifKey } from '../i18n'
import { supabase } from '../lib/supabase'
import { extractErrorMessage } from '../lib/errors'
import {
  getStock,
  insertMouvements,
  listConditionnements,
  listEmplacements,
  listReferences,
  matchReferences,
} from '../lib/db'
import { refreshReferentielCache } from '../lib/referentielCache'
import type { Conditionnement, Emplacement, MouvementInsert, Reference, Sens } from '../lib/types'
import SearchSelect from '../components/SearchSelect'

const MOTIFS_ENTREE: MotifKey[] = [
  'reception',
  'retour_client',
  'stock_initial',
  'ajustement_inventaire',
  'annulation',
]
const MOTIFS_SORTIE: MotifKey[] = [
  'commande_client',
  'produit_defaillant',
  'destruction',
  'ajustement_inventaire',
  'annulation',
]

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'success' } | { kind: 'error'; message: string }

export default function Movement({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [sens, setSens] = useState<Sens>('entree')
  const [auteur, setAuteur] = useState<string | null>(null)

  const [references, setReferences] = useState<Reference[]>([])
  const [emplacements, setEmplacements] = useState<Emplacement[]>([])
  const [conditionnements, setConditionnements] = useState<Conditionnement[]>([])

  const [refCode, setRefCode] = useState<string | null>(null)
  const [emplacementCode, setEmplacementCode] = useState<string | null>(null)
  const [destinationCode, setDestinationCode] = useState<string | null>(null)
  const [conditionnementId, setConditionnementId] = useState<string | null>(null)
  const [cartons, setCartons] = useState(0)
  const [pieces, setPieces] = useState(0)
  const [motif, setMotif] = useState<MotifKey | ''>('')
  const [commentaire, setCommentaire] = useState('')

  const [armed, setArmed] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuteur(data.session?.user.email ?? null))
    // Référence inactive (spec 2.66 point 4 bis) : retirée du sélecteur de
    // saisie — `references` ne sert ici qu'à la liste déroulante, jamais à
    // relire un mouvement passé (append-only, jamais réédité).
    listReferences()
      .then((refs) => setReferences(refs.filter((r) => r.actif)))
      .catch(() => {})
    listEmplacements().then(setEmplacements).catch(() => {})
  }, [])

  useEffect(() => {
    if (!refCode) {
      setConditionnements([])
      setConditionnementId(null)
      return
    }
    listConditionnements(refCode).then((list) => {
      setConditionnements(list)
      setConditionnementId(list[0]?.id ?? null)
    })
  }, [refCode])

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [])

  // Un changement de champ invalide l'armement en cours : le second appui
  // doit confirmer exactement ce qui a été vu au premier, jamais des
  // données modifiées entre-temps.
  useEffect(() => {
    resetArm()
  }, [refCode, emplacementCode, destinationCode, conditionnementId, cartons, pieces, motif])

  function resetArm() {
    setArmed(false)
    if (armTimer.current) clearTimeout(armTimer.current)
  }

  function changeSens(next: Sens) {
    setSens(next)
    setMotif('')
    setDestinationCode(null)
    resetArm()
  }

  const conditionnement = conditionnements.find((c) => c.id === conditionnementId) ?? null
  const totalPieces = conditionnement ? cartons * conditionnement.pieces_par_carton + pieces : 0
  const motifOptions = sens === 'entree' ? MOTIFS_ENTREE : MOTIFS_SORTIE

  const referenceOptions = useMemo(
    () => references.map((r) => ({ value: r.code, label: r.libelle ? `${r.code} — ${r.libelle}` : r.code })),
    [references],
  )
  const emplacementOptions = useMemo(
    () => emplacements.map((e) => ({ value: e.code, label: e.code })),
    [emplacements],
  )

  // Sans lien tracé vers le mouvement annulé (annule_mouvement_id non posé,
  // dette assumée — spec v2 §14), le commentaire est la seule trace lisible
  // reliant une annulation à ce qu'elle corrige : rendu obligatoire pour ce
  // motif précis (spec v2 §12, "18 septembre").
  const commentRequired = motif === 'annulation' && commentaire.trim() === ''

  const canSubmit =
    Boolean(refCode) &&
    Boolean(emplacementCode) &&
    Boolean(conditionnementId) &&
    totalPieces > 0 &&
    !commentRequired &&
    (sens === 'transfert' ? Boolean(destinationCode) && destinationCode !== emplacementCode : Boolean(motif))

  function handleArm() {
    if (!canSubmit) return
    if (!armed) {
      setArmed(true)
      armTimer.current = setTimeout(() => setArmed(false), 3000)
      return
    }
    resetArm()
    void submit()
  }

  async function submit() {
    if (!refCode || !emplacementCode || !conditionnementId || !conditionnement || !auteur) return
    setStatus({ kind: 'saving' })
    try {
      const ts = new Date().toISOString()

      if (sens === 'transfert') {
        if (!destinationCode) return
        const available = await getStock(emplacementCode, refCode, conditionnementId)
        if (totalPieces > available) {
          setStatus({
            kind: 'error',
            message: interpolate(t.movement.insufficientStock, { available }),
          })
          return
        }
        const transfertId = crypto.randomUUID()
        const rows: MouvementInsert[] = [
          {
            id: crypto.randomUUID(),
            ts,
            ref_code: refCode,
            emplacement_code: emplacementCode,
            quantite_pieces: -totalPieces,
            motif: 'transfert_sortie',
            commentaire: commentaire || null,
            transfert_id: transfertId,
            conditionnement_id: conditionnementId,
            auteur,
          },
          {
            id: crypto.randomUUID(),
            ts,
            ref_code: refCode,
            emplacement_code: destinationCode,
            quantite_pieces: totalPieces,
            motif: 'transfert_entree',
            commentaire: commentaire || null,
            transfert_id: transfertId,
            conditionnement_id: conditionnementId,
            auteur,
          },
        ]
        await insertMouvements(rows)
      } else {
        if (!motif) return
        const signed = sens === 'sortie' ? -totalPieces : totalPieces
        if (sens === 'sortie') {
          const available = await getStock(emplacementCode, refCode, conditionnementId)
          if (totalPieces > available) {
            setStatus({
              kind: 'error',
              message: interpolate(t.movement.insufficientStock, { available }),
            })
            return
          }
        }
        const row: MouvementInsert = {
          id: crypto.randomUUID(),
          ts,
          ref_code: refCode,
          emplacement_code: emplacementCode,
          quantite_pieces: signed,
          motif,
          commentaire: commentaire || null,
          conditionnement_id: conditionnementId,
          auteur,
        }
        await insertMouvements([row])
      }

      // Un mouvement change le stock (§3, cache de lecture) — rafraîchit
      // pour que Recherche/l'instantané informatif reflète l'écriture qui
      // vient d'aboutir, sans attendre le prochain déclencheur générique.
      void refreshReferentielCache() // ne bloque jamais la confirmation d'une écriture réussie
      setStatus({ kind: 'success' })
      setCartons(0)
      setPieces(0)
      setCommentaire('')
      setMotif('')
      setDestinationCode(null)
    } catch (e) {
      setStatus({ kind: 'error', message: extractErrorMessage(e, t.common.unknownError) })
    }
  }

  return (
    <main className="movement">
      <button className="back-link" onClick={onBack}>
        ← {t.movement.back}
      </button>
      <h1>{t.movement.title}</h1>

      <div className="sens-picker">
        <button className={sens === 'entree' ? 'active' : ''} onClick={() => changeSens('entree')}>
          {t.movement.sensEntree}
        </button>
        <button className={sens === 'sortie' ? 'active' : ''} onClick={() => changeSens('sortie')}>
          {t.movement.sensSortie}
        </button>
        <button className={sens === 'transfert' ? 'active' : ''} onClick={() => changeSens('transfert')}>
          {t.movement.sensTransfert}
        </button>
      </div>

      <label className="field-label">
        {t.movement.reference}
        <SearchSelect
          options={referenceOptions}
          value={refCode}
          onChange={setRefCode}
          placeholder={t.movement.referenceSearch}
          filter={(query) =>
            matchReferences(query, references)
              .slice(0, 8)
              .map((r) => ({
                value: r.code,
                label: r.libelle ? `${r.code} — ${r.libelle}` : r.code,
              }))
          }
        />
      </label>

      <label className="field-label">
        {t.movement.emplacement}
        <SearchSelect
          options={emplacementOptions}
          value={emplacementCode}
          onChange={setEmplacementCode}
          placeholder={t.movement.emplacementSearch}
        />
      </label>

      {sens === 'transfert' && (
        <label className="field-label">
          {t.movement.emplacementDestination}
          <SearchSelect
            options={emplacementOptions.filter((o) => o.value !== emplacementCode)}
            value={destinationCode}
            onChange={setDestinationCode}
            placeholder={t.movement.emplacementSearch}
          />
        </label>
      )}

      {conditionnements.length > 1 && (
        <label className="field-label">
          {t.movement.conditionnement}
          <select value={conditionnementId ?? ''} onChange={(e) => setConditionnementId(e.target.value)}>
            {conditionnements.map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle_court ?? `${c.pieces_par_carton}p/c`}
                {c.a_ecouler ? ` — ${t.movement.aEcouler}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="quantity-row">
        <label className="field-label">
          {t.movement.cartons}
          <NumberStepper value={cartons} onChange={setCartons} />
        </label>
        <label className="field-label">
          {t.movement.pieces}
          <NumberStepper value={pieces} onChange={setPieces} />
        </label>
      </div>

      {conditionnement && (
        <p className="quantity-formula">
          {interpolate(t.movement.totalFormula, {
            cartons,
            taux: conditionnement.pieces_par_carton,
            pieces,
            total: totalPieces,
          })}
        </p>
      )}

      {sens !== 'transfert' && (
        <label className="field-label">
          {t.movement.motif}
          <select value={motif} onChange={(e) => setMotif(e.target.value as MotifKey)}>
            <option value="" disabled>
              {t.movement.motifPlaceholder}
            </option>
            {motifOptions.map((m) => (
              <option key={m} value={m}>
                {t.motifs[m]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field-label">
        {motif === 'annulation' ? t.movement.commentRequiredAnnulation : t.movement.comment}
        <input
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          required={motif === 'annulation'}
        />
      </label>

      <button
        className={`arm-button${armed ? ' armed' : ''}`}
        disabled={!canSubmit || status.kind === 'saving'}
        onClick={handleArm}
      >
        {armed ? t.movement.confirmArmed : t.common.validate}
      </button>

      {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
      {status.kind === 'success' && <p className="form-status">{t.movement.success}</p>}
    </main>
  )
}

function NumberStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // preventDefault sur mousedown/touchstart : un <button> qui reçoit le
  // focus par défaut ferme le clavier virtuel iOS le temps de l'appui,
  // ce qui interrompt une saisie en cours dans le champ voisin.
  const keepFocus = (e: MouseEvent | TouchEvent) => e.preventDefault()
  return (
    <div className="number-stepper">
      <button type="button" onMouseDown={keepFocus} onTouchStart={keepFocus} onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
      />
      <button type="button" onMouseDown={keepFocus} onTouchStart={keepFocus} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}
