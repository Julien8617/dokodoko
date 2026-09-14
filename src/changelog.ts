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
    version: '0.9.1',
    date: '2026-09-15',
    items: [
      'Correction : en Réglages, un échec d’enregistrement (référence, client ou emplacement) affichait parfois un message sans rapport (« code invalide ou expiré », copié du formulaire de connexion) au lieu de la vraie erreur',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-09-14',
    items: [
      'Le bouton Recherche fonctionne enfin : cherche le stock actuel par référence (« où se trouve REU003 ? ») ou par emplacement (« qu’y a-t-il dans A-05-1 ? »), avec la même recherche floue et la même reconnaissance des codes emplacement que dans l’Inventaire',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-09-14',
    items: [
      'Écarts : le détail par emplacement est maintenant cliquable — modifier ou retirer une saisie directement depuis l’écran des écarts, sans repasser par la marche',
      'Les références sans écart restent visibles (sous « Pas d’écart ») au lieu de disparaître, y compris juste après une correction',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-09-14',
    items: [
      'Écarts : suppression du statut « casiers en attente » — un casier théorique pas encore compté vaut désormais 0 et apparaît directement comme un écart, sans état intermédiaire',
      'Inventaire : possibilité de modifier une saisie récente (en plus de l’annuler) — pratique pour corriger un oubli sans tout retaper',
    ],
  },
  {
    version: '0.6.1',
    date: '2026-09-14',
    items: [
      'Correction : un comptage saisi dans un casier sans stock théorique (palette déplacée) disparaissait silencieusement de l’écran des écarts au lieu d’y apparaître',
      'Écarts : le résultat s’affiche dès qu’un casier de la référence a été compté, sans attendre que tous ses casiers théoriques soient visités — un casier théorique pas encore compté est maintenant lui-même signalé (« à vérifier »)',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-09-14',
    items: [
      'Inventaire : liste déroulante d’aide à la frappe sur le champ référence — recherche par sous-chaîne (« 65 », « 265 » ou « REU26 » trouvent tous « REU265 »), pas besoin de taper le code en entier',
      'Astuce : comme la recherche marche avec les chiffres seuls, un seul passage au clavier numérique suffit pour trouver une référence, sans revenir au clavier lettres',
    ],
  },
  {
    version: '0.5.2',
    date: '2026-09-14',
    items: [
      'Correction : texte parfois invisible (blanc sur blanc) dans la liste déroulante de suggestions',
      'Fond d’écran plus gris pour mieux distinguer les champs de saisie',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-09-14',
    items: [
      'Inventaire : liste déroulante d’aide à la frappe sur le champ casier — reconnaît les saisies sans tiret ni zéro de tête (ex. « A11 » ou « A-1-1 » pour « A-01-1 »), sans jamais imposer de choisir dans la liste',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-09-14',
    items: [
      'Inventaire : la saisie se fait maintenant en marchant librement (emplacement + référence + quantité, sans liste ni suggestion) — une palette déplacée sans le signaler se retrouve donc détectée à la comparaison finale',
      'L’écran des écarts liste maintenant les casiers jamais saisis, pas seulement leur nombre',
      'Correction : annuler une saisie ne supprime plus par erreur une correction plus récente de la même référence',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-09-14',
    items: [
      'Refonte de l’Inventaire : lancement par périmètre (tout l’entrepôt / un client / des références), stock théorique figé au lancement, liste des casiers avec progression, comptage précédent/suivant, synthèse des écarts en deux niveaux',
      'Nouvelle dimension client (Réglages : ajout de clients, réf rattachée à un client)',
      'Le comptage n’écrit plus de mouvement automatiquement — le traitement des écarts et la clôture arrivent dans une prochaine mise à jour',
    ],
  },
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
