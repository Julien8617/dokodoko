import { supabase } from './supabase'
import type { Client, Conditionnement, Emplacement, Reference, StockRow } from './types'

// Cache de lecture (spec v2 §3) : sans lui, hors réseau, l'app n'a accès à
// aucun référentiel et il n'y a donc rien à saisir. Portée volontairement
// étroite : les référentiels (references, emplacements, conditionnements,
// clients) et un instantané du stock pour la consultation (Recherche,
// affichage informatif) — jamais le journal `mouvements`, qui n'a pas à
// descendre sur le téléphone.
//
// N'entrent PAS dans ce cache : `getStock` (vérification de disponibilité
// à la saisie d'un Mouvement) et `stockAsOf`/`getInventaireSynthese`
// (théorique figé d'un inventaire). Les deux doivent rester exacts et donc
// réseau — voir le commentaire sur `getStock` dans db.ts. Le motif n'est
// pas conjoncturel (« le refus bloquant sera bientôt un avertissement ») :
// refuser une sortie sur une donnée périmée est pire que la refuser sur
// une donnée fraîche, puisque l'app interdirait alors ce que le serveur
// aurait accepté — un cache par nature périmé ne doit donc jamais
// alimenter un refus bloquant, que ce refus soit amené à disparaître ou
// non (arbitrage 2026-09-16).
//
// Conséquence non anticipée de cette même séparation : si `getStock` est
// un verrou réseau, une sortie hors ligne échoue avant même d'atteindre
// l'écriture — il n'y a donc rien à mettre dans la file hors ligne tant
// que ce verrou existe. La fin du blocage (§6.4) est un PRÉREQUIS de la
// file d'écriture, pas une suite : l'ordre du 18 octobre a été inversé en
// conséquence (arbitrage 2026-09-16, à répercuter dans CLAUDE.md).
//
// Hypothèse dont dépend "une création en Réglages apparaît immédiatement
// dans les sélecteurs" (§3) : chaque écran de cette app se remonte
// entièrement à la navigation (App.tsx bascule par un simple retour
// conditionnel, jamais un composant gardé en vie masqué). Rafraîchir ce
// cache suffit donc à propager une écriture au prochain écran ouvert. Le
// jour où un écran conservera son état entre deux navigations, cette
// republication ne suffira plus — il faudra un abonnement réactif
// (ex. useSyncExternalStore), pas seulement republier la donnée.
interface Referentiel {
  references: Reference[]
  emplacements: Emplacement[]
  clients: Client[]
  conditionnements: Conditionnement[]
  stock: StockRow[]
  fetchedAt: number | null
}

const STORAGE_KEY = 'dokodoko:referentiel-cache:v1'

function emptyReferentiel(): Referentiel {
  return { references: [], emplacements: [], clients: [], conditionnements: [], stock: [], fetchedAt: null }
}

// Lu une fois, de façon synchrone, au chargement du module : le premier
// rendu (y compris hors réseau, app rouverte) a immédiatement les données
// de la session précédente, sans attendre une ouverture IndexedDB.
function loadFromStorage(): Referentiel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyReferentiel()
    return { ...emptyReferentiel(), ...JSON.parse(raw) }
  } catch {
    return emptyReferentiel()
  }
}

let cache: Referentiel = loadFromStorage()
let loadPromise: Promise<void> | null = null

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Quota dépassé ou navigation privée : le cache reste utilisable en
    // mémoire pour la session en cours, seule la persistance entre
    // sessions est perdue — pas une raison d'interrompre l'appelant.
  }
}

// Rafraîchit depuis le réseau — à appeler à l'ouverture de l'app, après
// chaque écriture réussie susceptible de changer un référentiel ou le
// stock (création en Réglages, mouvement inséré), et au retour du réseau
// (spec v2 §3). Ne jette jamais : hors réseau, le cache existant — même
// périmé — reste la seule chose utilisable, un throw casserait l'écran
// appelant pour un rafraîchissement qui n'est qu'une amélioration.
export async function refreshReferentielCache(): Promise<boolean> {
  try {
    const [references, emplacements, clients, conditionnements, stock] = await Promise.all([
      supabase.from('references').select('code, libelle, client_code'),
      supabase.from('emplacements').select('code, zone, baie, niveau, ordre'),
      supabase.from('clients').select('code, nom'),
      supabase.from('conditionnements').select('id, ref_code, pieces_par_carton, libelle_court, a_ecouler'),
      supabase.from('stock').select('emplacement_code, ref_code, conditionnement_id, quantite_pieces'),
    ])
    for (const r of [references, emplacements, clients, conditionnements, stock]) {
      if (r.error) throw r.error
    }

    cache = {
      references: (references.data as Reference[]).sort((a, b) => a.code.localeCompare(b.code)),
      emplacements: (emplacements.data as Emplacement[]).sort(
        (a, b) =>
          (a.ordre ?? Infinity) - (b.ordre ?? Infinity) ||
          a.zone.localeCompare(b.zone) ||
          a.baie - b.baie ||
          a.niveau - b.niveau,
      ),
      clients: (clients.data as Client[]).sort((a, b) => a.nom.localeCompare(b.nom)),
      conditionnements: conditionnements.data as Conditionnement[],
      stock: stock.data as StockRow[],
      fetchedAt: Date.now(),
    }
    persist()
    return true
  } catch {
    return false
  }
}

// Filet pour le tout premier accès de la session : si rien n'a jamais été
// chargé (ni cette session, ni une précédente persistée), tente un premier
// réseau. N'est PAS un rafraîchissement — un cache déjà chargé, même
// périmé de plusieurs heures, n'appelle pas le réseau ici : seuls les
// trois déclencheurs explicites de refreshReferentielCache font ça.
//
// `loadPromise` n'est jamais réinitialisé après un échec : un premier accès
// hors réseau au tout premier lancement (fetchedAt toujours null) ne
// réessaiera donc pas tout seul via ce chemin à chaque nouvel appel. Ce
// n'est pas un bug silencieux — App.tsx écoute l'évènement `online` et
// appelle refreshReferentielCache() directement (hors ensureLoaded), qui
// pose fetchedAt dès qu'il réussit et rend ce filet inutile ensuite.
function ensureLoaded(): Promise<void> {
  if (cache.fetchedAt !== null) return Promise.resolve()
  if (!loadPromise) loadPromise = refreshReferentielCache().then(() => {})
  return loadPromise
}

// Âge du cache en ms, pour l'affichage "référentiel à jour il y a 2 h"
// (spec v2 §3) — null tant qu'aucun chargement n'a jamais réussi.
export function getReferentielAgeMs(): number | null {
  return cache.fetchedAt === null ? null : Date.now() - cache.fetchedAt
}

export async function getReferences(): Promise<Reference[]> {
  await ensureLoaded()
  return cache.references
}

export async function getEmplacements(): Promise<Emplacement[]> {
  await ensureLoaded()
  return cache.emplacements
}

export async function getClients(): Promise<Client[]> {
  await ensureLoaded()
  return cache.clients
}

export async function getConditionnementsForRef(refCode: string): Promise<Conditionnement[]> {
  await ensureLoaded()
  return cache.conditionnements
    .filter((c) => c.ref_code === refCode)
    .sort((a, b) => Number(b.a_ecouler) - Number(a.a_ecouler))
}

export async function getStockAtEmplacement(emplacementCode: string): Promise<StockRow[]> {
  await ensureLoaded()
  return cache.stock.filter((row) => row.emplacement_code === emplacementCode && row.quantite_pieces !== 0)
}

export async function getStockByReference(refCode: string): Promise<StockRow[]> {
  await ensureLoaded()
  return cache.stock.filter((row) => row.ref_code === refCode && row.quantite_pieces !== 0)
}
