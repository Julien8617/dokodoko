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
    // Mode modification du formulaire de saisie (spec 2.60 §6.5) : dit
    // quelle ligne est en cours de correction, à côté d'une sortie sans
    // écrire (t.common.cancel) — jamais un second champ de saisie sous la
    // ligne de la liste, une seule surface d'édition sur cet écran.
    editingBanner: string // {refCode}, {emplacement}
    // Action immédiate et irréversible — double appui, même motif que
    // confirmArmed/deleteArmed : removeLine porte le libellé au repos,
    // removeArmed celui affiché entre les deux appuis. Volontairement
    // court (contrairement à confirmArmed/deleteArmed ailleurs) : ce
    // bouton vit dans un petit menu, pas une rangée pleine largeur. Le
    // verbe reste le même entre repos et armement ("Supprimer" /
    // "Supprimer ?") — seul le point d'interrogation et le fond rouge
    // plein changent. Vocabulaire fixé en spec 2.58 §6.5 : "Supprimer"
    // partout où il s'agit d'effacer une saisie, "Annuler" réservé à la
    // clôture/l'abandon d'un inventaire — jamais les deux pour la même
    // famille d'action.
    removeLine: string
    removeArmed: string
    editLine: string
    // Bouton "…" qui déplie Modifier/Supprimer sur une saisie de la liste
    // (spec 2.58 §6.5) — texte de l'attribut aria-label uniquement, le
    // bouton lui-même affiche juste le symbole.
    entryMenuLabel: string
    // Bouton de suppression du panneau d'édition (écran des écarts, détail
    // par emplacement) — clé distincte de removeLine, même vocabulaire
    // "Supprimer" (spec 2.58 §6.5).
    deleteEntry: string
    // Déplacement d'une saisie vers un autre casier (spec 2.58 §6.5) :
    // jamais un update de comptages.emplacement_code (voir moveCasierLigne,
    // inventaireDb.ts) — retirer puis réécrire ailleurs. Confirmation
    // simple avec récapitulatif, PAS un double appui : rien n'est détruit,
    // le contenu est relocalisé.
    moveEntry: string
    moveConfirm: string // {refCode}, {from}, {to}
    // Collision à la destination d'un déplacement, fusionnée dans le même
    // écran que moveConfirm (spec 2.62 §6.5, jamais un second dialogue) —
    // addEntry/replaceEntry portent déjà "Ajouter"/"Remplacer", les totaux
    // calculés sont composés directement dans le JSX à côté.
    moveCollisionExisting: string // {emplacement}, {cartons}, {pieces}
    // Changement de quantité dans le même geste qu'un déplacement (spec
    // 2.65 §6.5, marche uniquement — les Écarts n'ont pas de champ de
    // quantité) : affiché seulement quand la valeur change, s'ajoute au
    // bloc de collision ci-dessus sans le remplacer. Trois variantes plutôt
    // qu'une seule chaîne toujours-les-deux-unités : l'exemple de spec
    // ("Quantité : 4 → 2 cartons") ne mentionne que l'unité qui change — un
    // "0 → 0 pièces" à côté d'un changement de cartons décrirait un
    // non-changement comme s'il en était un.
    moveQuantityChangeCartons: string // {from}, {to}
    moveQuantityChangePieces: string // {from}, {to}
    moveQuantityChangeBoth: string // {fromCartons}, {toCartons}, {fromPieces}, {toPieces}
    moveSameEmplacement: string
    // La ligne a été écrite au casier cible avant l'échec de son retrait du
    // casier d'origine (MoveCasierLignePartialError) — elle existe donc
    // réellement aux deux endroits. Jamais un message générique ici : un
    // réessai naïf duplique une seconde fois.
    moveDuplicatedError: string
    // {emplacement}, {refCode}, {cartons}, {pieces} remplacés via
    // interpolate() — la quantité déjà en place à la destination doit être
    // visible dans la question (spec 2.61 §6.5) : depuis que ce choix peut
    // naître d'un déplacement en mode modification, l'opérateur n'est plus
    // forcément devant ce casier pour la connaître autrement.
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
    // Référence inactive tapée en entier dans la marche (spec 2.67 §6.2) :
    // acceptée, jamais refusée (§4, fait physique) — mais pas en silence.
    // Même mécanisme que scopeExtensionQuestion ci-dessus, peut s'afficher
    // avec elle dans la même fenêtre.
    inactiveReferenceQuestion: string // {refCode}
    // Rappel des références à compter, en inventaire partiel uniquement —
    // jamais "terminée", jamais l'emplacement attendu (ce serait le
    // théorique, donc compter vers une cible), et depuis spec 2.58 §6.5
    // jamais non plus d'indicateur d'état par référence (grisé, "comptée
    // dans N casiers") : une référence éparpillée sur plusieurs casiers
    // reste à compter ailleurs même une fois rencontrée une fois, un
    // marqueur "fait" induirait en erreur sur une complétude que rien ne
    // garantit. Liste uniforme, code + libellé seulement.
    scopeChecklistTitle: string
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
    // Spec 2.66 point 4 bis : mention d'état affichée partout où une
    // référence inactive reste visible (Recherche, Catalogue) — jamais dans
    // les sélecteurs de saisie, d'où elle est retirée.
    inactiveLabel: string
    activateButton: string
    deactivateButton: string
    // {stock} — pièces, tous emplacements/conditionnements confondus,
    // lues en direct (jamais le cache) au moment du clic.
    deactivateBlocked: string
    // {scope} — libellé du périmètre de l'inventaire en cours qui couvre
    // encore cette référence (spec 2.67 §6.8).
    deactivateBlockedByInventaire: string
  }
}
