import { supabase } from './supabase'
import {
  getClients,
  getConditionnementsForRef,
  getEmplacements,
  getReferences,
  getStockAtEmplacement,
  getStockByReference,
} from './referentielCache'
import type {
  Client,
  Conditionnement,
  Emplacement,
  MouvementInsert,
  Reference,
  StockByReferenceLine,
  StockLine,
} from './types'

// Lit le cache de lecture (spec v2 §3), pas le réseau directement — voir
// referentielCache.ts. Signature inchangée : tous les appelants existants
// (Mouvement, Inventaire, Recherche) profitent du cache sans modification.
export async function listReferences(): Promise<Reference[]> {
  return getReferences()
}

export async function listClients(): Promise<Client[]> {
  return getClients()
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
  return getEmplacements()
}

export async function listConditionnements(refCode: string): Promise<Conditionnement[]> {
  // à écouler en premier (§4.1 : proposé en priorité sur une sortie) —
  // tri appliqué dans referentielCache.ts, au même endroit que le filtre.
  return getConditionnementsForRef(refCode)
}

// Stock = vue, jamais une colonne. Absence de ligne = 0 (§4). VOLONTAIREMENT
// hors du cache de lecture (§3) : sert à refuser une sortie qui dépasserait
// le stock (Mouvement.tsx). Motif intrinsèque, pas conjoncturel : refuser
// une sortie sur une donnée périmée est pire que la refuser sur une donnée
// fraîche, puisque l'app interdirait alors ce que le serveur aurait
// accepté — vrai que le refus reste bloquant ou devienne un simple
// avertissement (§6.4). Cette lecture reste donc réseau, toujours exacte.
// Conséquence : un verrou réseau sur `getStock` fait échouer une sortie
// hors ligne avant même d'atteindre l'écriture, donc la fin du blocage
// est un prérequis de la file d'écriture, pas une suite (voir
// referentielCache.ts).
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

// Minuscules, accents retirés, séparateurs remplacés par un espace (§6.2,
// spec 2.20) : "Pommade à cheveux" et "pommade-cheveux" se normalisent
// tous deux vers "pommade a cheveux" / "pommade cheveux" et se rejoignent
// au moment de la comparaison. Le japonais (sans espaces ni accents
// latins) traverse cette fonction inchangé — un seul "mot", couvert plus
// bas par la recherche en sous-chaîne de ce jeton unique.
function normalizeSearchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Recherche partagée par la Recherche, le sélecteur de référence de
// Mouvement et celui de l'Inventaire (§6.2, spec 2.20 : "une
// implémentation, plusieurs appelants" — même règle que la suppression
// unifiée d'une saisie). Fonctionnalité, une seule fois, quatre exigences
// qu'une version naïve raterait :
//
// 1. Correspondance par jetons de la requête, pas par sous-chaîne entière
//    sur le libellé complet : "matelas bleu" doit retrouver
//    "Matelas XL bleu" — chaque mot cherché indépendamment, dans
//    n'importe quel ordre, tous présents (recopié depuis une facture, qui
//    ne respecte ni l'ordre ni la casse du libellé en base).
// 2. Normalisation avant comparaison (voir normalizeSearchText).
// 3. Ordre des résultats : préfixe exact du code, puis code en
//    sous-chaîne, puis libellé — sans quoi taper "65" noierait REU065
//    sous tout article dont le nom contient "65".
// 4. L'affichage (code + libellé) reste la responsabilité de l'appelant,
//    cette fonction ne renvoie que les `Reference` triées.
export function matchReferences(raw: string, refs: Reference[]): Reference[] {
  const query = raw.trim()
  if (!query) return []

  const queryTokens = normalizeSearchText(query).split(/\s+/).filter(Boolean)
  if (queryTokens.length === 0) return []

  const codeQuery = query.toUpperCase()
  const digitsQuery = /^\d+$/.test(codeQuery) ? codeQuery : null

  const CODE_PREFIX = 0
  const CODE_SUBSTRING = 1
  const LIBELLE = 2

  const scored: { ref: Reference; tier: number; index: number }[] = []

  for (const ref of refs) {
    const code = ref.code.toUpperCase()
    const digitsOnlyCode = code.replace(/\D/g, '')
    const normalizedLibelle = normalizeSearchText(ref.libelle ?? '')
    // Inclut la version tout-chiffres du code : sans elle, une requête
    // "65" contre un code à chiffres non contigus (ex. "RE6U5") ne
    // passerait jamais cette porte, et la branche digitsQuery plus bas
    // — écrite justement pour ce cas — ne serait jamais atteinte.
    const haystack = `${normalizeSearchText(ref.code)} ${digitsOnlyCode} ${normalizedLibelle}`.trim()

    if (!queryTokens.every((t) => haystack.includes(t))) continue

    if (code.startsWith(codeQuery)) {
      scored.push({ ref, tier: CODE_PREFIX, index: 0 })
      continue
    }
    const codeIndex = code.indexOf(codeQuery)
    if (codeIndex >= 0) {
      scored.push({ ref, tier: CODE_SUBSTRING, index: codeIndex })
      continue
    }
    if (digitsQuery) {
      const digitsIndex = digitsOnlyCode.indexOf(digitsQuery)
      if (digitsIndex >= 0) {
        scored.push({ ref, tier: CODE_SUBSTRING, index: digitsIndex })
        continue
      }
    }
    // -1 (jeton trouvé seulement dans le code, pas dans le libellé) ne
    // doit jamais devancer un vrai match à l'index 0 du libellé.
    const libelleIndex = normalizedLibelle.indexOf(queryTokens[0])
    scored.push({ ref, tier: LIBELLE, index: libelleIndex < 0 ? Number.MAX_SAFE_INTEGER : libelleIndex })
  }

  // Pas de plafond ici : une suggestion déroulante (Recherche, Mouvement,
  // marche) veut ses 8 meilleurs résultats, mais la liste à cocher de
  // l'Inventaire (périmètre "références") veut TOUT ce qui correspond —
  // le plafond est la responsabilité de chaque appelant, pas de la
  // recherche elle-même.
  scored.sort((a, b) => a.tier - b.tier || a.index - b.index || a.ref.code.localeCompare(b.ref.code))
  return scored.map((s) => s.ref)
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

// Stock courant d'un casier — écran Recherche : "qu'y a-t-il dans A-05-1 ?".
// Lit le cache de lecture (§3), informatif et potentiellement périmé hors
// ligne — sans conséquence ici, la Recherche est un écran de consultation,
// jamais un refus bloquant (contrairement à `getStock`, resté réseau).
export async function listStockAtEmplacement(emplacementCode: string): Promise<StockLine[]> {
  return getStockAtEmplacement(emplacementCode)
}

// Stock courant (vue, jamais figé) d'une référence, tous emplacements
// confondus — écran Recherche : "où se trouve REU003 ?". Même remarque sur
// le cache que ci-dessus.
export async function listStockByReference(refCode: string): Promise<StockByReferenceLine[]> {
  return getStockByReference(refCode)
}

export async function insertMouvements(rows: MouvementInsert[]): Promise<void> {
  // id généré côté client : rejeu idempotent, jamais deux fois le même
  // mouvement (§3, critères 21-22). upsert + ignoreDuplicates = équivalent
  // de `on conflict (id) do nothing` — un `do update` est de toute façon
  // impossible, le trigger d'immutabilité refuse tout UPDATE sur cette table.
  const { error } = await supabase.from('mouvements').upsert(rows, { ignoreDuplicates: true })
  if (error) throw error
}
