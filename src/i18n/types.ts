export type Locale = 'fr' | 'ja' | 'en'

// Clés techniques des motifs de mouvement (spec v2 §5). Jamais traduites en
// base — seule leur étiquette affichée change avec la langue.
export type MotifKey =
  | 'reception'
  | 'retour_client'
  | 'stock_initial'
  | 'ajustement_inventaire'
  | 'annulation'
  | 'transfert_entree'
  | 'commande_client'
  | 'produit_defaillant'
  | 'destruction'
  | 'transfert_sortie'

// Dictionnaire plat par namespace, sans librairie d'i18n. `fr` sert de
// référence : toute clé absente dans `ja` ou `en` doit être une erreur de
// compilation (spec v2 §6.7, critère d'acceptation 28), donc chaque fichier
// de langue déclare `const x: Dictionary = {...}` plutôt que d'inférer son
// propre type.
export interface Dictionary {
  app: {
    name: string
  }
  nav: {
    search: string
    movement: string
    inventory: string
    settings: string
  }
  home: {
    // {count} remplacé manuellement, pas d'interpolation automatique
    offlineQueuePending: string
    offlineQueueEmpty: string
    lastExport: string
    movementsToday: string
  }
  common: {
    cancel: string
    confirm: string
    validate: string
    back: string
    add: string
    save: string
    loading: string
  }
  auth: {
    emailLabel: string
    emailPlaceholder: string
    sendLink: string
    sending: string
    linkSent: string
    error: string
    signOut: string
  }
  motifs: Record<MotifKey, string>
}
