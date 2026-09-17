import { supabase } from './supabase'
import { insertMouvements, parseEmplacementCode, upsertReferenceWithConditionnements } from './db'
import { extractErrorMessage } from './errors'
import type { MouvementInsert } from './types'
import {
  cellByName,
  deriveMouvementId,
  parseCsvTable,
  requireColumns,
  type ImportPreview,
  type ImportRejection,
  type ImportRowResult,
} from './csvImport'

// Import Clients, Références et Stock d'ouverture (§7, spec 2.32-2.33).
//
// Clients et Références n'écrivent aucun mouvement : une erreur y est
// visible et corrigible, l'upsert sur clé suffit à rendre le rejeu
// idempotent (spec 2.33 — "tout ou rien" n'est plus l'exigence, c'est le
// rejeu SANS EFFET DE BORD qui protège réellement, une coquille sur une
// ligne ne doit pas bloquer les 299 autres).
//
// Stock d'ouverture écrit des mouvements : l'idempotence doit être
// CONSTRUITE, pas seulement obtenue par upsert sur un code. Voir
// deriveMouvementId ci-dessous.
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
      failed.push({ reference, error: extractErrorMessage(err, 'Erreur inconnue') })
    }
  }
  return { ok, failed }
}

// --- Stock d'ouverture (spec 2.33) --------------------------------------

export interface StockOuvertureImportRow {
  reference: string
  emplacement: string
  conditionnementId: string
  cartons: number
  pieces: number
  totalPieces: number
}

export interface StockOuverturePreview {
  batchId: string
  valid: ImportRowResult<StockOuvertureImportRow>[]
  rejected: ImportRejection[]
  // Triplet déjà pourvu de stock en base — AVERTISSEMENT, pas un refus
  // (spec 2.33) : l'id déterministe protège déjà le rejeu du MÊME fichier ;
  // ce garde-fou attrape ce que l'id déterministe ne peut pas voir — un
  // second chargement depuis un fichier différent, ou de vrais mouvements
  // survenus depuis. Un refus global rendrait impossible la reprise d'un
  // import interrompu, exactement la situation où ce garde-fou compte le
  // plus.
  warnings: ImportRejection[]
}

const STOCK_OUVERTURE_REQUIRED = ['reference', 'emplacement']

// Colonnes ambre non importées : compte_par, remarque (traçabilité papier
// du comptage, sans colonne correspondante côté mouvements — ignorées, pas
// rejetées, comme le reste des colonnes non listées ici).
//
// `batchId` est une étiquette saisie par l'utilisateur (§7, spec 2.35),
// pas dérivée du fichier : un hachage de contenu ne protège que le rejeu
// OCTET POUR OCTET et échoue dès qu'une cellule est corrigée puis
// réexportée — exactement ce qu'un comptage sur le terrain produit.
export async function previewStockOuvertureImport(
  text: string,
  batchId: string,
): Promise<StockOuverturePreview> {
  const { header, rows } = parseCsvTable(text)
  requireColumns(header, STOCK_OUVERTURE_REQUIRED)

  const rawRows = rows.map(({ line, cells }) => ({
    line,
    reference: cellByName(header, cells, 'reference').toUpperCase(),
    emplacement: cellByName(header, cells, 'emplacement').toUpperCase(),
    piecesParCartonRaw: cellByName(header, cells, 'pieces_par_carton'),
    cartonsRaw: cellByName(header, cells, 'cartons'),
    piecesRaw: cellByName(header, cells, 'pieces'),
  }))

  const refCodes = [...new Set(rawRows.map((r) => r.reference).filter(Boolean))]
  const emplacementCodes = [...new Set(rawRows.map((r) => r.emplacement).filter(Boolean))]

  // Lues EN DIRECT, jamais via le cache de lecture (§3) : ces requêtes
  // conditionnent une écriture réelle de mouvements, exactement le cas que
  // le cache exclut délibérément (voir son commentaire dans
  // referentielCache.ts). Groupées par lot plutôt qu'une requête par
  // ligne : sur un fichier de plusieurs centaines de lignes, un aller-
  // retour réseau par ligne serait la vraie lenteur.
  const [condResult, emplResult] = await Promise.all([
    supabase
      .from('conditionnements')
      .select('id, ref_code, pieces_par_carton')
      .in('ref_code', refCodes.length ? refCodes : ['']),
    supabase
      .from('emplacements')
      .select('code')
      .in('code', emplacementCodes.length ? emplacementCodes : ['']),
  ])
  if (condResult.error) throw condResult.error
  if (emplResult.error) throw emplResult.error

  const condsByRef = new Map<string, { id: string; pieces_par_carton: number }[]>()
  for (const c of condResult.data ?? []) {
    const list = condsByRef.get(c.ref_code) ?? []
    list.push(c)
    condsByRef.set(c.ref_code, list)
  }
  const knownEmplacements = new Set((emplResult.data ?? []).map((e) => e.code))

  const rejected: ImportRejection[] = []
  const resolved: {
    line: number
    reference: string
    emplacement: string
    conditionnementId: string
    cartons: number
    pieces: number
    totalPieces: number
  }[] = []
  // (emplacement, référence, conditionnement) déjà résolu dans CE fichier
  // — sans ce contrôle, deux lignes sur le même triplet (une palette
  // recomptée par erreur, une ligne de correction ajoutée à la main)
  // dériveraient le MÊME id de mouvement (batch × triplet) : la seconde
  // survivrait à l'aperçu mais upsert(ignoreDuplicates) l'avalerait en
  // silence à l'écriture, sans jamais l'enregistrer ni le signaler.
  const seenTriplets = new Set<string>()

  for (const row of rawRows) {
    if (!row.reference) {
      rejected.push({ line: row.line, reason: 'reference manquante' })
      continue
    }
    if (!row.emplacement) {
      rejected.push({ line: row.line, reason: 'emplacement manquant' })
      continue
    }
    if (!parseEmplacementCode(row.emplacement)) {
      rejected.push({ line: row.line, reason: `emplacement ${row.emplacement} invalide (attendu : A-03-1)` })
      continue
    }
    if (!knownEmplacements.has(row.emplacement)) {
      rejected.push({ line: row.line, reason: `emplacement ${row.emplacement} inconnu — générez-le d'abord` })
      continue
    }
    const refConds = condsByRef.get(row.reference) ?? []
    if (refConds.length === 0) {
      rejected.push({
        line: row.line,
        reason: `${row.reference} : aucun conditionnement connu — importez les références d'abord`,
      })
      continue
    }

    let conditionnement: { id: string; pieces_par_carton: number } | undefined
    if (row.piecesParCartonRaw) {
      const rate = Number(row.piecesParCartonRaw)
      conditionnement = refConds.find((c) => c.pieces_par_carton === rate)
      if (!conditionnement) {
        rejected.push({
          line: row.line,
          reason: `${row.reference} : aucun conditionnement à ${row.piecesParCartonRaw} pièces/carton`,
        })
        continue
      }
    } else if (refConds.length === 1) {
      conditionnement = refConds[0]
    } else {
      rejected.push({
        line: row.line,
        reason: `${row.reference} : pieces_par_carton requis (${refConds.length} conditionnements possibles)`,
      })
      continue
    }

    const cartons = row.cartonsRaw ? Number(row.cartonsRaw) : 0
    const pieces = row.piecesRaw ? Number(row.piecesRaw) : 0
    if (!Number.isFinite(cartons) || !Number.isFinite(pieces) || cartons < 0 || pieces < 0) {
      rejected.push({ line: row.line, reason: 'cartons/pieces invalides' })
      continue
    }
    const totalPieces = cartons * conditionnement.pieces_par_carton + pieces
    if (totalPieces <= 0) {
      rejected.push({ line: row.line, reason: 'quantité nulle — rien à enregistrer' })
      continue
    }

    const tripletKey = `${row.emplacement}|${row.reference}|${conditionnement.id}`
    if (seenTriplets.has(tripletKey)) {
      rejected.push({
        line: row.line,
        reason: `${row.emplacement} / ${row.reference} en double dans le fichier (les quantités ne s'additionnent pas)`,
      })
      continue
    }
    seenTriplets.add(tripletKey)

    resolved.push({
      line: row.line,
      reference: row.reference,
      emplacement: row.emplacement,
      conditionnementId: conditionnement.id,
      cartons,
      pieces,
      totalPieces,
    })
  }

  // "Déjà du stock sur ce triplet" : une seule requête groupée, en direct.
  const stockResult = await supabase
    .from('stock')
    .select('emplacement_code, ref_code, conditionnement_id, quantite_pieces')
    .in('emplacement_code', emplacementCodes.length ? emplacementCodes : [''])
    .in('ref_code', refCodes.length ? refCodes : [''])
  if (stockResult.error) throw stockResult.error

  const stockKey = (e: string, r: string, c: string) => `${e}|${r}|${c}`
  const existingStock = new Map(
    (stockResult.data ?? []).map((s) => [stockKey(s.emplacement_code, s.ref_code, s.conditionnement_id), s.quantite_pieces]),
  )

  const valid: ImportRowResult<StockOuvertureImportRow>[] = []
  const warnings: ImportRejection[] = []
  for (const r of resolved) {
    const already = existingStock.get(stockKey(r.emplacement, r.reference, r.conditionnementId)) ?? 0
    if (already !== 0) {
      warnings.push({
        line: r.line,
        reason: `${r.emplacement} / ${r.reference} porte déjà ${already} pièce(s) en base`,
      })
    }
    valid.push({
      line: r.line,
      data: {
        reference: r.reference,
        emplacement: r.emplacement,
        conditionnementId: r.conditionnementId,
        cartons: r.cartons,
        pieces: r.pieces,
        totalPieces: r.totalPieces,
      },
    })
  }

  return { batchId, valid, rejected, warnings }
}

// `ts` n'a pas besoin d'être déterministe : en conflit sur `id`,
// ignoreDuplicates n'écrit rien, donc seul le `ts` de la toute première
// écriture réussie survit — une reprise datée plus tard ne change rien
// pour les lignes déjà en base.
export async function commitStockOuvertureImport(
  batchId: string,
  rows: StockOuvertureImportRow[],
  auteur: string,
): Promise<number> {
  if (rows.length === 0) return 0
  const ts = new Date().toISOString()
  const mouvements: MouvementInsert[] = await Promise.all(
    rows.map(async (r) => ({
      id: await deriveMouvementId(`${batchId}|${r.reference}|${r.emplacement}|${r.conditionnementId}`),
      ts,
      ref_code: r.reference,
      emplacement_code: r.emplacement,
      quantite_pieces: r.totalPieces,
      motif: 'stock_initial' as const,
      conditionnement_id: r.conditionnementId,
      auteur,
    })),
  )
  await insertMouvements(mouvements)
  return mouvements.length
}
