import type { MotifKey } from '../i18n'

export interface Reference {
  code: string
  libelle: string | null
  client_code: string
  // Spec 2.66 point 4 bis : retire la référence des sélecteurs de saisie
  // (Mouvement, Inventaire) sans rien effacer — reste visible dans la
  // Recherche, l'historique et les exports, avec une mention de son état.
  // Réactivable à tout moment.
  actif: boolean
}

export interface Client {
  code: string
  nom: string
}

export interface Emplacement {
  code: string
  zone: string
  baie: number
  niveau: number
  ordre: number | null
}

export interface Conditionnement {
  id: string
  ref_code: string
  pieces_par_carton: number
  libelle_court: string | null
  a_ecouler: boolean
}

export interface StockRow {
  emplacement_code: string
  ref_code: string
  conditionnement_id: string
  quantite_pieces: number
}

export interface MouvementInsert {
  id: string
  ts: string
  ref_code: string
  emplacement_code: string
  quantite_pieces: number
  motif: MotifKey
  commentaire?: string | null
  transfert_id?: string | null
  comptage_id?: string | null
  annule_mouvement_id?: string | null
  conditionnement_id: string
  auteur: string
}

export type Sens = 'entree' | 'sortie' | 'transfert'

export interface Comptage {
  id: string
  emplacement_code: string
  ts: string
  statut: 'en_cours' | 'clos'
  attendu_consulte: boolean
}

export interface StockLine {
  ref_code: string
  conditionnement_id: string
  quantite_pieces: number
}

export interface StockByReferenceLine {
  emplacement_code: string
  conditionnement_id: string
  quantite_pieces: number
}

export type ScopeKind = 'tout' | 'client' | 'references'

export interface Inventaire {
  id: string
  scope_kind: ScopeKind
  scope_client_code: string | null
  frozen_ts: string
  // 'abandonne' (spec 2.46 §6.5) : ferme un comptage sans écrire aucun
  // mouvement — le régime de la phase 1, tant qu'aucun stock d'ouverture
  // n'est amorcé et que tout écart y est positif par construction.
  statut: 'en_cours' | 'clos' | 'abandonne'
  abandon_motif: string | null
  auteur: string
  created_at: string
}

export interface ComptageLigne {
  id: string
  comptage_id: string
  ref_code: string
  conditionnement_id: string
  cartons: number
  pieces: number
  ts: string
  auteur: string
}

// Une ligne de comptage résolue pour l'écran : théorique (figé au
// lancement), dernière saisie connue (ou non touchée), et le nécessaire
// pour l'affichage (libellé, pièces/carton, à écouler).
export interface CasierLigne {
  refCode: string
  conditionnementId: string
  piecesParCarton: number
  libelleCourt: string | null
  aEcouler: boolean
  theorique: number
  cartons: number | null // null = jamais saisi, distinct de 0
  pieces: number | null
}
