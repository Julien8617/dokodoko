import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { insertClient, insertEmplacement, listClients, upsertReferenceWithConditionnement } from '../lib/db'
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
