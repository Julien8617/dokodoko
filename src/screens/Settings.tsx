import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { interpolate } from '../i18n/format'
import {
  generateEmplacements,
  insertClient,
  insertEmplacement,
  listClients,
  upsertReferenceWithConditionnement,
} from '../lib/db'
import { refreshReferentielCache } from '../lib/referentielCache'
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
      <VersionFooter />
    </main>
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
      await upsertReferenceWithConditionnement(code.trim(), libelle.trim(), Number(pieces), clientCode)
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
