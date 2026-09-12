import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, interpolate } from '../i18n'
import { supabase } from '../lib/supabase'
import {
  closeComptage,
  getOrCreateComptage,
  getStock,
  insertMouvements,
  listConditionnements,
  listEmplacements,
  listReferences,
  listStockAtEmplacement,
  markAttenduConsulte,
} from '../lib/db'
import type { Comptage, Conditionnement, Emplacement, MouvementInsert, Reference } from '../lib/types'
import SearchSelect from '../components/SearchSelect'

interface Line {
  refCode: string
  conditionnementId: string
  theorique: number
  piecesParCarton: number
  libelleCourt: string | null
  aEcouler: boolean
  cartons: string
  pieces: string
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'success' } | { kind: 'error'; message: string }

// Le comptage se fait à l'aveugle : le théorique n'apparaît que sur demande
// (« voir l'attendu »), et cette consultation est tracée sur le comptage
// lui-même (§6.5). Ouvrir un casier déjà en cours reprend la même ligne —
// c'est ce qui fait office de pause/reprise, sans écran dédié.
export default function Inventory({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [auteur, setAuteur] = useState<string | null>(null)
  const [emplacements, setEmplacements] = useState<Emplacement[]>([])
  const [references, setReferences] = useState<Reference[]>([])

  const [emplacementCode, setEmplacementCode] = useState<string | null>(null)
  const [comptage, setComptage] = useState<Comptage | null>(null)
  const [resumed, setResumed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [attenduVisible, setAttenduVisible] = useState(false)

  const [extraRefCode, setExtraRefCode] = useState<string | null>(null)
  const [extraConditionnements, setExtraConditionnements] = useState<Conditionnement[]>([])
  const [extraConditionnementId, setExtraConditionnementId] = useState<string | null>(null)

  const [armed, setArmed] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuteur(data.session?.user.email ?? null))
    listEmplacements().then(setEmplacements).catch(() => {})
    listReferences().then(setReferences).catch(() => {})
  }, [])

  useEffect(() => {
    if (!emplacementCode) {
      setComptage(null)
      setLines([])
      setAttenduVisible(false)
      setResumed(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setStatus({ kind: 'idle' })
    async function load() {
      const { comptage: c, resumed: wasResumed } = await getOrCreateComptage(emplacementCode!)
      const stockLines = await listStockAtEmplacement(emplacementCode!)
      const conditionnementsByRef = new Map<string, Conditionnement[]>()
      for (const s of stockLines) {
        if (!conditionnementsByRef.has(s.ref_code)) {
          conditionnementsByRef.set(s.ref_code, await listConditionnements(s.ref_code))
        }
      }
      if (cancelled) return
      setComptage(c)
      setResumed(wasResumed)
      setAttenduVisible(c.attendu_consulte)
      setLines(
        stockLines.map((s) => {
          const cond = conditionnementsByRef.get(s.ref_code)!.find((cc) => cc.id === s.conditionnement_id)!
          return {
            refCode: s.ref_code,
            conditionnementId: s.conditionnement_id,
            theorique: s.quantite_pieces,
            piecesParCarton: cond.pieces_par_carton,
            libelleCourt: cond.libelle_court,
            aEcouler: cond.a_ecouler,
            cartons: '',
            pieces: '',
          }
        }),
      )
    }
    load()
      .catch((e) => setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) }))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
    }
  }, [emplacementCode])

  useEffect(() => {
    if (!extraRefCode) {
      setExtraConditionnements([])
      setExtraConditionnementId(null)
      return
    }
    listConditionnements(extraRefCode).then((list) => {
      setExtraConditionnements(list)
      setExtraConditionnementId(list[0]?.id ?? null)
    })
  }, [extraRefCode])

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [])

  // Toute modification d'une ligne après armement invalide la confirmation :
  // le second appui doit porter sur exactement ce qui a été vu au premier.
  useEffect(() => {
    resetArm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

  function resetArm() {
    setArmed(false)
    if (armTimer.current) clearTimeout(armTimer.current)
  }

  const emplacementOptions = useMemo(
    () => emplacements.map((e) => ({ value: e.code, label: e.code })),
    [emplacements],
  )
  const referenceOptions = useMemo(
    () =>
      references.map((r) => ({ value: r.code, label: r.libelle ? `${r.code} — ${r.libelle}` : r.code })),
    [references],
  )

  function lineTotal(line: Line): number {
    return (Number(line.cartons) || 0) * line.piecesParCarton + (Number(line.pieces) || 0)
  }

  function lineTouched(line: Line): boolean {
    return line.cartons !== '' || line.pieces !== ''
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  async function handleShowExpected() {
    setAttenduVisible(true)
    if (comptage && !comptage.attendu_consulte) {
      try {
        await markAttenduConsulte(comptage.id)
        setComptage({ ...comptage, attendu_consulte: true })
      } catch {
        // l'affichage reste visible même si l'écriture du flag échoue
      }
    }
  }

  async function addUnexpectedLine() {
    if (!extraRefCode || !extraConditionnementId || !emplacementCode) return
    if (lines.some((l) => l.refCode === extraRefCode && l.conditionnementId === extraConditionnementId)) {
      setExtraRefCode(null)
      return
    }
    const cond = extraConditionnements.find((c) => c.id === extraConditionnementId)
    if (!cond) return
    const theorique = await getStock(emplacementCode, extraRefCode, extraConditionnementId)
    setLines((prev) => [
      ...prev,
      {
        refCode: extraRefCode,
        conditionnementId: extraConditionnementId,
        theorique,
        piecesParCarton: cond.pieces_par_carton,
        libelleCourt: cond.libelle_court,
        aEcouler: cond.a_ecouler,
        cartons: '',
        pieces: '',
      },
    ])
    setExtraRefCode(null)
  }

  const touchedCount = lines.filter(lineTouched).length
  const canSubmit = Boolean(comptage) && !loading && status.kind !== 'saving'

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
    if (!comptage || !emplacementCode || !auteur) return
    setStatus({ kind: 'saving' })
    try {
      const ts = new Date().toISOString()
      const rows: MouvementInsert[] = []
      for (const line of lines) {
        if (!lineTouched(line)) continue
        const ecart = lineTotal(line) - line.theorique
        if (ecart === 0) continue
        rows.push({
          id: crypto.randomUUID(),
          ts,
          ref_code: line.refCode,
          emplacement_code: emplacementCode,
          quantite_pieces: ecart,
          motif: 'ajustement_inventaire',
          comptage_id: comptage.id,
          conditionnement_id: line.conditionnementId,
          auteur,
        })
      }
      if (rows.length > 0) await insertMouvements(rows)
      await closeComptage(comptage.id)
      setStatus({ kind: 'success' })
      setEmplacementCode(null)
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <main className="movement inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.title}</h1>

      <label className="field-label">
        {t.inventory.emplacement}
        <SearchSelect
          options={emplacementOptions}
          value={emplacementCode}
          onChange={setEmplacementCode}
          placeholder={t.inventory.emplacementSearch}
        />
      </label>

      {loading && <p className="form-status">{t.inventory.loading}</p>}

      {comptage && !loading && (
        <>
          {resumed && <p className="form-status">{t.inventory.resumed}</p>}

          {lines.length === 0 && <p className="form-status">{t.inventory.noStock}</p>}

          {lines.map((line, index) => {
            const total = lineTotal(line)
            const touched = lineTouched(line)
            const ecart = total - line.theorique
            return (
              <div className="inventory-line" key={`${line.refCode}:${line.conditionnementId}`}>
                <p className="inventory-line-title">
                  {line.refCode}
                  {line.libelleCourt ? ` — ${line.libelleCourt}` : ''}
                  {line.aEcouler ? ` (${t.movement.aEcouler})` : ''}
                </p>
                {attenduVisible && (
                  <p className="quantity-formula">
                    {t.inventory.theoretical} : {line.theorique}
                  </p>
                )}
                <div className="quantity-row">
                  <label className="field-label">
                    {t.inventory.cartons}
                    <input
                      id={`inv-cartons-${index}`}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      enterKeyHint="next"
                      value={line.cartons}
                      onChange={(e) => updateLine(index, { cartons: e.target.value.replace(/\D/g, '') })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const next = document.getElementById(`inv-pieces-${index}`)
                          next?.focus()
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    {t.inventory.pieces}
                    <input
                      id={`inv-pieces-${index}`}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      enterKeyHint="next"
                      value={line.pieces}
                      onChange={(e) => updateLine(index, { pieces: e.target.value.replace(/\D/g, '') })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const next = document.getElementById(`inv-cartons-${index + 1}`)
                          next?.focus()
                        }
                      }}
                    />
                  </label>
                </div>
                {touched && (
                  <p className="quantity-formula">
                    {ecart === 0 ? t.inventory.noChange : interpolate(t.inventory.ecart, { ecart })}
                  </p>
                )}
              </div>
            )
          })}

          {!attenduVisible && (
            <button type="button" className="back-link" onClick={handleShowExpected}>
              {t.inventory.showExpected}
            </button>
          )}

          <div className="settings-form">
            <h2>{t.inventory.addUnexpected}</h2>
            <label className="field-label">
              {t.inventory.reference}
              <SearchSelect
                options={referenceOptions}
                value={extraRefCode}
                onChange={setExtraRefCode}
                placeholder={t.inventory.referenceSearch}
              />
            </label>
            {extraConditionnements.length > 1 && (
              <label className="field-label">
                {t.inventory.conditionnement}
                <select value={extraConditionnementId ?? ''} onChange={(e) => setExtraConditionnementId(e.target.value)}>
                  {extraConditionnements.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.libelle_court ?? `${c.pieces_par_carton}p/c`}
                      {c.a_ecouler ? ` — ${t.inventory.aEcouler}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" onClick={addUnexpectedLine} disabled={!extraRefCode || !extraConditionnementId}>
              {t.common.add}
            </button>
          </div>

          <button
            className={`arm-button${armed ? ' armed' : ''}`}
            disabled={!canSubmit}
            onClick={handleArm}
          >
            {armed ? t.inventory.confirmArmed : t.inventory.validateCasier}
          </button>

          {touchedCount === 0 && <p className="form-status">{t.inventory.noChange}</p>}
        </>
      )}

      {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
      {status.kind === 'success' && <p className="form-status">{t.inventory.success}</p>}
    </main>
  )
}
