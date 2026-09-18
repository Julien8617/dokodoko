# Changelog

Généré depuis `src/changelog.ts` par `npm run changelog` (appelé en
`prebuild`) — ne pas éditer directement, les modifications seraient
écrasées au prochain build. Modifier `src/changelog.ts`, relancer le
build.

## 0.9.22 — 2026-09-19

- Inventaire : nouveau bouton « Abandonner l’inventaire », accessible depuis l’écran de reprise et depuis l’écran des écarts — ferme le comptage sans écrire aucun mouvement (motif libre demandé), ce qui débloque le comptage suivant. C’est le régime normal tant qu’aucun stock d’ouverture n’est amorcé
- Écran des écarts : les chiffres (théorique → compté, écart) passent sur leur propre ligne, sous le libellé, à position fixe d’une ligne à l’autre — un libellé long ne les repousse plus hors de vue. Ajout d’un filtre de recherche en tête d’écran et d’un bouton Imprimer (synthèse en A4, avec la mention « en cours, non clôturé »)
- Inventaire, saisie en marchant : le bouton « voir les écarts » reste maintenant accessible en bas de l’écran même après avoir fait défiler la liste des saisies
- Nouvel écran Catalogue : liste, recherche et filtre par client sur toutes les références, avec conditionnements et stock total affichés directement. La création et la modification d’une référence (libellé, client) se font désormais ici plutôt que dans Réglages
- Catalogue : une référence peut être supprimée si elle ne porte aucun mouvement ni ligne de comptage — sinon l’app indique combien (ex. « 3 mouvements, 12 lignes de comptage ») plutôt que de refuser sans explication

## 0.9.21 — 2026-09-18

- Correction : un échec d’enregistrement affichait parfois « [object Object] » au lieu du vrai message — Supabase ne renvoie pas une vraie erreur JavaScript, le message doit en être extrait explicitement, ce qui manquait à plusieurs endroits
- Correction : lancer un inventaire hors réseau échouait sans aucun message ni indication ; l’écran des écarts pouvait rester bloqué sur « Chargement… » indéfiniment en cas d’échec réseau — les deux affichent maintenant l’erreur
- Inventaire, saisie en marchant : retour au clavier texte normal sur le champ référence — l’usage réel a montré que les lettres servent trop souvent pour privilégier un clavier chiffré
- Stock d’ouverture : le lot d’import est maintenant une étiquette que vous choisissez (ex. « ouverture-2026-09-18 ») plutôt qu’un identifiant technique du fichier — corriger une cellule et réexporter avant de réimporter ne compte donc plus le stock une seconde fois, tant que l’étiquette reste la même
- Stock d’ouverture : rappel affiché que réimporter sous le même lot ne corrige pas une quantité déjà enregistrée — une correction passe par un mouvement ou une annulation

## 0.9.20 — 2026-09-17

- Réglages, import du stock d’ouverture : au-delà d’un tiers des lignes déjà pourvues de stock, un simple appui ne suffit plus — il faut taper un mot de confirmation, signe probable d’avoir rechargé le même fichier une deuxième fois plutôt qu’un chevauchement normal

## 0.9.19 — 2026-09-17

- Réglages : import du stock d’ouverture par fichier CSV — sert de feuille de comptage, un mouvement par ligne. Rejouer le même fichier n’enregistre rien de plus (identifiant dérivé du fichier lui-même), donc un import interrompu peut reprendre sans risquer de compter le stock deux fois
- Un casier déjà pourvu de stock est signalé à l’aperçu plutôt que de bloquer tout le fichier — utile pour reprendre un import coupé en cours de route, sans empêcher un vrai doublon de se voir avant d’enregistrer
- Un casier listé deux fois pour la même référence et le même conditionnement est rejeté avec son numéro de ligne, plutôt que d’en compter un des deux en silence

## 0.9.18 — 2026-09-17

- Réglages : import de clients et de références par fichier CSV — aperçu avant écriture (lignes valides et rejetées, avec le motif), séparateur et encodage (UTF-8 ou Shift-JIS) détectés automatiquement, codes toujours lus comme du texte
- Une référence importée deux fois avec deux conditionnements différents (deux cartons distincts) crée bien les deux, sans marquer le premier à écouler par erreur
- Une référence listée deux fois avec le même conditionnement dans le fichier est signalée dans les lignes rejetées, plutôt que de créer deux fois le même carton

## 0.9.17 — 2026-09-16

- Mesure (pas encore un choix définitif) : le champ référence de la marche s’ouvre sur un clavier orienté chiffres — à confirmer sur iPhone que les lettres restent atteignables pour REU et un nom d’article

## 0.9.16 — 2026-09-16

- Correction : les flèches de navigation entre casiers suivaient l’ordre dans lequel les emplacements avaient été créés (utile seulement quand une zone est générée en un seul lot) plutôt que le parcours zone/baie/niveau (A-01-0, A-01-1, A-01-2, A-02-0…) — suivent maintenant toujours ce parcours

## 0.9.15 — 2026-09-16

- Inventaire, saisie en marchant : flèches à côté du champ casier pour avancer ou reculer d’un casier dans l’ordre de tournée (niveau suivant dans la baie, puis baie suivante, puis zone suivante) — retaper le code à chaque casier n’est plus nécessaire
- Le champ casier se sélectionne entièrement au lieu de s’effacer quand on y retape — un appui involontaire ne perd rien, mais retaper remplace bien d’un coup

## 0.9.14 — 2026-09-16

- Inventaire, écran des écarts : le libellé de la référence (le nom de l’article) s’affiche enfin à côté de son code — il n’y avait jusqu’ici que le libellé du conditionnement (« carton de 12 »), qui décrit l’emballage, pas le produit

## 0.9.13 — 2026-09-16

- Inventaire, saisie en marchant : le libellé de la référence choisie s’affiche en confirmation sous le champ (le champ lui-même revient au code seul une fois la suggestion sélectionnée) — compter la mauvaise référence par erreur de frappe se voit maintenant avant d’enregistrer
- La liste des saisies affiche aussi le libellé de chaque référence, pas seulement son code

## 0.9.12 — 2026-09-16

- Recherche : le résultat affiche maintenant le libellé de la référence trouvée, pas seulement son code — utile en particulier après une recherche par nom
- Recherche : au-delà de 8 références correspondantes, le nombre total est affiché plutôt que de laisser croire qu’un article manquant n’existe pas

## 0.9.11 — 2026-09-16

- Nettoyage interne : le retrait des accents dans la recherche par nom passait par des caractères Unicode bruts dans le code source au lieu d’un motif lisible — comportement inchangé, vérifié par des cas concrets (accents, ordre des mots, priorité du code sur le nom)

## 0.9.10 — 2026-09-16

- Recherche par nom d’article, enfin conforme à la spec : taper « matelas bleu » retrouve « Matelas XL bleu » quel que soit l’ordre des mots, les accents ou la casse — utile quand la facture ne porte pas la référence
- Cette recherche est désormais la même partout (Recherche, Mouvement, sélection de références pour un inventaire) — un code tapé reste prioritaire sur un nom qui le contiendrait par coïncidence (« 65 » retrouve toujours REU065 en premier)

## 0.9.9 — 2026-09-16

- Cache de lecture : les références, emplacements, conditionnements, clients et le stock consultable restent disponibles hors réseau — rafraîchi à l’ouverture, après chaque écriture réussie et au retour du réseau. L’Accueil affiche son âge ("référentiel à jour il y a 2 h")
- La vérification de stock disponible avant une sortie (Mouvement) reste volontairement en direct, jamais sur ce cache, pour ne pas bloquer une sortie légitime sur une donnée périmée

## 0.9.8 — 2026-09-16

- Correction : dans l’écran des écarts, supprimer une saisie corrigée pouvait faire réapparaître sa valeur d’avant correction au lieu de la faire disparaître — même correctif que la liste des saisies en marche (v0.9.7), maintenant partagé par les deux écrans

## 0.9.7 — 2026-09-16

- Inventaire, saisie en marchant : la liste des saisies porte maintenant tout l’inventaire (pas seulement la session en cours) et redemande confirmation avant d’écraser une saisie déjà faite au même casier — remplacer la valeur ou l’ajouter à l’existant

## 0.9.6 — 2026-09-16

- Réglages : générateur d’emplacements en lot (zone, plage de baies, niveaux) — remplace la saisie un par un pour peupler le référentiel avant le démarrage

## 0.9.5 — 2026-09-15

- Accueil : avertissement si l’horloge du téléphone est décalée de plus de quelques minutes par rapport au serveur — un décalage important peut faire perdre une correction de comptage face à l’ancienne valeur qu’elle corrige

## 0.9.4 — 2026-09-15

- Nettoyage interne : la saisie d’un comptage devient rejouable sans risque de doublon ni de résurrection d’une valeur corrigée (identifiant et horodatage pris au moment de la saisie, plus à l’enregistrement) — prépare la file d’attente hors ligne, aucun changement visible

## 0.9.3 — 2026-09-15

- Nettoyage interne : suppression du comptage à l’aveugle pré-refonte (getOrCreateComptage/markAttenduConsulte/closeComptage), remplacé depuis par l’Inventaire en marche libre — aucun changement visible

## 0.9.2 — 2026-09-15

- Accueil : retrait des deux indicateurs qui n’affichaient jamais que « tout est synchronisé » et « 0 mouvement aujourd’hui », sans lien avec la réalité — ils reviendront une fois branchés sur la vraie file hors ligne
- Mouvement : le commentaire devient obligatoire pour une annulation, pour garder une trace lisible de ce qui est corrigé

## 0.9.1 — 2026-09-15

- Correction : en Réglages, un échec d’enregistrement (référence, client ou emplacement) affichait parfois un message sans rapport (« code invalide ou expiré », copié du formulaire de connexion) au lieu de la vraie erreur

## 0.9.0 — 2026-09-14

- Le bouton Recherche fonctionne enfin : cherche le stock actuel par référence (« où se trouve REU003 ? ») ou par emplacement (« qu’y a-t-il dans A-05-1 ? »), avec la même recherche floue et la même reconnaissance des codes emplacement que dans l’Inventaire

## 0.8.0 — 2026-09-14

- Écarts : le détail par emplacement est maintenant cliquable — modifier ou retirer une saisie directement depuis l’écran des écarts, sans repasser par la marche
- Les références sans écart restent visibles (sous « Pas d’écart ») au lieu de disparaître, y compris juste après une correction

## 0.7.0 — 2026-09-14

- Écarts : suppression du statut « casiers en attente » — un casier théorique pas encore compté vaut désormais 0 et apparaît directement comme un écart, sans état intermédiaire
- Inventaire : possibilité de modifier une saisie récente (en plus de l’annuler) — pratique pour corriger un oubli sans tout retaper

## 0.6.1 — 2026-09-14

- Correction : un comptage saisi dans un casier sans stock théorique (palette déplacée) disparaissait silencieusement de l’écran des écarts au lieu d’y apparaître
- Écarts : le résultat s’affiche dès qu’un casier de la référence a été compté, sans attendre que tous ses casiers théoriques soient visités — un casier théorique pas encore compté est maintenant lui-même signalé (« à vérifier »)

## 0.6.0 — 2026-09-14

- Inventaire : liste déroulante d’aide à la frappe sur le champ référence — recherche par sous-chaîne (« 65 », « 265 » ou « REU26 » trouvent tous « REU265 »), pas besoin de taper le code en entier
- Astuce : comme la recherche marche avec les chiffres seuls, un seul passage au clavier numérique suffit pour trouver une référence, sans revenir au clavier lettres

## 0.5.2 — 2026-09-14

- Correction : texte parfois invisible (blanc sur blanc) dans la liste déroulante de suggestions
- Fond d’écran plus gris pour mieux distinguer les champs de saisie

## 0.5.1 — 2026-09-14

- Inventaire : liste déroulante d’aide à la frappe sur le champ casier — reconnaît les saisies sans tiret ni zéro de tête (ex. « A11 » ou « A-1-1 » pour « A-01-1 »), sans jamais imposer de choisir dans la liste

## 0.5.0 — 2026-09-14

- Inventaire : la saisie se fait maintenant en marchant librement (emplacement + référence + quantité, sans liste ni suggestion) — une palette déplacée sans le signaler se retrouve donc détectée à la comparaison finale
- L’écran des écarts liste maintenant les casiers jamais saisis, pas seulement leur nombre
- Correction : annuler une saisie ne supprime plus par erreur une correction plus récente de la même référence

## 0.4.0 — 2026-09-14

- Refonte de l’Inventaire : lancement par périmètre (tout l’entrepôt / un client / des références), stock théorique figé au lancement, liste des casiers avec progression, comptage précédent/suivant, synthèse des écarts en deux niveaux
- Nouvelle dimension client (Réglages : ajout de clients, réf rattachée à un client)
- Le comptage n’écrit plus de mouvement automatiquement — le traitement des écarts et la clôture arrivent dans une prochaine mise à jour

## 0.3.1 — 2026-09-13

- Rappel de vérifier le dossier spam/indésirables sur l’écran de saisie du code

## 0.3.0 — 2026-09-13

- Connexion par code reçu par e-mail (fonctionne aussi depuis l’app installée sur l’écran d’accueil)
- Nouvel écran Inventaire : comptage à l’aveugle, écarts, reprise automatique d’un casier en cours
- Écran d’ouverture animé

## 0.2.0 — 2026-09-12

- Écran Mouvement (entrée / sortie / transfert)
- Réglages : ajout manuel de références et d’emplacements
- Détection automatique des mises à jour (bandeau « mise à jour disponible »)

## 0.1.0 — 2026-09-11

- Connexion par lien magique
- Base de données et permissions (Supabase)
