import type { MotifKey } from '../i18n'

export interface Reference {
  code: string
  libelle: string | null
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
