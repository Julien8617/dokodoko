import { supabase } from './supabase'
import { upsertReferenceWithConditionnements } from './db'
import {
  cellByName,
  parseCsvTable,
  requireColumns,
  type ImportPreview,
  type ImportRowResult,
} from './csvImport'

// Import Clients et Références (§7, spec 2.32) : premier des deux chantiers
// d'import réintégrés avant le 18 — Clients et Références n'écrivent aucun
// mouvement, une erreur y est visible et corrigible, contrairement au
// stock initial qui reste manuel/hors périmètre ici. Stock d'ouverture
// (qui écrit des mouvements) est un chantier séparé, livré après celui-ci.
//
// Les colonnes "ambre" du classeur (dimensions, max_par_palette,
// code_tarifaire, famille_melange) sont ignorées SILENCIEUSEMENT ici : on
// ne lit que les colonnes nommées explicitement ci-dessous, donc leur
// présence ou absence dans le fichier n'a aucun effet — pas besoin de les
// lister pour les ignorer.

export interface ClientImportRow {
  code: string
  nom: string
}

const CLIENTS_REQUIRED = ['client_code', 'nom']

export function previewClientsImport(text: string): ImportPreview<ClientImportRow> {
  const { header, rows } = parseCsvTable(text)
  requireColumns(header, CLIENTS_REQUIRED)

  const valid: ImportRowResult<ClientImportRow>[] = []
  const rejected: ImportPreview<ClientImportRow>['rejected'] = []
  const seen = new Set<string>()

  for (const { line, cells } of rows) {
    const code = cellByName(header, cells, 'client_code').toUpperCase()
    const nom = cellByName(header, cells, 'nom')
    if (!code) {
      rejected.push({ line, reason: 'client_code manquant' })
      continue
    }
    if (!nom) {
      rejected.push({ line, reason: 'nom manquant' })
      continue
    }
    if (seen.has(code)) {
      rejected.push({ line, reason: `client_code ${code} en double dans le fichier` })
      continue
    }
    seen.add(code)
    valid.push({ line, data: { code, nom } })
  }
  return { valid, rejected }
}

// Upsert en un seul appel : un client déjà connu voit son nom mis à jour,
// rejouer le même fichier ne duplique rien (§7, "rejouable sans écraser").
export async function commitClientsImport(rows: ClientImportRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase
    .from('clients')
    .upsert(
      rows.map((r) => ({ code: r.code, nom: r.nom })),
      { onConflict: 'code' },
    )
  if (error) throw error
}

export interface ReferenceImportRow {
  reference: string
  clientCode: string
  libelle: string
  piecesParCarton: number
  conditionnementLabel: string | null
}

const REFERENCES_REQUIRED = ['reference', 'client_code', 'pieces_par_carton']

// Une ligne par couple référence × conditionnement (§7, spec 2.32) : une
// référence à deux conditionnements apparaît sur deux lignes. C'est
// délibéré, pas une anomalie à rejeter — voir commitReferencesImport, qui
// regroupe par référence avant d'écrire.
export function previewReferencesImport(text: string): ImportPreview<ReferenceImportRow> {
  const { header, rows } = parseCsvTable(text)
  requireColumns(header, REFERENCES_REQUIRED)
  const hasConditionnementLabel = header.includes('conditionnement_label')

  const valid: ImportRowResult<ReferenceImportRow>[] = []
  const rejected: ImportPreview<ReferenceImportRow>['rejected'] = []
  // (référence, pieces_par_carton) déjà vu dans CE fichier — sans ce
  // contrôle, une ligne dupliquée par erreur de copier-coller créerait un
  // second conditionnement identique en base, impossible à supprimer
  // ensuite (`conditionnements` n'a pas de policy DELETE).
  const seenRates = new Set<string>()

  for (const { line, cells } of rows) {
    const reference = cellByName(header, cells, 'reference').toUpperCase()
    const clientCode = cellByName(header, cells, 'client_code').toUpperCase()
    const libelle = cellByName(header, cells, 'libelle')
    const piecesRaw = cellByName(header, cells, 'pieces_par_carton')
    const conditionnementLabel = hasConditionnementLabel
      ? cellByName(header, cells, 'conditionnement_label') || null
      : null

    if (!reference) {
      rejected.push({ line, reason: 'reference manquante' })
      continue
    }
    if (!clientCode) {
      rejected.push({ line, reason: 'client_code manquant' })
      continue
    }
    const piecesParCarton = Number(piecesRaw)
    if (!piecesRaw || !Number.isFinite(piecesParCarton) || piecesParCarton <= 0) {
      rejected.push({ line, reason: `pieces_par_carton invalide (${piecesRaw || 'vide'})` })
      continue
    }
    const rateKey = `${reference}|${piecesParCarton}`
    if (seenRates.has(rateKey)) {
      rejected.push({ line, reason: `${reference} / ${piecesParCarton} en double dans le fichier` })
      continue
    }
    seenRates.add(rateKey)
    valid.push({ line, data: { reference, clientCode, libelle, piecesParCarton, conditionnementLabel } })
  }
  return { valid, rejected }
}

export interface ReferencesCommitResult {
  ok: string[]
  failed: { reference: string; error: string }[]
}

// Regroupée par référence AVANT d'écrire : upsertReferenceWithConditionnements
// doit recevoir tous les conditionnements d'une référence en un seul appel
// (voir son commentaire dans db.ts), jamais un appel par ligne du fichier.
//
// Pas une transaction unique sur tout le fichier — chaque référence est
// atomique pour elle-même (via upsertReferenceWithConditionnements), mais
// une référence en échec n'annule pas les autres. Acceptable ici (pas
// ailleurs) parce que l'import de références n'écrit aucun mouvement :
// l'opération est idempotente, une erreur est visible et se corrige en
// rejouant le même fichier une fois le souci réglé (§7).
export async function commitReferencesImport(rows: ReferenceImportRow[]): Promise<ReferencesCommitResult> {
  const byRef = new Map<string, ReferenceImportRow[]>()
  for (const row of rows) {
    const list = byRef.get(row.reference) ?? []
    list.push(row)
    byRef.set(row.reference, list)
  }

  const ok: string[] = []
  const failed: ReferencesCommitResult['failed'] = []

  for (const [reference, refRows] of byRef) {
    try {
      // client_code et libelle : la dernière ligne du fichier pour cette
      // référence l'emporte — les lignes d'une même référence ne
      // devraient différer que par le conditionnement (§7).
      const last = refRows[refRows.length - 1]
      await upsertReferenceWithConditionnements(
        reference,
        last.libelle,
        last.clientCode,
        refRows.map((r) => ({ piecesParCarton: r.piecesParCarton, libelleCourt: r.conditionnementLabel })),
      )
      ok.push(reference)
    } catch (err) {
      failed.push({ reference, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ok, failed }
}
