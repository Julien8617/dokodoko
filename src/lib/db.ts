import { supabase } from './supabase'
import type { Conditionnement, Emplacement, MouvementInsert, Reference } from './types'

export async function listReferences(): Promise<Reference[]> {
  const { data, error } = await supabase.from('references').select('code, libelle').order('code')
  if (error) throw error
  return data
}

export async function listEmplacements(): Promise<Emplacement[]> {
  const { data, error } = await supabase
    .from('emplacements')
    .select('code, zone, baie, niveau, ordre')
    .order('zone')
    .order('baie')
    .order('niveau')
  if (error) throw error
  return data
}

export async function listConditionnements(refCode: string): Promise<Conditionnement[]> {
  const { data, error } = await supabase
    .from('conditionnements')
    .select('id, ref_code, pieces_par_carton, libelle_court, a_ecouler')
    .eq('ref_code', refCode)
  if (error) throw error
  // à écouler en premier (§4.1 : proposé en priorité sur une sortie)
  return data.sort((a, b) => Number(b.a_ecouler) - Number(a.a_ecouler))
}

// Stock = vue, jamais une colonne. Absence de ligne = 0 (§4).
export async function getStock(
  emplacementCode: string,
  refCode: string,
  conditionnementId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('stock')
    .select('quantite_pieces')
    .eq('emplacement_code', emplacementCode)
    .eq('ref_code', refCode)
    .eq('conditionnement_id', conditionnementId)
    .maybeSingle()
  if (error) throw error
  return data?.quantite_pieces ?? 0
}

// Parse ZONE-BAIE-NIVEAU (§8) — la même règle qui protège la colonne `code`
// en base (contrainte CHECK) est appliquée ici pour dériver zone/baie/niveau.
const EMPLACEMENT_CODE = /^([A-Z]{1,2})-(\d{2})-(\d)$/

export function parseEmplacementCode(code: string) {
  const match = EMPLACEMENT_CODE.exec(code)
  if (!match) return null
  const [, zone, baie, niveau] = match
  if (zone.length === 2 && niveau !== '0') return null // inter-allée : niveau 0 uniquement
  return { zone, baie: Number(baie), niveau: Number(niveau) }
}

export async function insertEmplacement(code: string, ordre?: number): Promise<void> {
  const parsed = parseEmplacementCode(code)
  if (!parsed) throw new Error(`Code emplacement invalide : ${code}`)
  const { error } = await supabase.from('emplacements').insert({
    code,
    zone: parsed.zone,
    baie: parsed.baie,
    niveau: parsed.niveau,
    ordre: ordre ?? null,
  })
  if (error) throw error
}

// Référence connue : le libellé est mis à jour. Un pieces_par_carton qui
// diffère d'un conditionnement existant crée une nouvelle ligne et marque
// l'ancienne à écouler — jamais de modification du taux existant (§4, §7).
export async function upsertReferenceWithConditionnement(
  code: string,
  libelle: string,
  piecesParCarton: number,
): Promise<void> {
  const { error: refError } = await supabase
    .from('references')
    .upsert({ code, libelle }, { onConflict: 'code' })
  if (refError) throw refError

  const existing = await listConditionnements(code)
  const same = existing.find((c) => c.pieces_par_carton === piecesParCarton)
  if (same) return

  if (existing.length > 0) {
    const { error: flagError } = await supabase
      .from('conditionnements')
      .update({ a_ecouler: true })
      .eq('ref_code', code)
    if (flagError) throw flagError
  }

  const { error: insertError } = await supabase
    .from('conditionnements')
    .insert({ ref_code: code, pieces_par_carton: piecesParCarton, a_ecouler: false })
  if (insertError) throw insertError
}

export async function insertMouvements(rows: MouvementInsert[]): Promise<void> {
  // id généré côté client : rejeu idempotent, jamais deux fois le même
  // mouvement (§3, critères 21-22). upsert + ignoreDuplicates = équivalent
  // de `on conflict (id) do nothing` — un `do update` est de toute façon
  // impossible, le trigger d'immutabilité refuse tout UPDATE sur cette table.
  const { error } = await supabase.from('mouvements').upsert(rows, { ignoreDuplicates: true })
  if (error) throw error
}
