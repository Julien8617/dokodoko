import { supabase } from './supabase'
import { listConditionnements } from './db'
import type { Comptage, ComptageLigne, Conditionnement, Inventaire, ScopeKind } from './types'

// Séparateur de clé composite pour les Map ci-dessous — un caractère qui ne
// peut apparaître ni dans un code réf/emplacement ni dans un uuid.
const SEP = '|'

// Stock théorique à un instant T, dérivé de `mouvements` (append-only) —
// jamais une copie : le stock "figé au lancement" d'un inventaire (brief
// 2026-09-14, règle 1) est simplement `ts < frozenTs`, borne stricte pour
// qu'un mouvement inséré à l'instant même du lancement tombe après le gel.
interface StockAsOfRow {
  emplacement_code: string
  ref_code: string
  conditionnement_id: string
  quantite_pieces: number
}

async function stockAsOf(frozenTs: string, refCodes?: string[]): Promise<StockAsOfRow[]> {
  let query = supabase
    .from('mouvements')
    .select('emplacement_code, ref_code, conditionnement_id, quantite_pieces')
    .lt('ts', frozenTs)
  if (refCodes) query = query.in('ref_code', refCodes)
  const { data, error } = await query
  if (error) throw error

  const totals = new Map<string, StockAsOfRow>()
  for (const row of data) {
    const key = [row.emplacement_code, row.ref_code, row.conditionnement_id].join(SEP)
    const existing = totals.get(key)
    if (existing) existing.quantite_pieces += row.quantite_pieces
    else totals.set(key, { ...row })
  }
  return [...totals.values()].filter((row) => row.quantite_pieces !== 0)
}

export async function getActiveInventaire(): Promise<Inventaire | null> {
  const { data, error } = await supabase
    .from('inventaires')
    .select('id, scope_kind, scope_client_code, frozen_ts, statut, auteur, created_at')
    .eq('statut', 'en_cours')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createInventaire(
  scopeKind: ScopeKind,
  auteur: string,
  options: { clientCode?: string; refCodes?: string[] } = {},
): Promise<Inventaire> {
  const { data, error } = await supabase
    .from('inventaires')
    .insert({
      scope_kind: scopeKind,
      scope_client_code: scopeKind === 'client' ? (options.clientCode ?? null) : null,
      auteur,
    })
    .select('id, scope_kind, scope_client_code, frozen_ts, statut, auteur, created_at')
    .single()
  if (error) throw error

  if (scopeKind === 'references' && options.refCodes?.length) {
    const { error: refError } = await supabase
      .from('inventaire_references')
      .insert(options.refCodes.map((ref_code) => ({ inventaire_id: data.id, ref_code })))
    if (refError) throw refError
  }

  return data
}

async function scopeRefCodes(inventaire: Inventaire): Promise<string[] | undefined> {
  if (inventaire.scope_kind === 'tout') return undefined
  if (inventaire.scope_kind === 'client') {
    const { data, error } = await supabase
      .from('references')
      .select('code')
      .eq('client_code', inventaire.scope_client_code as string)
    if (error) throw error
    return data.map((r) => r.code)
  }
  const { data, error } = await supabase
    .from('inventaire_references')
    .select('ref_code')
    .eq('inventaire_id', inventaire.id)
  if (error) throw error
  return data.map((r) => r.ref_code)
}

// Un casier = un comptage, rattaché à l'inventaire en cours. Rouvrir un
// casier déjà visité dans CET inventaire retombe sur la même ligne — c'est
// ce qui permet de revenir en arrière (Précédent) sans dupliquer l'état.
export async function getOrCreateCasier(
  inventaireId: string,
  emplacementCode: string,
): Promise<{ comptage: Comptage; resumed: boolean }> {
  const { data: existing, error: findError } = await supabase
    .from('comptages')
    .select('id, emplacement_code, ts, statut, attendu_consulte')
    .eq('inventaire_id', inventaireId)
    .eq('emplacement_code', emplacementCode)
    .maybeSingle()
  if (findError) throw findError
  if (existing) return { comptage: existing, resumed: true }

  const { data, error } = await supabase
    .from('comptages')
    .insert({
      inventaire_id: inventaireId,
      emplacement_code: emplacementCode,
      ts: new Date().toISOString(),
      statut: 'en_cours',
    })
    .select('id, emplacement_code, ts, statut, attendu_consulte')
    .single()
  if (error) throw error
  return { comptage: data, resumed: false }
}

export async function markCasierVisite(comptageId: string): Promise<void> {
  const { error } = await supabase.from('comptages').update({ statut: 'clos' }).eq('id', comptageId)
  if (error) throw error
}

// Dernière saisie connue par (ref, conditionnement) — jamais une valeur
// mutée en place (brief, règle 4). Reconstruit la vue "état courant" à
// partir du journal append-only, ce qui donne la reprise gratuitement.
export async function listLatestCasierLignes(comptageId: string): Promise<ComptageLigne[]> {
  const { data, error } = await supabase
    .from('comptage_lignes')
    .select('id, comptage_id, ref_code, conditionnement_id, cartons, pieces, ts, auteur')
    .eq('comptage_id', comptageId)
    // `ts` vient maintenant de l'horloge du téléphone (geste), plus de
    // `default now()` côté serveur : deux lignes peuvent partager le même
    // `ts` (double correction rapide, ou rejeu). Le tri secondaire sur `id`
    // rend le choix "dernière ligne" déterministe au lieu de dépendre de
    // l'ordre de retour, non garanti, de la requête.
    .order('ts', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error

  const latest = new Map<string, ComptageLigne>()
  for (const row of data) latest.set([row.ref_code, row.conditionnement_id].join(SEP), row)
  return [...latest.values()]
}

// `id` et `ts` sont générés par l'appelant, au moment du geste — jamais ici,
// jamais par un défaut de la base. Deux raisons, la seconde étant celle qui
// compte pour la file hors ligne à venir (spec v2 §3) :
//   1. upsert(ignoreDuplicates) sur `id` rend l'appel rejouable sans
//      créer de doublon si l'accusé de réception d'un envoi réussi se perd ;
//   2. un `ts` pris au moment de l'écriture (plutôt qu'au moment de la
//      saisie) daterait une saisie mise en file, hors ligne, de l'heure de
//      son vidage — pas de son geste. Comme la lecture est "dernière ligne
//      par (ref, conditionnement)", une saisie originale rejouée après une
//      correction faite entre-temps prendrait alors un `ts` postérieur à
//      celui de la correction et la remplacerait : la valeur corrigée
//      redeviendrait l'ancienne, fausse, valeur. Dater au geste élimine ce
//      cas plutôt que de le déplacer.
export async function saveCasierLigne(
  id: string,
  ts: string,
  comptageId: string,
  refCode: string,
  conditionnementId: string,
  cartons: number,
  pieces: number,
  auteur: string,
): Promise<void> {
  const { error } = await supabase.from('comptage_lignes').upsert(
    {
      id,
      ts,
      comptage_id: comptageId,
      ref_code: refCode,
      conditionnement_id: conditionnementId,
      cartons,
      pieces,
      auteur,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
  if (error) throw error
}

// "Retirer une référence ajoutée par erreur de saisie" (2026-09-14) : une
// correction d'UI, pas un événement métier — suppression réelle, contraste
// volontaire avec l'immutabilité de `mouvements`. Ciblée par `id` (pas par
// ref+conditionnement) : latest-wins fait qu'une correction (nouvelle saisie
// sur la même réf) et l'ancienne ligne partagent ref+conditionnement — les
// supprimer toutes deux effacerait aussi la correction. Utilisée par
// l'écran des écarts (`deleteEdit`) : "supprimer" y agit sur LA ligne
// affichée, pas sur l'historique du couple.
export async function deleteCasierLigne(id: string): Promise<void> {
  const { error } = await supabase.from('comptage_lignes').delete().eq('id', id)
  if (error) throw error
}

// Supprime TOUTES les lignes d'un casier pour une (réf, conditionnement) —
// utilisée UNIQUEMENT par la liste des saisies pendant la marche (§6.5),
// où "annuler cette saisie" doit faire disparaître le couple entièrement :
// `deleteCasierLigne(id)` n'y suffit pas, puisque la liste peut afficher
// une ligne qui a déjà une correction plus ancienne sous elle (saisie faite
// une autre session), et supprimer seulement la plus récente ferait
// réapparaître l'ancienne valeur au lieu de vider la saisie. Ne PAS
// réutiliser cette fonction pour deleteEdit (écran des écarts) : là, le
// même bug existe en théorie (une correction peut aussi y masquer une
// ligne plus ancienne) mais le corriger changerait le comportement d'un
// écran déjà testé sur le terrain — à traiter sur décision explicite, pas
// en silence dans ce commit.
export async function deleteCasierLignesForRef(
  comptageId: string,
  refCode: string,
  conditionnementId: string,
): Promise<void> {
  const { error } = await supabase
    .from('comptage_lignes')
    .delete()
    .eq('comptage_id', comptageId)
    .eq('ref_code', refCode)
    .eq('conditionnement_id', conditionnementId)
  if (error) throw error
}

export interface SaisieLine {
  ligneId: string
  comptageId: string
  emplacementCode: string
  refCode: string
  conditionnementId: string
  cartons: number
  pieces: number
  ts: string
}

// Toutes les saisies de l'inventaire, tous casiers confondus, dernière
// valeur par (casier, réf, conditionnement) — spec v2 §6.5 "liste des
// saisies pendant la marche". Même parcours que getInventaireSynthese
// (comptages -> listLatestCasierLignes) mais sans le théorique, et SANS
// son filtre `if (c.statut !== 'clos') continue` : ce filtre existe là-bas
// pour une autre raison (statut surchargé, §14, dette assumée) et le
// reproduire ici ferait dépendre un second endroit de la même ambiguïté —
// exactement ce que le découplage futur de `statut` devra éviter de devoir
// corriger à deux endroits.
export async function listInventaireSaisies(inventaireId: string): Promise<SaisieLine[]> {
  const { data: comptages, error } = await supabase
    .from('comptages')
    .select('id, emplacement_code')
    .eq('inventaire_id', inventaireId)
  if (error) throw error

  const lines: SaisieLine[] = []
  for (const c of comptages) {
    for (const l of await listLatestCasierLignes(c.id)) {
      lines.push({
        ligneId: l.id,
        comptageId: c.id,
        emplacementCode: c.emplacement_code,
        refCode: l.ref_code,
        conditionnementId: l.conditionnement_id,
        cartons: l.cartons,
        pieces: l.pieces,
        ts: l.ts,
      })
    }
  }
  lines.sort((a, b) => b.ts.localeCompare(a.ts))
  return lines
}

export interface SyntheseLigneEmplacement {
  emplacementCode: string
  theorique: number
  compte: number | null // null = casier pas encore visité pour cette réf
  // Identifiants nécessaires pour corriger cette ligne directement depuis
  // l'écran Écarts (modifier ou supprimer) — null quand `compte` l'est,
  // rien à corriger tant qu'il n'y a pas de saisie.
  comptageId: string | null
  ligneId: string | null
  cartons: number | null
  pieces: number | null
}

export interface SyntheseReference {
  refCode: string
  conditionnementId: string
  piecesParCarton: number
  libelleCourt: string | null
  theoriqueTotal: number
  // Jamais null : un casier théorique jamais visité compte pour 0 — retour
  // terrain du 2026-09-14, "je compte ce que je compte, si ce n'est pas
  // compté, c'est un écart". Pas d'état intermédiaire "en attente" : la
  // synthèse compare simplement ce qui a été saisi au théorique, point.
  compteTotal: number
  ecartTotal: number
  parEmplacement: SyntheseLigneEmplacement[]
  // vrai quand l'écart total est nul mais qu'au moins un casier individuel
  // ne l'est pas — brief §4b : "déplacement probable", pas une perte.
  compense: boolean
}

// Synthèse en lecture seule (phase 1, 2026-09-14 : le traitement des écarts
// — recompter/corriger/justifier, clôture avec écriture des mouvements —
// vient dans une itération suivante). Ne modifie jamais le stock.
export async function getInventaireSynthese(inventaire: Inventaire): Promise<{
  references: SyntheseReference[]
}> {
  const refCodes = await scopeRefCodes(inventaire)
  const theorique = await stockAsOf(inventaire.frozen_ts, refCodes)

  const { data: comptages, error: comptagesError } = await supabase
    .from('comptages')
    .select('id, emplacement_code, statut')
    .eq('inventaire_id', inventaire.id)
  if (comptagesError) throw comptagesError

  const lignesByComptage = new Map<string, ComptageLigne[]>()
  for (const c of comptages) {
    lignesByComptage.set(c.id, await listLatestCasierLignes(c.id))
  }

  const conditionnementCache = new Map<string, Conditionnement>()
  async function getConditionnement(id: string, refCode: string): Promise<Conditionnement | undefined> {
    if (!conditionnementCache.has(id)) {
      const list = await listConditionnements(refCode)
      for (const c of list) conditionnementCache.set(c.id, c)
    }
    return conditionnementCache.get(id)
  }

  // Clé (ref, conditionnement) -> par emplacement.
  const byKey = new Map<string, Map<string, SyntheseLigneEmplacement>>()

  function bucket(refCode: string, conditionnementId: string): Map<string, SyntheseLigneEmplacement> {
    const key = [refCode, conditionnementId].join(SEP)
    let m = byKey.get(key)
    if (!m) {
      m = new Map()
      byKey.set(key, m)
    }
    return m
  }

  for (const row of theorique) {
    const b = bucket(row.ref_code, row.conditionnement_id)
    const line = b.get(row.emplacement_code) ?? {
      emplacementCode: row.emplacement_code,
      theorique: 0,
      compte: null,
      comptageId: null,
      ligneId: null,
      cartons: null,
      pieces: null,
    }
    line.theorique += row.quantite_pieces
    b.set(row.emplacement_code, line)
    await getConditionnement(row.conditionnement_id, row.ref_code)
  }

  // Parcourt TOUS les casiers visités de l'inventaire, pas seulement ceux
  // du théorique — un casier compté qui n'avait aucun stock théorique pour
  // aucune réf du périmètre (palette déplacée vers un endroit "vide") doit
  // quand même apparaître ici, sinon la saisie disparaît silencieusement de
  // la synthèse (2026-09-14, retour terrain).
  for (const c of comptages) {
    if (c.statut !== 'clos') continue
    for (const ligne of lignesByComptage.get(c.id) ?? []) {
      const cond = await getConditionnement(ligne.conditionnement_id, ligne.ref_code)
      const total = ligne.cartons * (cond?.pieces_par_carton ?? 0) + ligne.pieces
      const b = bucket(ligne.ref_code, ligne.conditionnement_id)
      const line = b.get(c.emplacement_code) ?? {
        emplacementCode: c.emplacement_code,
        theorique: 0,
        compte: null,
        comptageId: null,
        ligneId: null,
        cartons: null,
        pieces: null,
      }
      line.compte = total
      line.comptageId = c.id
      line.ligneId = ligne.id
      line.cartons = ligne.cartons
      line.pieces = ligne.pieces
      b.set(c.emplacement_code, line)
    }
  }

  const references: SyntheseReference[] = []
  for (const [key, parEmplacementMap] of byKey) {
    const [refCode, conditionnementId] = key.split(SEP)
    const cond = conditionnementCache.get(conditionnementId)
    const parEmplacement = [...parEmplacementMap.values()].sort((a, b) =>
      a.emplacementCode.localeCompare(b.emplacementCode),
    )

    const theoriqueTotal = parEmplacement.reduce((sum, l) => sum + l.theorique, 0)
    // Un casier jamais visité compte pour 0, tout de suite — pas de seuil
    // "au moins un casier visité" à atteindre avant d'afficher un nombre.
    const compteTotal = parEmplacement.reduce((sum, l) => sum + (l.compte ?? 0), 0)
    const ecartTotal = compteTotal - theoriqueTotal
    const compense = ecartTotal === 0 && parEmplacement.some((l) => l.compte !== null && l.compte !== l.theorique)

    references.push({
      refCode,
      conditionnementId,
      piecesParCarton: cond?.pieces_par_carton ?? 0,
      libelleCourt: cond?.libelle_court ?? null,
      theoriqueTotal,
      compteTotal,
      ecartTotal,
      parEmplacement,
      compense,
    })
  }

  references.sort((a, b) => a.refCode.localeCompare(b.refCode))
  return { references }
}
