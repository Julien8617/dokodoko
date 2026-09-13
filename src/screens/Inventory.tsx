import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, interpolate } from '../i18n'
import { supabase } from '../lib/supabase'
import { listClients, listConditionnements, listReferences } from '../lib/db'
import {
  createInventaire,
  deleteCasierLigne,
  getActiveInventaire,
  getInventaireSynthese,
  getOrCreateCasier,
  listInventaireEmplacements,
  listLatestCasierLignes,
  markCasierVisite,
  saveCasierLigne,
  stockAsOfEmplacement,
  type SyntheseReference,
} from '../lib/inventaireDb'
import type { Client, Conditionnement, Inventaire, Reference, ScopeKind } from '../lib/types'
import SearchSelect from '../components/SearchSelect'
import CountStepper from '../components/CountStepper'

type Phase = 'launch' | 'list' | 'count' | 'ecarts'

// Module Inventaire v2 (brief 2026-09-14) : lancement/reprise avec stock
// théorique figé, liste des casiers dans l'ordre de parcours, comptage avec
// précédent/suivant, synthèse des écarts en deux niveaux. Le traitement des
// écarts (recompter/corriger/justifier) et la clôture sont volontairement
// hors phase 1 — voir t.inventory.phase1Notice.
export default function Inventory({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('launch')
  const [inventaire, setInventaire] = useState<Inventaire | null>(null)
  const [emplacements, setEmplacements] = useState<string[]>([])
  const [visited, setVisited] = useState<Set<string>>(new Set())
  const [currentIndex, setCurrentIndex] = useState(0)
  const [auteur, setAuteur] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuteur(data.session?.user.email ?? null))
  }, [])

  async function refreshVisited(inv: Inventaire) {
    const { data } = await supabase
      .from('comptages')
      .select('emplacement_code, statut')
      .eq('inventaire_id', inv.id)
    setVisited(new Set((data ?? []).filter((c) => c.statut === 'clos').map((c) => c.emplacement_code)))
  }

  async function handleReady(inv: Inventaire) {
    setInventaire(inv)
    const list = await listInventaireEmplacements(inv)
    setEmplacements(list)
    await refreshVisited(inv)
    setPhase('list')
  }

  function handleOpenCasier(index: number) {
    setCurrentIndex(index)
    setPhase('count')
  }

  async function handleCasierLeft(emplacementCode: string) {
    setVisited((prev) => new Set(prev).add(emplacementCode))
  }

  if (phase === 'launch' || !inventaire) {
    return <Launch onBack={onBack} onReady={handleReady} />
  }

  if (phase === 'count') {
    return (
      <Count
        inventaire={inventaire}
        emplacements={emplacements}
        index={currentIndex}
        auteur={auteur}
        onIndexChange={setCurrentIndex}
        onCasierLeft={handleCasierLeft}
        onBackToList={() => setPhase('list')}
      />
    )
  }

  if (phase === 'ecarts') {
    return <Ecarts inventaire={inventaire} onBack={() => setPhase('list')} />
  }

  return (
    <CasierList
      emplacements={emplacements}
      visited={visited}
      onOpenCasier={handleOpenCasier}
      onViewEcarts={() => setPhase('ecarts')}
      onBack={onBack}
    />
  )
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
// Écran 2 — liste des casiers
// ---------------------------------------------------------------------

function CasierList({
  emplacements,
  visited,
  onOpenCasier,
  onViewEcarts,
  onBack,
}: {
  emplacements: string[]
  visited: Set<string>
  onOpenCasier: (index: number) => void
  onViewEcarts: () => void
  onBack: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')

  const total = emplacements.length
  const done = emplacements.filter((e) => visited.has(e)).length
  const incomplete = done < total

  const filtered = query.trim()
    ? emplacements.filter((e) => e.toLowerCase().includes(query.trim().toLowerCase()))
    : emplacements

  return (
    <main className="inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.title}</h1>
      <p className="quantity-formula">{interpolate(t.inventory.progress, { done, total })}</p>
      {incomplete && <p className="form-status form-error">{t.inventory.incomplete}</p>}

      {total === 0 ? (
        <p className="form-status">{t.inventory.emptyList}</p>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.inventory.emplacementSearch}
          />
          <ul className="casier-list">
            {filtered.map((code) => {
              const isDone = visited.has(code)
              return (
                <li key={code}>
                  <button
                    type="button"
                    className={`casier-row${isDone ? ' done' : ''}`}
                    onClick={() => onOpenCasier(emplacements.indexOf(code))}
                  >
                    <span>{code}</span>
                    <span className="casier-status">
                      {isDone ? t.inventory.statusDone : t.inventory.statusTodo}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <button className="arm-button" onClick={onViewEcarts}>
        {t.inventory.viewEcarts}
      </button>
    </main>
  )
}

// ---------------------------------------------------------------------
// Écran 3 — compter un casier
// ---------------------------------------------------------------------

interface CasierLine {
  refCode: string
  conditionnementId: string
  piecesParCarton: number
  libelleCourt: string | null
  aEcouler: boolean
  cartons: string
  pieces: string
  savedCartons: string | null // null = jamais enregistré (ligne encore vierge)
  savedPieces: string | null
  isUnexpected: boolean // ajoutée via "référence trouvée", pas du théorique
}

function Count({
  inventaire,
  emplacements,
  index,
  auteur,
  onIndexChange,
  onCasierLeft,
  onBackToList,
}: {
  inventaire: Inventaire
  emplacements: string[]
  index: number
  auteur: string | null
  onIndexChange: (i: number) => void
  onCasierLeft: (emplacementCode: string) => void
  onBackToList: () => void
}) {
  const { t } = useI18n()
  const emplacementCode = emplacements[index]
  const [comptageId, setComptageId] = useState<string | null>(null)
  const [lines, setLines] = useState<CasierLine[]>([])
  const [loading, setLoading] = useState(true)
  const [references, setReferences] = useState<Reference[]>([])
  const [extraRefCode, setExtraRefCode] = useState<string | null>(null)
  const [extraConditionnements, setExtraConditionnements] = useState<Conditionnement[]>([])
  const [extraConditionnementId, setExtraConditionnementId] = useState<string | null>(null)

  useEffect(() => {
    listReferences().then(setReferences).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      const { comptage } = await getOrCreateCasier(inventaire.id, emplacementCode)
      const theorique = await stockAsOfEmplacement(inventaire.frozen_ts, emplacementCode)
      const saved = await listLatestCasierLignes(comptage.id)

      const refsNeeded = new Set([...theorique.map((r) => r.ref_code), ...saved.map((s) => s.ref_code)])
      const conditionnementCache = new Map<string, Conditionnement>()
      for (const ref of refsNeeded) {
        for (const c of await listConditionnements(ref)) conditionnementCache.set(c.id, c)
      }

      const byKey = new Map<string, CasierLine>()
      for (const row of theorique) {
        const cond = conditionnementCache.get(row.conditionnement_id)
        if (!cond) continue
        byKey.set(`${row.ref_code}|${row.conditionnement_id}`, {
          refCode: row.ref_code,
          conditionnementId: row.conditionnement_id,
          piecesParCarton: cond.pieces_par_carton,
          libelleCourt: cond.libelle_court,
          aEcouler: cond.a_ecouler,
          cartons: '',
          pieces: '',
          savedCartons: null,
          savedPieces: null,
          isUnexpected: false,
        })
      }
      for (const s of saved) {
        const key = `${s.ref_code}|${s.conditionnement_id}`
        const cond = conditionnementCache.get(s.conditionnement_id)
        const existing = byKey.get(key) ?? {
          refCode: s.ref_code,
          conditionnementId: s.conditionnement_id,
          piecesParCarton: cond?.pieces_par_carton ?? 0,
          libelleCourt: cond?.libelle_court ?? null,
          aEcouler: cond?.a_ecouler ?? false,
          cartons: '',
          pieces: '',
          savedCartons: null,
          savedPieces: null,
          isUnexpected: !theorique.some(
            (r) => r.ref_code === s.ref_code && r.conditionnement_id === s.conditionnement_id,
          ),
        }
        existing.cartons = String(s.cartons)
        existing.pieces = String(s.pieces)
        existing.savedCartons = String(s.cartons)
        existing.savedPieces = String(s.pieces)
        byKey.set(key, existing)
      }

      if (cancelled) return
      setComptageId(comptage.id)
      setLines([...byKey.values()])
    }
    load().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [emplacementCode, inventaire.id, inventaire.frozen_ts])

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

  // `lines` capturé dans les closures (onBlur, leave) serait figé au rendu où
  // la fonction a été créée — updateLine ne le rafraîchit pas rétroactivement.
  // linesRef donne toujours l'état courant au moment de l'appel.
  const linesRef = useRef<CasierLine[]>([])
  useEffect(() => {
    linesRef.current = lines
  }, [lines])

  function updateLine(key: string, patch: Partial<CasierLine>) {
    setLines((prev) => prev.map((l) => (`${l.refCode}|${l.conditionnementId}` === key ? { ...l, ...patch } : l)))
  }

  // Retourne true si la ligne a une valeur enregistrée à l'issue de l'appel
  // (déjà présente ou tout juste écrite) — sert au marquage "compté" en aval.
  async function persistLine(key: string): Promise<boolean> {
    const line = linesRef.current.find((l) => `${l.refCode}|${l.conditionnementId}` === key)
    if (!line) return false
    const touched = line.cartons !== '' || line.pieces !== ''
    if (!touched) return line.savedCartons !== null
    if (line.cartons === line.savedCartons && line.pieces === line.savedPieces) return true
    if (!comptageId || !auteur) return false
    await saveCasierLigne(
      comptageId,
      line.refCode,
      line.conditionnementId,
      Number(line.cartons) || 0,
      Number(line.pieces) || 0,
      auteur,
    )
    updateLine(key, { savedCartons: line.cartons, savedPieces: line.pieces })
    return true
  }

  async function handleRemoveLine(line: CasierLine) {
    if (comptageId && line.savedCartons !== null) {
      await deleteCasierLigne(comptageId, line.refCode, line.conditionnementId)
    }
    setLines((prev) =>
      prev.filter((l) => !(l.refCode === line.refCode && l.conditionnementId === line.conditionnementId)),
    )
  }

  async function addUnexpectedLine() {
    if (!extraRefCode || !extraConditionnementId) return
    if (lines.some((l) => l.refCode === extraRefCode && l.conditionnementId === extraConditionnementId)) {
      setExtraRefCode(null)
      return
    }
    const cond = extraConditionnements.find((c) => c.id === extraConditionnementId)
    if (!cond) return
    setLines((prev) => [
      ...prev,
      {
        refCode: extraRefCode,
        conditionnementId: extraConditionnementId,
        piecesParCarton: cond.pieces_par_carton,
        libelleCourt: cond.libelle_court,
        aEcouler: cond.a_ecouler,
        cartons: '',
        pieces: '',
        savedCartons: null,
        savedPieces: null,
        isUnexpected: true,
      },
    ])
    setExtraRefCode(null)
  }

  // Ne marque le casier "compté" que si au moins une ligne a réellement une
  // valeur enregistrée — un simple passage sans rien saisir (Suivant en
  // rafale) ne doit ni gonfler la progression ni fausser la synthèse des
  // écarts (brief : "un partiel à moitié fait ne produit pas d'écart
  // exploitable").
  async function leave(next: () => void) {
    const keys = linesRef.current.map((l) => `${l.refCode}|${l.conditionnementId}`)
    let anySaved = false
    for (const key of keys) {
      if (await persistLine(key)) anySaved = true
    }
    if (anySaved && comptageId) {
      await markCasierVisite(comptageId)
      onCasierLeft(emplacementCode)
    }
    next()
  }

  const referenceOptions = useMemo(
    () => references.map((r) => ({ value: r.code, label: r.libelle ? `${r.code} — ${r.libelle}` : r.code })),
    [references],
  )

  const isFirst = index === 0
  const isLast = index === emplacements.length - 1

  return (
    <main className="inventory">
      <button className="back-link" onClick={() => leave(onBackToList)}>
        ← {t.inventory.backToList}
      </button>
      <h1>{emplacementCode}</h1>

      {loading ? (
        <p className="form-status">{t.inventory.loading}</p>
      ) : (
        <>
          {lines.length === 0 && <p className="form-status">{t.inventory.noExpected}</p>}

          {lines.map((line) => (
            <div className="inventory-line" key={`${line.refCode}|${line.conditionnementId}`}>
              <p className="inventory-line-title">
                {line.refCode}
                {line.libelleCourt ? ` — ${line.libelleCourt}` : ''}
                {line.aEcouler ? ` (${t.inventory.aEcouler})` : ''}
              </p>
              <div className="quantity-row">
                <label className="field-label">
                  {t.inventory.cartons}
                  <CountStepper
                    value={line.cartons}
                    onChange={(v) => updateLine(`${line.refCode}|${line.conditionnementId}`, { cartons: v })}
                    onBlur={() => persistLine(`${line.refCode}|${line.conditionnementId}`)}
                  />
                </label>
                <label className="field-label">
                  {t.inventory.pieces}
                  <CountStepper
                    value={line.pieces}
                    onChange={(v) => updateLine(`${line.refCode}|${line.conditionnementId}`, { pieces: v })}
                    onBlur={() => persistLine(`${line.refCode}|${line.conditionnementId}`)}
                  />
                </label>
              </div>
              {line.isUnexpected && (
                <button type="button" className="back-link" onClick={() => handleRemoveLine(line)}>
                  {t.inventory.removeLine}
                </button>
              )}
            </div>
          ))}

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
                <select
                  value={extraConditionnementId ?? ''}
                  onChange={(e) => setExtraConditionnementId(e.target.value)}
                >
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
        </>
      )}

      <div className="sens-picker">
        <button type="button" disabled={isFirst} onClick={() => leave(() => onIndexChange(index - 1))}>
          {t.inventory.prev}
        </button>
        {isLast ? (
          <button type="button" onClick={() => leave(onBackToList)}>
            {t.inventory.backToList}
          </button>
        ) : (
          <button type="button" onClick={() => leave(() => onIndexChange(index + 1))}>
            {t.inventory.next}
          </button>
        )}
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------
// Écran 4 — écarts (synthèse, lecture seule en phase 1)
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
  const enAttente = emplacements.length - visites.size

  return (
    <main className="inventory">
      <button className="back-link" onClick={onBack}>
        ← {t.inventory.back}
      </button>
      <h1>{t.inventory.ecartsTitle}</h1>
      <p className="login-hint">{t.inventory.phase1Notice}</p>

      {enAttente > 0 && (
        <p className="form-status form-error">
          {enAttente} {t.inventory.notAllVisited}
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
                  setOpenRef(openRef === `${ref.refCode}|${ref.conditionnementId}` ? null : `${ref.refCode}|${ref.conditionnementId}`)
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
