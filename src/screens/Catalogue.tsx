import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useI18n, interpolate, formatNumber } from '../i18n'
import {
  countReferenceUsage,
  deleteReference,
  listClients,
  listConditionnementsByRef,
  listReferences,
  listStockTotalsByReference,
  matchReferences,
  upsertReferenceWithConditionnements,
  ReferenceInUseError,
  type ConditionnementSpec,
} from '../lib/db'
import { extractErrorMessage } from '../lib/errors'
import { refreshReferentielCache } from '../lib/referentielCache'
import type { Client, Conditionnement, Reference } from '../lib/types'
import SearchSelect from '../components/SearchSelect'

// Catalogue (spec 2.46 §6.8) : manque révélé le 18 septembre — les Réglages
// sont un entonnoir en écriture seule, on y crée une référence et on ne la
// revoit jamais, d'où des fautes de saisie invisibles et irréparables.
// Le Catalogue est d'abord une surface de LECTURE (lister, chercher,
// vérifier), la modification ensuite — c'est l'inverse des Réglages.
// Noyau phase 1 seulement (§2, révision du 18 septembre) : le drapeau
// `actif` et les champs tarif/dimensions attendent la phase 2.
export default function Catalogue({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n()
  const [references, setReferences] = useState<Reference[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [conditionnementsByRef, setConditionnementsByRef] = useState<Map<string, Conditionnement[]>>(new Map())
  const [stockTotals, setStockTotals] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [openCode, setOpenCode] = useState<string | null>(null)

  async function load() {
    const [refs, cls, conds, totals] = await Promise.all([
      listReferences(),
      listClients(),
      listConditionnementsByRef(),
      listStockTotalsByReference(),
    ])
    setReferences(refs)
    setClients(cls)
    setConditionnementsByRef(conds)
    setStockTotals(totals)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    load()
      .then(() => {
        if (!cancelled) setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(extractErrorMessage(err, t.common.unknownError))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const clientNomByCode = useMemo(() => new Map(clients.map((c) => [c.code, c.nom])), [clients])

  const matchedCodes = useMemo(() => {
    if (!query.trim()) return null
    return new Set(matchReferences(query, references).map((r) => r.code))
  }, [query, references])

  const filtered = references.filter((r) => {
    if (matchedCodes && !matchedCodes.has(r.code)) return false
    if (clientFilter && r.client_code !== clientFilter) return false
    return true
  })

  function conditionnementSummary(code: string): string {
    const list = conditionnementsByRef.get(code) ?? []
    return list
      .map((c) => (c.libelle_court ?? `${c.pieces_par_carton}p/c`) + (c.a_ecouler ? ` (${t.movement.aEcouler})` : ''))
      .join(', ')
  }

  async function reload() {
    await load()
  }

  return (
    <main className="settings">
      <button className="back-link" onClick={onBack}>
        ← {t.movement.back}
      </button>
      <h1>{t.catalogue.title}</h1>

      <CreateReferenceForm onCreated={reload} />

      <div className="settings-form">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.catalogue.searchPlaceholder}
        />
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">{t.catalogue.clientFilterAll}</option>
          {clients.map((c) => (
            <option key={c.code} value={c.code}>
              {c.nom}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="form-status">{t.common.loading}</p>
      ) : loadError ? (
        <p className="form-status form-error">{loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="form-status">{t.catalogue.noResults}</p>
      ) : (
        <ul className="casier-list">
          {filtered.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                className="casier-row"
                onClick={() => setOpenCode(openCode === r.code ? null : r.code)}
              >
                <span>
                  {r.code}
                  {r.libelle ? ` — ${r.libelle}` : ''}
                  {' · '}
                  {clientNomByCode.get(r.client_code) ?? r.client_code}
                  {conditionnementSummary(r.code) ? ` · ${conditionnementSummary(r.code)}` : ''}
                </span>
                <span className="casier-status">
                  {formatNumber(locale, stockTotals.get(r.code) ?? 0)}
                </span>
              </button>
              {openCode === r.code && (
                <ReferenceFiche
                  reference={r}
                  clients={clients}
                  conditionnements={conditionnementsByRef.get(r.code) ?? []}
                  onChanged={reload}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

// Création (§6.6/§6.8 : déménagée des Réglages — « on ne crée pas à un
// endroit pour vérifier à un autre »). Reprend telle quelle la logique de
// l'ancienne ReferenceForm des Réglages.
function CreateReferenceForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useI18n()
  const [clients, setClients] = useState<Client[]>([])
  const [clientCode, setClientCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [libelle, setLibelle] = useState('')
  const [pieces, setPieces] = useState('')
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  useEffect(() => {
    listClients().then(setClients).catch(() => {})
  }, [status])

  const clientOptions = useMemo(() => clients.map((c) => ({ value: c.code, label: c.nom })), [clients])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!clientCode) return
    setStatus({ kind: 'saving' })
    try {
      await upsertReferenceWithConditionnements(code.trim(), libelle.trim(), clientCode, [
        { piecesParCarton: Number(pieces) },
      ])
      void refreshReferentielCache()
      setStatus({ kind: 'saved' })
      setCode('')
      setLibelle('')
      setPieces('')
      onCreated()
    } catch (err) {
      setStatus({ kind: 'error', message: extractErrorMessage(err, t.settings.saveError) })
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <h2>{t.settings.addReference}</h2>
      <label className="field-label">
        {t.settings.client}
        <SearchSelect
          options={clientOptions}
          value={clientCode}
          onChange={setClientCode}
          placeholder={t.settings.clientSearch}
        />
      </label>
      <label>
        {t.settings.code}
        <input value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      <label>
        {t.settings.libelle}
        <input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
      </label>
      <label>
        {t.settings.piecesParCarton}
        <input type="number" min={1} value={pieces} onChange={(e) => setPieces(e.target.value)} required />
      </label>
      <button type="submit" disabled={status.kind === 'saving' || !clientCode}>
        {t.common.save}
      </button>
      {status.kind === 'saved' && <p className="form-status">{t.settings.saved}</p>}
      {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
    </form>
  )
}

type UsageState =
  | { kind: 'loading' }
  | { kind: 'loaded'; mouvements: number; comptageLignes: number }
  | { kind: 'error'; message: string }

// Fiche de référence (§6.8) : attributs descriptifs modifiables (libellé,
// client), code non modifiable — c'est l'identité et la clé étrangère de
// tout l'historique (§4). Les conditionnements sont relus tels quels et
// renvoyés intacts à upsertReferenceWithConditionnements : cette fiche ne
// les modifie pas, seulement libellé/client.
function ReferenceFiche({
  reference,
  clients,
  conditionnements,
  onChanged,
}: {
  reference: Reference
  clients: Client[]
  conditionnements: Conditionnement[]
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [libelle, setLibelle] = useState(reference.libelle ?? '')
  const [clientCode, setClientCode] = useState<string | null>(reference.client_code)
  const [saveStatus, setSaveStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const [usage, setUsage] = useState<UsageState>({ kind: 'loading' })
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState<{ kind: 'idle' } | { kind: 'deleting' } | { kind: 'error'; message: string }>(
    { kind: 'idle' },
  )

  useEffect(() => {
    let cancelled = false
    countReferenceUsage(reference.code)
      .then(({ mouvements, comptageLignes }) => {
        if (!cancelled) setUsage({ kind: 'loaded', mouvements, comptageLignes })
      })
      .catch((err) => {
        if (!cancelled) setUsage({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
      })
    return () => {
      cancelled = true
    }
  }, [reference.code, t])

  const clientOptions = useMemo(() => clients.map((c) => ({ value: c.code, label: c.nom })), [clients])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!clientCode) return
    setSaveStatus({ kind: 'saving' })
    try {
      const specs: ConditionnementSpec[] = conditionnements.map((c) => ({
        piecesParCarton: c.pieces_par_carton,
        libelleCourt: c.libelle_court,
      }))
      await upsertReferenceWithConditionnements(reference.code, libelle.trim(), clientCode, specs)
      void refreshReferentielCache()
      setSaveStatus({ kind: 'saved' })
      onChanged()
    } catch (err) {
      setSaveStatus({ kind: 'error', message: extractErrorMessage(err, t.settings.saveError) })
    }
  }

  async function handleDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true)
      setTimeout(() => setDeleteArmed(false), 3000)
      return
    }
    setDeleteArmed(false)
    setDeleteStatus({ kind: 'deleting' })
    try {
      await deleteReference(reference.code)
      void refreshReferentielCache()
      onChanged()
    } catch (err) {
      if (err instanceof ReferenceInUseError) {
        setUsage({ kind: 'loaded', mouvements: err.mouvements, comptageLignes: err.comptageLignes })
        setDeleteStatus({ kind: 'idle' })
      } else {
        setDeleteStatus({ kind: 'error', message: extractErrorMessage(err, t.common.unknownError) })
      }
    }
  }

  const canDelete = usage.kind === 'loaded' && usage.mouvements === 0 && usage.comptageLignes === 0

  return (
    <div className="settings-form">
      <h2>{t.catalogue.editTitle}</h2>
      <form onSubmit={handleSave}>
        <p className="quantity-formula">{interpolate(t.catalogue.codeLabel, { code: reference.code })}</p>
        <label className="field-label">
          {t.settings.client}
          <SearchSelect
            options={clientOptions}
            value={clientCode}
            onChange={setClientCode}
            placeholder={t.settings.clientSearch}
          />
        </label>
        <label>
          {t.settings.libelle}
          <input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
        </label>
        <button type="submit" disabled={saveStatus.kind === 'saving' || !clientCode}>
          {t.common.save}
        </button>
        {saveStatus.kind === 'saved' && <p className="form-status">{t.settings.saved}</p>}
        {saveStatus.kind === 'error' && <p className="form-status form-error">{saveStatus.message}</p>}
      </form>

      {usage.kind === 'loading' && <p className="form-status">{t.common.loading}</p>}
      {usage.kind === 'error' && <p className="form-status form-error">{usage.message}</p>}
      {usage.kind === 'loaded' && !canDelete && (
        <p className="form-status">
          {interpolate(t.catalogue.usageBlocking, {
            mouvements: usage.mouvements,
            comptageLignes: usage.comptageLignes,
          })}
        </p>
      )}
      {canDelete && (
        <>
          <button
            type="button"
            className={`arm-button${deleteArmed ? ' armed' : ''}`}
            onClick={handleDelete}
            disabled={deleteStatus.kind === 'deleting'}
          >
            {deleteArmed ? t.catalogue.deleteArmed : t.catalogue.deleteButton}
          </button>
          {deleteStatus.kind === 'error' && <p className="form-status form-error">{deleteStatus.message}</p>}
        </>
      )}
    </div>
  )
}
