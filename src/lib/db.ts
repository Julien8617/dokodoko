import { supabase } from './supabase'
import type {
  Client,
  Conditionnement,
  Emplacement,
  MouvementInsert,
  Reference,
  StockByReferenceLine,
  StockLine,
} from './types'

export async function listReferences(): Promise<Reference[]> {
  const { data, error } = await supabase
    .from('references')
    .select('code, libelle, client_code')
    .order('code')
  if (error) throw error
  return data
}

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase.from('clients').select('code, nom').order('nom')
  if (error) throw error
  return data
}

export async function insertClient(code: string, nom: string): Promise<void> {
  const { error } = await supabase.from('clients').insert({ code, nom })
  if (error) throw error
}

// L'ordre de parcours physique (`ordre`) prime quand il est renseigné —
// c'est tout son rôle (brief Inventaire du 2026-09-14, écran "liste des
// casiers") ; zone/baie/niveau reste le repli pour les emplacements sans
// ordre défini.
export async function listEmplacements(): Promise<Emplacement[]> {
  const { data, error } = await supabase
    .from('emplacements')
    .select('code, zone, baie, niveau, ordre')
    .order('ordre', { ascending: true, nullsFirst: false })
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

// Complète un code emplacement tapé sans tiret ni zéro de tête (ex. "A11")
// en code canonique "A-01-1" — découpage strict décidé le 2026-09-14 : le
// dernier chiffre tapé est toujours le niveau, tout ce qui précède est la
// baie (zéro-complétée à 2 chiffres). "A11" ne résout donc jamais vers
// "A-10-1" — il faut taper les 3 chiffres (A101 ou A-10-1) pour la baie 10.
export function resolveEmplacementInput(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase()

  // Tirets déjà tapés entre zone/baie/niveau : pas d'ambiguïté, le tiret dit
  // où s'arrête la baie ("A-1-1" = baie 1) — on complète juste le zéro de
  // tête ("A-1-1" -> "A-01-1").
  const dashed = /^([A-Z]{1,2})-(\d{1,2})-(\d)$/.exec(trimmed)
  if (dashed) {
    const [, zone, baie, niveau] = dashed
    const code = `${zone}-${baie.padStart(2, '0')}-${niveau}`
    return parseEmplacementCode(code) ? code : null
  }

  // Aucun tiret, uniquement zone + chiffres : le dernier chiffre tapé est
  // toujours le niveau (règle stricte du 2026-09-14 — "A11" ne résout
  // jamais vers "A-10-1" ; il faut taper A101 ou A-10-1 pour la baie 10).
  const compact = /^([A-Z]{1,2})(\d{2,3})$/.exec(trimmed)
  if (compact) {
    const [, zone, digits] = compact
    const niveau = digits.slice(-1)
    const baie = digits.slice(0, -1).padStart(2, '0')
    const code = `${zone}-${baie}-${niveau}`
    return parseEmplacementCode(code) ? code : null
  }

  return null
}

// Forme compacte (sans tiret, baie sans zéro de tête) d'un code déjà
// canonique — sert à reconnaître une saisie du type "A11" pour "A-01-1"
// sans jamais la confondre avec "A-10-1" (dont la forme compacte est
// "A101", donc distincte).
function emplacementCompact(code: string): string {
  const parsed = parseEmplacementCode(code)
  if (!parsed) return code.replace(/[-\s]/g, '').toUpperCase()
  return `${parsed.zone}${parsed.baie}${parsed.niveau}`
}

// Suggestions pour la saisie du casier (Inventaire, écran "marche") : une
// aide anti-faute de frappe, jamais une restriction — un code absent de
// cette liste reste saisissable tel quel et sera créé par
// `ensureEmplacement` (palette déplacée vers un casier jamais enregistré).
export function matchEmplacements(raw: string, knownCodes: string[]): string[] {
  const trimmed = raw.trim().toUpperCase()
  if (!trimmed) return []
  const compactInput = trimmed.replace(/[-\s]/g, '')
  return knownCodes
    .filter((code) => code.toUpperCase().startsWith(trimmed) || emplacementCompact(code).startsWith(compactInput))
    .sort()
    .slice(0, 8)
}

// Suggestions pour la saisie libre de la référence (Inventaire, écran
// "marche") : recherche floue par sous-chaîne — "65", "265" ou "REU26"
// trouvent tous "REU265", pas seulement un préfixe exact. Évite d'avoir à
// taper le code en entier au clavier en marchant dans l'entrepôt.
export function matchReferences(raw: string, refs: Reference[]): Reference[] {
  const query = raw.trim().toUpperCase()
  if (!query) return []
  const digitsQuery = /^\d+$/.test(query) ? query : null

  const scored: { ref: Reference; index: number }[] = []
  for (const ref of refs) {
    const code = ref.code.toUpperCase()
    const codeIndex = code.indexOf(query)
    if (codeIndex >= 0) {
      scored.push({ ref, index: codeIndex })
      continue
    }
    if (digitsQuery) {
      const digitsIndex = code.replace(/\D/g, '').indexOf(digitsQuery)
      if (digitsIndex >= 0) scored.push({ ref, index: digitsIndex })
    }
  }

  scored.sort((a, b) => a.index - b.index || a.ref.code.localeCompare(b.ref.code))
  return scored.slice(0, 8).map((s) => s.ref)
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

// Générateur en lot (spec v2 §7/§8, remplace l'import CSV d'emplacements,
// qui n'a jamais été construit — substitution sans rien à retirer) : zone,
// plage de baies, niveaux. `ordre` est calculé selon le tri par défaut
// (zone texte, baie nombre, niveau nombre, une baie parcourue du sol vers
// le haut avant d'avancer) plutôt que saisi à la main, et posé au-delà du
// maximum existant pour ne jamais réordonner les emplacements déjà en
// base. `upsert(ignoreDuplicates)` rend l'appel rejouable : relancer le
// générateur sur une plage qui recoupe une plage déjà créée ne duplique
// rien et ne touche pas l'ordre déjà posé sur ces lignes-là.
export interface GenerateEmplacementsResult {
  created: number
  skipped: number
  invalid: string[]
}

export async function generateEmplacements(
  zone: string,
  baieFrom: number,
  baieTo: number,
  niveaux: number[],
): Promise<GenerateEmplacementsResult> {
  const zoneUpper = zone.trim().toUpperCase()
  const { data: maxRow, error: maxError } = await supabase
    .from('emplacements')
    .select('ordre')
    .order('ordre', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (maxError) throw maxError
  let nextOrdre = (maxRow?.ordre ?? 0) + 1

  const rows: { code: string; zone: string; baie: number; niveau: number; ordre: number }[] = []
  const invalid: string[] = []

  for (let baie = baieFrom; baie <= baieTo; baie++) {
    for (const niveau of [...niveaux].sort((a, b) => a - b)) {
      const code = `${zoneUpper}-${String(baie).padStart(2, '0')}-${niveau}`
      if (!parseEmplacementCode(code)) {
        invalid.push(code)
        continue
      }
      rows.push({ code, zone: zoneUpper, baie, niveau, ordre: nextOrdre })
      nextOrdre += 1
    }
  }
  if (rows.length === 0) return { created: 0, skipped: 0, invalid }

  const { data, error } = await supabase
    .from('emplacements')
    .upsert(rows, { onConflict: 'code', ignoreDuplicates: true })
    .select('code')
  if (error) throw error

  return { created: data.length, skipped: rows.length - data.length, invalid }
}

// Enregistre un emplacement à la volée s'il n'existe pas encore — une
// palette peut avoir été déplacée sans que personne ne le signale, et
// l'Inventaire (2026-09-14) doit pouvoir compter n'importe quel casier
// physique, pas seulement ceux déjà connus du système. Le format reste
// vérifié (une vraie contrainte physique), mais plus l'existence préalable.
export async function ensureEmplacement(code: string): Promise<void> {
  const parsed = parseEmplacementCode(code)
  if (!parsed) throw new Error(`Code emplacement invalide : ${code}`)
  const { error } = await supabase
    .from('emplacements')
    .upsert(
      { code, zone: parsed.zone, baie: parsed.baie, niveau: parsed.niveau },
      { onConflict: 'code', ignoreDuplicates: true },
    )
  if (error) throw error
}

// Référence connue : le libellé est mis à jour. Un pieces_par_carton qui
// diffère d'un conditionnement existant crée une nouvelle ligne et marque
// l'ancienne à écouler — jamais de modification du taux existant (§4, §7).
export async function upsertReferenceWithConditionnement(
  code: string,
  libelle: string,
  piecesParCarton: number,
  clientCode: string,
): Promise<void> {
  const { error: refError } = await supabase
    .from('references')
    .upsert({ code, libelle, client_code: clientCode }, { onConflict: 'code' })
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

// Stock théorique d'un casier au moment où on l'ouvre pour comptage — sert de
// base au comptage à l'aveugle (le théorique reste caché côté écran tant que
// « voir l'attendu » n'a pas été demandé). Les lignes à 0 sont exclues : une
// référence trouvée en trop se rajoute manuellement pendant le comptage.
export async function listStockAtEmplacement(emplacementCode: string): Promise<StockLine[]> {
  const { data, error } = await supabase
    .from('stock')
    .select('ref_code, conditionnement_id, quantite_pieces')
    .eq('emplacement_code', emplacementCode)
  if (error) throw error
  return data.filter((row) => row.quantite_pieces !== 0)
}

// Stock courant (vue, jamais figé) d'une référence, tous emplacements
// confondus — écran Recherche : "où se trouve REU003 ?".
export async function listStockByReference(refCode: string): Promise<StockByReferenceLine[]> {
  const { data, error } = await supabase
    .from('stock')
    .select('emplacement_code, conditionnement_id, quantite_pieces')
    .eq('ref_code', refCode)
  if (error) throw error
  return data.filter((row) => row.quantite_pieces !== 0)
}

export async function insertMouvements(rows: MouvementInsert[]): Promise<void> {
  // id généré côté client : rejeu idempotent, jamais deux fois le même
  // mouvement (§3, critères 21-22). upsert + ignoreDuplicates = équivalent
  // de `on conflict (id) do nothing` — un `do update` est de toute façon
  // impossible, le trigger d'immutabilité refuse tout UPDATE sur cette table.
  const { error } = await supabase.from('mouvements').upsert(rows, { ignoreDuplicates: true })
  if (error) throw error
}
