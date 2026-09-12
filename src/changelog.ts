// Changelog affiché discrètement dans l'app (pied de page Accueil/Réglages)
// pour vérifier après un déploiement que la bonne version est bien chargée —
// utile vu les soucis de cache PWA sur iOS. Public interne (pas traduit),
// distinct du dictionnaire i18n qui sert le contenu métier du pilote.
export interface ChangelogEntry {
  version: string
  date: string // AAAA-MM-JJ
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.3.1',
    date: '2026-09-13',
    items: ['Rappel de vérifier le dossier spam/indésirables sur l’écran de saisie du code'],
  },
  {
    version: '0.3.0',
    date: '2026-09-13',
    items: [
      'Connexion par code reçu par e-mail (fonctionne aussi depuis l’app installée sur l’écran d’accueil)',
      'Nouvel écran Inventaire : comptage à l’aveugle, écarts, reprise automatique d’un casier en cours',
      'Écran d’ouverture animé',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-09-12',
    items: [
      'Écran Mouvement (entrée / sortie / transfert)',
      'Réglages : ajout manuel de références et d’emplacements',
      'Détection automatique des mises à jour (bandeau « mise à jour disponible »)',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-09-11',
    items: ['Connexion par lien magique', 'Base de données et permissions (Supabase)'],
  },
]
