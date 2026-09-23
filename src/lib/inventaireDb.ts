import { supabase } from './supabase'
import { listConditionnements, listReferences } from './db'
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

const INVENTAIRE_COLUMNS = 'id, scope_kind, scope_client_code, frozen_ts, statut, abandon_motif, auteur, created_at'

export async function getActiveInventaire(): Promise<Inventaire | null> {
  const { data, error } = await supabase
    .from('inventaires')
    .select(INVENTAIRE_COLUMNS)
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
    .select(INVENTAIRE_COLUMNS)
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

// Extension du périmètre en cours de route (spec 2.54, §6.5) : sans danger
// parce que le théorique n'est jamais une copie figée au lancement — il se
// recalcule sur `ts < frozen_ts` — donc une référence ajoutée après coup
// est comparée au même instant que les autres. `ignoreDuplicates` rend
// l'appel rejouable si la référence a déjà été ajoutée entre-temps (autre
// onglet, ou ligne hors périmètre existante ajoutée deux fois).
export async function addReferenceToScope(inventaireId: string, refCode: string): Promise<void> {
  const { error } = await supabase
    .from('inventaire_references')
    .upsert(
      { inventaire_id: inventaireId, ref_code: refCode },
      { onConflict: 'inventaire_id,ref_code', ignoreDuplicates: true },
    )
  if (error) throw error
}

// Abandon d'un inventaire (spec 2.46 §6.5) : ferme sans écrire aucun
// mouvement, `statut = 'abandonne'`, motif libre conservé, lignes de
// comptage inchangées. Seul régime possible en phase 1 (aucun stock
// d'ouverture amorcé) : une clôture écrirait des `ajustement_inventaire`
// qui seraient en réalité du stock d'ouverture, et polluerait l'indicateur
// de fin de pilote. L'index partiel `one_inventaire_en_cours` se libère de
// lui-même, un inventaire abandonné n'étant plus `en_cours`.
export async function abandonInventaire(inventaireId: string, motif: string): Promise<void> {
  const { error } = await supabase
    .from('inventaires')
    .update({ statut: 'abandonne', abandon_motif: motif })
    .eq('id', inventaireId)
  if (error) throw error
}

// Exportée pour le titre du document imprimé (spec 2.52, §6.5) : le titre
// se dérive de `scope_kind`, jamais saisi — pour le périmètre "références",
// il faut la liste explicite des codes du périmètre.
export async function scopeRefCodes(inventaire: Inventaire): Promise<string[] | undefined> {
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

// Seule et unique implémentation de la suppression d'une saisie (arbitrage
// 2026-09-16) : la marche ET l'écran des écarts l'appellent, pour que le
// bug trouvé une première fois (suppression par `id`, donc de la seule
// ligne la plus récente — une correction plus ancienne du même couple
// resurgissait au lieu de disparaître) ne puisse plus exister à un endroit
// pendant qu'il est corrigé à l'autre. Raisonne toujours sur l'ensemble des
// lignes du couple (casier, réf, conditionnement), jamais sur une seule.
//
// Dette notée en spec §14, pas à traiter ici : un vrai DELETE sur un
// journal en dernière-valeur-gagne reste structurellement fragile (c'est
// aussi ce qui bloque la policy DELETE conditionnée à la clôture). La
// réponse de fond — une ligne d'« absence » plutôt qu'une suppression —
// est candidate à la migration du chantier de clôture, qui restructure
// déjà cette table.
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

// Déplacement d'une saisie vers un autre casier (spec 2.58, §6.5) — jamais
// un update de `comptages.emplacement_code` : un comptage regroupe TOUTES
// les références saisies à cet emplacement, un tel update déplacerait donc
// d'un coup toutes les lignes du casier d'origine, pas seulement celle
// qu'on corrige. C'est exactement ce que l'utilisateur fait aujourd'hui à
// la main (supprimer puis ressaisir) : on écrit une ligne équivalente dans
// le comptage cible (créé si besoin), puis on retire la ligne d'origine de
// son comptage — dans cet ordre, jamais l'inverse, pour qu'un échec entre
// les deux étapes laisse une donnée dupliquée (visible, corrigible) plutôt
// que perdue. Seule et unique implémentation, appelée depuis la marche
// (Modifier, quand le casier change) et depuis l'écran des écarts
// (Déplacer) — même chemin des deux côtés, par exigence explicite de la
// spec.
// Distincte d'une erreur ordinaire (spec 2.36 §3, instanceof jamais un
// message brut) : la ligne a été écrite au casier cible AVANT l'échec, elle
// existe donc réellement aux DEUX emplacements — pas une simple erreur à
// réessayer telle quelle, un état à faire connaître explicitement, faute de
// quoi un réessai duplique une seconde fois et une référence se compte deux
// fois dans la synthèse qui produit l'indicateur du pilote.
export class MoveCasierLignePartialError extends Error {
  targetComptageId: string
  constructor(targetComptageId: string) {
    super('déplacement partiel : la ligne existe maintenant aux deux emplacements')
    this.targetComptageId = targetComptageId
  }
}

export async function moveCasierLigne(
  inventaireId: string,
  ligneId: string,
  ts: string,
  source: { comptageId: string; refCode: string; conditionnementId: string },
  target: { emplacementCode: string; refCode: string; conditionnementId: string; cartons: number; pieces: number },
  auteur: string,
): Promise<{ comptageId: string }> {
  const { comptage } = await getOrCreateCasier(inventaireId, target.emplacementCode)
  await saveCasierLigne(
    ligneId,
    ts,
    comptage.id,
    target.refCode,
    target.conditionnementId,
    target.cartons,
    target.pieces,
    auteur,
  )
  await markCasierVisite(comptage.id)
  try {
    await deleteCasierLignesForRef(source.comptageId, source.refCode, source.conditionnementId)
  } catch {
    throw new MoveCasierLignePartialError(comptage.id)
  }
  return { comptageId: comptage.id }
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
  refLibelle: string | null
  conditionnementId: string
  piecesParCarton: number
  // Libellé du CONDITIONNEMENT ("carton de 12"), jamais celui du produit —
  // voir spec §6.2 v2.24 : déjà confondu avec le nom de l'article sur deux
  // écrans à cause d'un nom de champ ambigu (`libelleCourt`). À afficher
  // uniquement en suffixe de `refLibelle`, jamais seul à sa place.
  conditionnementLabel: string | null
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
  // Libellé du produit, pour affichage seulement — n'entre dans aucune clé
  // ni aucun regroupement de la fusion théorique/compté ci-dessous.
  const refLibelleByCode = new Map((await listReferences()).map((r) => [r.code, r.libelle]))

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
      refLibelle: refLibelleByCode.get(refCode) ?? null,
      conditionnementId,
      piecesParCarton: cond?.pieces_par_carton ?? 0,
      conditionnementLabel: cond?.libelle_court ?? null,
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
