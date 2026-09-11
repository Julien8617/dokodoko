import type { Dictionary } from './types'

const fr: Dictionary = {
  app: {
    name: 'どこどこ',
  },
  nav: {
    search: 'Rechercher',
    movement: 'Mouvement',
    inventory: 'Inventaire',
    settings: 'Réglages',
  },
  home: {
    offlineQueuePending: '{count} mouvements en attente',
    offlineQueueEmpty: 'Tout est synchronisé',
    lastExport: 'Dernier export : {date}',
    movementsToday: '{count} mouvements aujourd’hui',
  },
  common: {
    cancel: 'Annuler',
    confirm: 'Confirmer',
    validate: 'Valider',
    back: 'Retour',
    add: 'Ajouter',
    save: 'Enregistrer',
    loading: 'Chargement…',
  },
  auth: {
    emailLabel: 'Adresse e-mail',
    emailPlaceholder: 'prenom.nom@exemple.com',
    sendLink: 'Envoyer le lien de connexion',
    sending: 'Envoi…',
    linkSent: 'Lien envoyé — vérifiez votre boîte mail.',
    error: 'Échec de l’envoi. Réessayez.',
    signOut: 'Se déconnecter',
  },
  motifs: {
    reception: 'Réception',
    retour_client: 'Retour client',
    stock_initial: 'Stock initial',
    ajustement_inventaire: 'Ajustement d’inventaire',
    annulation: 'Annulation',
    transfert_entree: 'Transfert — entrée',
    commande_client: 'Commande client',
    produit_defaillant: 'Produit défaillant',
    destruction: 'Destruction',
    transfert_sortie: 'Transfert — sortie',
  },
}

export default fr
