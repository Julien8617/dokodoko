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
    catalogue: string
    settings: string
  }
  home: {
    // {count} remplacé manuellement, pas d'interpolation automatique
    offlineQueuePending: string
    offlineQueueEmpty: string
    lastExport: string
    movementsToday: string
    // {when} remplacé via interpolate() — ex. "il y a 2 heures"
    cacheAge: string
    cacheNeverLoaded: string
  }
  clockDrift: {
    // {hours} remplacé via interpolate() — horloge de l'appareil trop
    // éloignée de celle du serveur (spec v2 §3.1, mitigation en attendant
    // le compteur monotone par appareil du chantier de clôture)
    warning: string
  }
  common: {
    cancel: string
    confirm: string
    validate: string
    back: string
    add: string
    save: string
    loading: string
    // Repli EXPLICITE quand une erreur n'a pas de message exploitable
    // (§3, spec 2.35) — jamais l'objet d'erreur lui-même.
    unknownError: string
  }
  auth: {
    emailLabel: string
    emailPlaceholder: string
    sendLink: string
    sending: string
    linkSent: string
    checkSpam: string
    codeLabel: string
    verifyCode: string
    changeEmail: string
    sendError: string
    error: string
    signOut: string
  }
  motifs: Record<MotifKey, string>
  settings: {
    title: string
    addReference: string
    addEmplacement: string
    addClient: string
    client: string
    clientSearch: string
    clientNom: string
    code: string
    libelle: string
    piecesParCarton: string
    ordreOptional: string
    saved: string
    saveError: string
    generateEmplacements: string
    zone: string
    baieFrom: string
    baieTo: string
    niveaux: string
    generate: string
    // {created} et {skipped} remplacés via interpolate()
    generated: string
    // Import CSV (§7, spec 2.32)
    importClients: string
    importReferences: string
    importPreviewValid: string // {count}
    importPreviewRejected: string // {count}
    importRejectedLine: string // {line}, {reason}
    importConfirm: string
    importing: string
    importDoneClients: string // {count}
    importDoneReferences: string // {ok}
    importReferencesFailed: string // {count}
    importStockOuverture: string
    importBatchLabel: string
    importBatchId: string // {batchId}
    importPreviewWarnings: string // {count}
    importDoneStockOuverture: string // {count}
    // Confirmation proportionnée (§6.4, spec du 2026-09-17) : au-delà d'un
    // tiers des lignes valides déjà pourvues de stock, taper ce mot
    // remplace le simple appui — signature probable d'un second chargement
    // complet plutôt qu'un chevauchement normal.
    importOverlapWord: string
    importOverlapWarning: string // {count}, {total}, {word}
    // Corollaire explicite (§7, spec 2.35) : sous le même lot, une ligne
    // déjà importée est ignorée même si sa quantité a changé — une
    // correction passe par un mouvement ou une annulation, jamais par un
    // réimport.
    importReplayNote: string
  }
  movement: {
    title: string
    sensEntree: string
    sensSortie: string
    sensTransfert: string
    reference: string
    referenceSearch: string
    emplacement: string
    emplacementSearch: string
    emplacementDestination: string
    conditionnement: string
    aEcouler: string
    cartons: string
    pieces: string
    totalFormula: string
    motif: string
    motifPlaceholder: string
    comment: string
    commentRequiredAnnulation: string
    confirmArmed: string
    insufficientStock: string
    success: string
    back: string
    sameEmplacement: string
  }
  search: {
    title: string
    back: string
    modeReference: string
    modeEmplacement: string
    searchButton: string
    loading: string
    noResults: string
    invalidEmplacement: string
    pickSuggestion: string
    // {shown} et {total} remplacés via interpolate() — §6.2, spec 2.22 :
    // un plafond silencieux ferait conclure qu'un article n'existe pas
    // alors qu'il est le neuvième
    moreMatches: string
  }
  inventory: {
    title: string
    back: string
    loading: string
    // Lancement
    launchScope: string
    scopeTout: string
    scopeClient: string
    scopeReferences: string
    resumeTitle: string
    resumeSubtitle: string
    resumeButton: string
    clientPickTitle: string
    referencesPickTitle: string
    referenceSearch: string
    selectedCount: string
    start: string
    viewEcarts: string
    // Saisie en marchant
    casier: string
    casierPlaceholder: string
    previousCasier: string
    nextCasier: string
    reference: string
    referencePlaceholder: string
    conditionnement: string
    aEcouler: string
    cartons: string
    pieces: string
    removeLine: string
    editLine: string
    // {emplacement} et {refCode} remplacés via interpolate()
    duplicateEntry: string
    replaceEntry: string
    addEntry: string
    showMore: string
    invalidEmplacement: string
    unknownReference: string
    emptyQuantity: string
    recorded: string
    // Écarts
    ecartsTitle: string
    syntheseTitle: string
    noEcart: string
    sansEcartLabel: string
    ecartCompense: string
    ecartReel: string
    detailByEmplacement: string
    notAllVisited: string
    phase1Notice: string
    // Abandon (spec 2.46 §6.5, échéance ferme le 25 septembre) : seule
    // sortie possible en phase 1 (aucun stock d'ouverture amorcé, tout
    // écart y est positif par construction — une clôture polluerait
    // l'indicateur du pilote).
    abandonTitle: string
    abandonHint: string
    abandonMotifLabel: string
    abandonMotifPlaceholder: string
    abandonButton: string
    // Le bouton reste dans le dictionnaire (chrome d'interface, traduit) ;
    // le contenu du document imprimé lui-même est fixé en japonais
    // (PRINT_JA, Inventory.tsx) — voir spec 2.49 §6.5.
    printButton: string
    // Inventaire partiel (spec 2.54, §6.5) : la saisie libre garde comme
    // cible l'emplacement, jamais une référence hors périmètre — proposer
    // d'étendre, jamais enregistrer en silence.
    scopeExtensionQuestion: string // {refCode}
    // Rappel des références à compter, en inventaire partiel uniquement —
    // jamais "terminée", jamais l'emplacement attendu (ce serait le
    // théorique, donc compter vers une cible).
    scopeChecklistTitle: string
    scopeNotCounted: string
    scopeCountedIn: string // {count}
    // Marque une saisie déjà enregistrée hors périmètre, sur l'écran des
    // écarts — même action "ajouter au périmètre" que côté saisie.
    scopeOutOfPerimeter: string
    scopeAddButton: string
    // Le périmètre n'a pas pu être chargé (réseau) — bloque la saisie
    // plutôt que de la laisser passer sans filtre ni question d'extension.
    scopeLoadError: string
  }
  catalogue: {
    title: string
    searchPlaceholder: string
    clientFilterAll: string
    noResults: string
    editTitle: string
    codeLabel: string // {code}
    // {mouvements}, {comptageLignes} — §4 : "l'app dit pourquoi", jamais un
    // refus muet.
    usageBlocking: string
    deleteButton: string
    deleteArmed: string
  }
}
