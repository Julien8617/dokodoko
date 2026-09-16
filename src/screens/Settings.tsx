import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { interpolate } from '../i18n/format'
import {
  generateEmplacements,
  insertClient,
  insertEmplacement,
  listClients,
  upsertReferenceWithConditionnements,
} from '../lib/db'
import { decodeImportFile } from '../lib/csvImport'
import {
  commitClientsImport,
  commitReferencesImport,
  commitStockOuvertureImport,
  previewClientsImport,
  previewReferencesImport,
  previewStockOuvertureImport,
  type ClientImportRow,
  type ReferenceImportRow,
  type StockOuverturePreview,
} from '../lib/importReferentiel'
import type { ImportPreview } from '../lib/csvImport'
import { refreshReferentielCache } from '../lib/referentielCache'
import { supabase } from '../lib/supabase'
import type { Client } from '../lib/types'
import VersionFooter from '../components/VersionFooter'
import SearchSelect from '../components/SearchSelect'

// Socle minimal de l'étape 2 de l'ordre de livraison (§12) : saisie manuelle
// unitaire, un élément à la fois (§7, §6.6). Les imports CSV et les exports
// viennent dans une étape ultérieure.
export default function Settings({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()

  return (
    <main className="settings">
      <button className="back-link" onClick={onBack}>
        ← {t.movement.back}
      </button>
      <h1>{t.settings.title}</h1>
      <ReferenceForm />
      <EmplacementGeneratorForm />
      <EmplacementForm />
      <ClientForm />
      <ClientsImportForm />
      <ReferencesImportForm />
      <StockOuvertureImportForm />
      <VersionFooter />
    </main>
  )
}

type ImportState<T> =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'previewed'; preview: ImportPreview<T> }
  | { kind: 'importing'; preview: ImportPreview<T> }
  | { kind: 'done'; message: string }

// Aperçu générique (§7 : "prévisualisation avant écriture, lignes rejetées
// avec numéro de ligne et motif") — partagé par Clients et Références, la
// logique métier (colonnes, règles de rejet, écriture) reste dans
// importReferentiel.ts, propre à chaque feuille.
function ImportPreviewPanel({ preview }: { preview: ImportPreview<unknown> }) {
  const { t } = useI18n()
  return (
    <div className="form-status">
      <p>{interpolate(t.settings.importPreviewValid, { count: preview.valid.length })}</p>
      {preview.rejected.length > 0 && (
        <>
          <p className="form-error">{interpolate(t.settings.importPreviewRejected, { count: preview.rejected.length })}</p>
          <ul>
            {preview.rejected.map((r) => (
              <li key={r.line} className="form-error">
                {interpolate(t.settings.importRejectedLine, { line: r.line, reason: r.reason })}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ClientsImportForm() {
  const { t } = useI18n()
  const [state, setState] = useState<ImportState<ClientImportRow>>({ kind: 'idle' })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // même fichier resélectionnable après une correction
    if (!file) return
    try {
      const text = await decodeImportFile(file)
      setState({ kind: 'previewed', preview: previewClientsImport(text) })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleImport() {
    if (state.kind !== 'previewed') return
    setState({ kind: 'importing', preview: state.preview })
    try {
      await commitClientsImport(state.preview.valid.map((r) => r.data))
      void refreshReferentielCache()
      setState({
        kind: 'done',
        message: interpolate(t.settings.importDoneClients, { count: state.preview.valid.length }),
      })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
      <h2>{t.settings.importClients}</h2>
      <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={state.kind === 'importing'} />
      {(state.kind === 'previewed' || state.kind === 'importing') && (
        <>
          <ImportPreviewPanel preview={state.preview} />
          <button
            type="button"
            onClick={handleImport}
            disabled={state.kind === 'importing' || state.preview.valid.length === 0}
          >
            {state.kind === 'importing' ? t.settings.importing : t.settings.importConfirm}
          </button>
        </>
      )}
      {state.kind === 'done' && <p className="form-status">{state.message}</p>}
      {state.kind === 'error' && <p className="form-status form-error">{state.message}</p>}
    </form>
  )
}

function ReferencesImportForm() {
  const { t } = useI18n()
  const [state, setState] = useState<ImportState<ReferenceImportRow>>({ kind: 'idle' })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await decodeImportFile(file)
      setState({ kind: 'previewed', preview: previewReferencesImport(text) })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleImport() {
    if (state.kind !== 'previewed') return
    setState({ kind: 'importing', preview: state.preview })
    try {
      const result = await commitReferencesImport(state.preview.valid.map((r) => r.data))
      void refreshReferentielCache()
      const parts = [interpolate(t.settings.importDoneReferences, { ok: result.ok.length })]
      if (result.failed.length > 0) {
        parts.push(interpolate(t.settings.importReferencesFailed, { count: result.failed.length }))
        parts.push(...result.failed.map((f) => `${f.reference} : ${f.error}`))
      }
      setState({ kind: 'done', message: parts.join('\n') })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
      <h2>{t.settings.importReferences}</h2>
      <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={state.kind === 'importing'} />
      {(state.kind === 'previewed' || state.kind === 'importing') && (
        <>
          <ImportPreviewPanel preview={state.preview} />
          <button
            type="button"
            onClick={handleImport}
            disabled={state.kind === 'importing' || state.preview.valid.length === 0}
          >
            {state.kind === 'importing' ? t.settings.importing : t.settings.importConfirm}
          </button>
        </>
      )}
      {state.kind === 'done' && (
        <p className="form-status" style={{ whiteSpace: 'pre-line' }}>
          {state.message}
        </p>
      )}
      {state.kind === 'error' && <p className="form-status form-error">{state.message}</p>}
    </form>
  )
}

type StockOuvertureState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'previewed'; preview: StockOuverturePreview }
  | { kind: 'importing'; preview: StockOuverturePreview }
  | { kind: 'done'; message: string }

// Écrit des mouvements (motif stock_initial) — seul des trois imports de
// cet écran dans ce cas (§7). L'aperçu est asynchrone : il vérifie en
// direct les conditionnements et le stock déjà présent, jamais via le
// cache (voir previewStockOuvertureImport).
// Chevauchement au-delà duquel un avertissement + un appui ne suffit plus
// (retour du 2026-09-17, même principe que la confirmation proportionnée
// du §6.4) : quelques triplets déjà pourvus sont un recoupement normal,
// mais au-delà d'un tiers des lignes valides, c'est la signature d'un
// second chargement complet du même fichier — la friction doit augmenter
// avec l'ampleur, pas rester plate.
const OVERLAP_RATIO_REQUIRING_TYPED_CONFIRM = 1 / 3

function StockOuvertureImportForm() {
  const { t } = useI18n()
  const [auteur, setAuteur] = useState<string | null>(null)
  const [state, setState] = useState<StockOuvertureState>({ kind: 'idle' })
  const [overlapConfirmText, setOverlapConfirmText] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuteur(data.session?.user.email ?? null))
  }, [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setOverlapConfirmText('')
    try {
      const text = await decodeImportFile(file)
      setState({ kind: 'previewed', preview: await previewStockOuvertureImport(text) })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleImport() {
    if (state.kind !== 'previewed' || !auteur) return
    setState({ kind: 'importing', preview: state.preview })
    try {
      const count = await commitStockOuvertureImport(
        state.preview.batchId,
        state.preview.valid.map((r) => r.data),
        auteur,
      )
      void refreshReferentielCache()
      setState({ kind: 'done', message: interpolate(t.settings.importDoneStockOuverture, { count }) })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const overlapRatio =
    state.kind === 'previewed' || state.kind === 'importing'
      ? state.preview.valid.length === 0
        ? 0
        : state.preview.warnings.length / state.preview.valid.length
      : 0
  const requiresTypedConfirm = overlapRatio > OVERLAP_RATIO_REQUIRING_TYPED_CONFIRM
  const typedConfirmOk = overlapConfirmText.trim().toUpperCase() === t.settings.importOverlapWord.toUpperCase()

  return (
    <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
      <h2>{t.settings.importStockOuverture}</h2>
      <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={state.kind === 'importing'} />
      {(state.kind === 'previewed' || state.kind === 'importing') && (
        <>
          <p className="form-status">{interpolate(t.settings.importBatchId, { batchId: state.preview.batchId })}</p>
          <ImportPreviewPanel preview={state.preview} />
          {state.preview.warnings.length > 0 && (
            <div className="form-status">
              <p className="form-warning">
                {interpolate(t.settings.importPreviewWarnings, { count: state.preview.warnings.length })}
              </p>
              <ul>
                {state.preview.warnings.map((w) => (
                  <li key={w.line} className="form-warning">
                    {interpolate(t.settings.importRejectedLine, { line: w.line, reason: w.reason })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {requiresTypedConfirm && (
            <label className="field-label">
              <span className="form-warning">
                {interpolate(t.settings.importOverlapWarning, {
                  count: state.preview.warnings.length,
                  total: state.preview.valid.length,
                  word: t.settings.importOverlapWord,
                })}
              </span>
              <input
                value={overlapConfirmText}
                onChange={(e) => setOverlapConfirmText(e.target.value)}
                disabled={state.kind === 'importing'}
              />
            </label>
          )}
          <button
            type="button"
            onClick={handleImport}
            disabled={
              state.kind === 'importing' ||
              state.preview.valid.length === 0 ||
              !auteur ||
              (requiresTypedConfirm && !typedConfirmOk)
            }
          >
            {state.kind === 'importing' ? t.settings.importing : t.settings.importConfirm}
          </button>
        </>
      )}
      {state.kind === 'done' && <p className="form-status">{state.message}</p>}
      {state.kind === 'error' && <p className="form-status form-error">{state.message}</p>}
    </form>
  )
}

function ReferenceForm() {
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

  const clientOptions = useMemo(
    () => clients.map((c) => ({ value: c.code, label: c.nom })),
    [clients],
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!clientCode) return
    setStatus({ kind: 'saving' })
    try {
      await upsertReferenceWithConditionnements(code.trim(), libelle.trim(), clientCode, [
        { piecesParCarton: Number(pieces) },
      ])
      void refreshReferentielCache() // ne bloque jamais la confirmation d'une écriture réussie
      setStatus({ kind: 'saved' })
      setCode('')
      setLibelle('')
      setPieces('')
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : t.settings.saveError })
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
        <input
          type="number"
          min={1}
          value={pieces}
          onChange={(e) => setPieces(e.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={status.kind === 'saving' || !clientCode}>
        {t.common.save}
      </button>
      {status.kind === 'saved' && <p className="form-status">{t.settings.saved}</p>}
      {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
    </form>
  )
}

function ClientForm() {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [nom, setNom] = useState('')
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus({ kind: 'saving' })
    try {
      await insertClient(code.trim().toUpperCase(), nom.trim())
      void refreshReferentielCache() // ne bloque jamais la confirmation d'une écriture réussie
      setStatus({ kind: 'saved' })
      setCode('')
      setNom('')
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : t.settings.saveError })
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <h2>{t.settings.addClient}</h2>
      <label>
        {t.settings.code}
        <input value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      <label>
        {t.settings.clientNom}
        <input value={nom} onChange={(e) => setNom(e.target.value)} required />
      </label>
      <button type="submit" disabled={status.kind === 'saving'}>
        {t.common.save}
      </button>
      {status.kind === 'saved' && <p className="form-status">{t.settings.saved}</p>}
      {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
    </form>
  )
}

// Création en lot (spec v2 §7/§8) : remplace l'import CSV d'emplacements
// (jamais construit) pour peupler un référentiel avant le démarrage du
// pilote. Le formulaire unitaire ci-dessous reste utile pour un ajout
// isolé ensuite (palette rangée dans un casier jamais prévu).
function EmplacementGeneratorForm() {
  const { t } = useI18n()
  const [zone, setZone] = useState('')
  const [baieFrom, setBaieFrom] = useState('')
  const [baieTo, setBaieTo] = useState('')
  const [niveaux, setNiveaux] = useState('')
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'done'; created: number; skipped: number; invalid: string[] }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const niveauxList = niveaux
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '')
    .map(Number)

  const canGenerate =
    zone.trim() !== '' &&
    baieFrom !== '' &&
    baieTo !== '' &&
    Number(baieFrom) <= Number(baieTo) &&
    niveauxList.length > 0 &&
    niveauxList.every((n) => Number.isInteger(n) && n >= 0 && n <= 9)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canGenerate) return
    setStatus({ kind: 'saving' })
    try {
      const result = await generateEmplacements(zone, Number(baieFrom), Number(baieTo), niveauxList)
      void refreshReferentielCache() // ne bloque jamais la confirmation d'une écriture réussie
      setStatus({ kind: 'done', ...result })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : t.settings.saveError })
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <h2>{t.settings.generateEmplacements}</h2>
      <label>
        {t.settings.zone}
        <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="A" maxLength={2} required />
      </label>
      <div className="quantity-row">
        <label className="field-label">
          {t.settings.baieFrom}
          <input
            type="number"
            min={1}
            value={baieFrom}
            onChange={(e) => setBaieFrom(e.target.value)}
            required
          />
        </label>
        <label className="field-label">
          {t.settings.baieTo}
          <input type="number" min={1} value={baieTo} onChange={(e) => setBaieTo(e.target.value)} required />
        </label>
      </div>
      <label>
        {t.settings.niveaux}
        <input value={niveaux} onChange={(e) => setNiveaux(e.target.value)} placeholder="0,1" required />
      </label>
      <button type="submit" disabled={!canGenerate || status.kind === 'saving'}>
        {t.settings.generate}
      </button>
      {status.kind === 'done' && (
        <p className="form-status">
          {interpolate(t.settings.generated, { created: status.created, skipped: status.skipped })}
          {status.invalid.length > 0 && ` — ${status.invalid.length} code(s) invalide(s) : ${status.invalid.join(', ')}`}
        </p>
      )}
      {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
    </form>
  )
}

function EmplacementForm() {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [ordre, setOrdre] = useState('')
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus({ kind: 'saving' })
    try {
      await insertEmplacement(code.trim().toUpperCase(), ordre ? Number(ordre) : undefined)
      void refreshReferentielCache() // ne bloque jamais la confirmation d'une écriture réussie
      setStatus({ kind: 'saved' })
      setCode('')
      setOrdre('')
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : t.settings.saveError })
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <h2>{t.settings.addEmplacement}</h2>
      <label>
        {t.settings.code}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="A-03-2"
          required
        />
      </label>
      <label>
        {t.settings.ordreOptional}
        <input type="number" value={ordre} onChange={(e) => setOrdre(e.target.value)} />
      </label>
      <button type="submit" disabled={status.kind === 'saving'}>
        {t.common.save}
      </button>
      {status.kind === 'saved' && <p className="form-status">{t.settings.saved}</p>}
      {status.kind === 'error' && <p className="form-status form-error">{status.message}</p>}
    </form>
  )
}
