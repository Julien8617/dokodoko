import type { Dictionary } from './types'

const en: Dictionary = {
  app: {
    name: 'どこどこ',
  },
  nav: {
    search: 'Search',
    movement: 'Movement',
    inventory: 'Inventory',
    settings: 'Settings',
  },
  home: {
    offlineQueuePending: '{count} movements pending',
    offlineQueueEmpty: 'Everything is synced',
    lastExport: 'Last export: {date}',
    movementsToday: '{count} movements today',
  },
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    validate: 'Validate',
    back: 'Back',
    add: 'Add',
    save: 'Save',
    loading: 'Loading…',
  },
  motifs: {
    reception: 'Receipt',
    retour_client: 'Customer return',
    stock_initial: 'Opening stock',
    ajustement_inventaire: 'Count adjustment',
    annulation: 'Reversal',
    transfert_entree: 'Transfer in',
    commande_client: 'Customer order',
    produit_defaillant: 'Defective',
    destruction: 'Disposal',
    transfert_sortie: 'Transfer out',
  },
}

export default en
