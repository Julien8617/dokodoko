# どこどこ — Spec v2 : pilote de suivi de stock

Remplace la spec v1 (cartographie seule). Ce qui en est repris est signalé.

## 1. Ce que le changement implique

La v1 était une carte : aucune quantité, aucun engagement. Une erreur coûtait trente mètres à pied.

La v2 porte des quantités et des mouvements. Sur le périmètre du pilote, **l'app devient la source de vérité du stock**. Trois conséquences qui structurent tout le reste :

- la sauvegarde n'est plus une commodité ;
- tout mouvement doit être justifié et jamais effaçable ;
- l'inventaire ne remplace pas une valeur, il enregistre un comptage et l'écart qui en découle.

## 2. Cadre du pilote

À écrire dans le README du dépôt, avant la première ligne de code :

- le périmètre exact de l'échantillon (zone, famille de produits, ou client) et pourquoi il est isolable physiquement ;
- la date de début ;
- le fait que l'Excel reste tenu en parallèle **sur ce périmètre** pendant toute la durée du pilote ;
- la durée prévue et le critère d'arrêt.

Sans ces quatre lignes écrites d'avance, un pilote ne s'arrête jamais et ne se conclut jamais.

L'indicateur du pilote est unique : l'écart entre l'app et le comptage physique à la fin de la période. Pas le nombre de fonctions livrées.

## 3. Architecture

**Décision : Supabase est la source de vérité. Le front est un site statique sur GitHub Pages. Railway est inutile ici** — il n'y a pas de backend à héberger, Supabase fournit Postgres, l'API et l'authentification.

- Front : React + TypeScript + Vite, PWA installée sur l'écran d'accueil de l'iPhone.
- Lectures : cache local (IndexedDB) rafraîchi à l'ouverture et après chaque écriture, pour que la consultation reste instantanée dans les allées.
- Écritures : envoyées à Supabase ; en cas d'échec réseau, mises en file dans IndexedDB et rejouées automatiquement. L'`id` UUID généré côté client rend le rejeu idempotent — c'est ce qui permet de rejouer sans jamais compter deux fois.
- L'état de la file hors ligne est **visible en permanence** : un bandeau « 3 mouvements en attente » tant que la file n'est pas vide. Un mouvement non remonté qu'on croit enregistré est le pire défaut possible pour ce genre d'outil.

### Sur la « synchronisation Excel »

Elle n'existe pas. Un PWA sur iPhone ne peut pas écrire dans un fichier Excel posé sur un PC ; il n'y a pas de chemin direct entre les deux. Ce qui existe :

- un export `.xlsx` depuis l'app, transmis par le partage iOS ;
- l'interrogation directe de Supabase depuis le PC — vue SQL, export CSV, ou connexion Excel via Power Query sur l'API REST.

La seconde voie donne le résultat que vous cherchez sans ressaisie. Ne pas coder de « synchro » bidirectionnelle : deux sources de vérité qui se recopient l'une l'autre est la façon la plus sûre de perdre du stock.

### Sécurité — point non négociable

Un site statique public expose forcément sa clé Supabase `anon`. Sans protection, n'importe qui trouvant l'URL lit et modifie le stock.

- RLS activé sur **toutes** les tables, aucune policy ouverte à `anon`.
- Authentification Supabase par **code à usage unique reçu par e-mail** (`signInWithOtp` + `verifyOtp`), sur une liste blanche d'adresses. Pas de lien magique : sur iOS, un lien ouvre toujours Safari et jamais la PWA installée sur l'écran d'accueil, ce qui casserait la session à chaque connexion. Le code supprime toute redirection.
- Les policies autorisent les utilisateurs authentifiés uniquement.
- `DELETE` refusé partout ; `UPDATE` refusé sur `mouvements`.

Tester explicitement : ouvrir l'URL en navigation privée sans se connecter doit ne rien renvoyer.

## 4. Modèle de données

```sql
references (
  code            text primary key,
  libelle         text
)

conditionnements (
  id                uuid primary key,
  ref_code          text not null,
  pieces_par_carton int  not null,
  libelle_court     text,          -- "6p/c", "12p/c"
  a_ecouler         boolean not null default false
  -- immuable : on ne modifie jamais pieces_par_carton,
  -- on crée une nouvelle ligne
)

emplacements (
  code    text primary key,   -- ZONE-BAIE-NIVEAU, ex. A-03-2
  zone    text not null,
  baie    int  not null,
  niveau  int  not null,
  ordre   int
)

mouvements (
  id                        uuid primary key,     -- généré côté client
  ts                        timestamptz not null,
  ref_code                  text not null,
  emplacement_code          text not null,
  quantite_pieces           int  not null,        -- signé : + entrée, − sortie
  motif                     text not null,        -- enum, voir §5
  commentaire               text,
  transfert_id              uuid,                 -- lie les deux lignes d'un transfert
  comptage_id               uuid,                 -- lie un ajustement à son comptage
  annule_mouvement_id       uuid,                 -- pour une annulation
  conditionnement_id        uuid not null,
  auteur                    text not null
)

comptages (
  id               uuid primary key,
  emplacement_code text not null,
  ts               timestamptz not null,
  statut           text not null   -- 'en_cours' | 'clos'
)
```

**Le stock n'est jamais une colonne.** C'est une vue : somme de `quantite_pieces` groupée par `(emplacement_code, ref_code)`. Une colonne de stock se désynchronise toujours, tôt ou tard, et rien ne permet alors de savoir laquelle des deux valeurs est la bonne.

### L'unité canonique est la pièce, mais le carton dépend du conditionnement

Tout est stocké en pièces. La saisie et l'affichage se font en cartons et pièces.

Le conditionnement n'est **pas** un attribut de la référence, parce que deux conditionnements d'une même référence coexistent physiquement jusqu'à épuisement du premier. Sans cette distinction, « 4 cartons » ne veut rien dire : quatre cartons de quoi, de 6 ou de 12 ?

- Le stock se tient donc par triplet **emplacement × référence × conditionnement**.
- Chaque mouvement porte son `conditionnement_id`.
- Une ligne de `conditionnements` est **immuable**. Un nouveau conditionnement à la livraison crée une nouvelle ligne ; on ne corrige jamais `pieces_par_carton` sur une ligne existante. C'est ce qui garantit qu'un historique reste juste sans avoir à recopier le taux sur chaque mouvement.
- Une référence a au moins un conditionnement. La grande majorité n'en aura qu'un, et l'app ne doit alors jamais poser la question.

### Écoulement de l'ancien conditionnement

Votre règle — les deux coexistent jusqu'à rupture du premier — est une règle d'écoulement, pas une règle de données. Elle se traduit par un seul drapeau :

- `a_ecouler` marque le conditionnement à vider en priorité ;
- sur une sortie, l'app propose ce conditionnement en premier et signale visiblement « à écouler » ;
- rien n'est imposé : s'il n'y en a plus à l'emplacement d'où l'on prélève, on prend l'autre ;
- quand le stock d'un conditionnement `a_ecouler` tombe à zéro partout, l'app le signale une fois. Il reste en base pour l'historique, mais disparaît des sélecteurs.

### Aucune modification, aucune suppression

Une erreur se corrige par un mouvement inverse, de motif `annulation`, portant l'`id` du mouvement annulé. L'historique conserve l'erreur et sa correction.

## 5. Motifs

Enum en base, jamais du texte libre. Un motif obligatoire à chaque mouvement.

**Le motif stocké est une clé technique, jamais un libellé traduit.** La base contient `produit_defaillant`, et l'interface affiche « Produit défaillant », 不良品 ou « Defective » selon la langue. Stocker le libellé traduit rendrait les statistiques de fin de pilote inexploitables dès qu'on change de langue.

| Clé | FR | JA | EN |
|---|---|---|---|
| `reception` | Réception | 入庫 | Receipt |
| `retour_client` | Retour client | 返品 | Customer return |
| `stock_initial` | Stock initial | 初期在庫 | Opening stock |
| `ajustement_inventaire` | Ajustement d'inventaire | 棚卸調整 | Count adjustment |
| `annulation` | Annulation | 取消 | Reversal |
| `transfert_entree` | Transfert — entrée | 移動入庫 | Transfer in |
| `commande_client` | Commande client | 出荷 | Customer order |
| `produit_defaillant` | Produit défaillant | 不良品 | Defective |
| `destruction` | Destruction | 廃棄 | Disposal |
| `transfert_sortie` | Transfert — sortie | 移動出庫 | Transfer out |

**Entrées** — `reception`, `retour_client`, `stock_initial`, `ajustement_inventaire`, `annulation`, `transfert_entree`

**Sorties** — `commande_client`, `produit_defaillant`, `destruction`, `ajustement_inventaire`, `annulation`, `transfert_sortie`

Le commentaire libre reste facultatif et sert au détail (numéro de commande, nature du défaut). Il ne remplace jamais le motif : c'est le motif qui rendra les statistiques exploitables à la fin du pilote — combien de défauts, combien de retours, combien d'écarts d'inventaire.

Un **transfert** écrit deux lignes partageant un `transfert_id` : une sortie de l'emplacement source, une entrée sur l'emplacement destination, même quantité, même horodatage.

## 6. Écrans

### 6.1 Accueil

Quatre destinations, pleine largeur, empilées : **Rechercher**, **Mouvement**, **Inventaire**, **Réglages**.

Sous les boutons : état de la file hors ligne, date du dernier export, nombre de mouvements du jour.

### 6.2 Recherche

Repris de la v1, avec les quantités ajoutées.

- Recherche par référence, filtrage incrémental sur code et libellé, sans focus automatique.
- Les résultats sont des références ; taper l'une d'elles affiche **tous ses emplacements** avec la quantité à chacun, en cartons et pièces, plus le total en pièces.
- Une référence à deux conditionnements affiche une ligne par conditionnement à chaque emplacement concerné — « 4 cartons de 12 » et « 2 cartons de 6 » restent deux lignes distinctes. Le total en pièces, lui, est unique.
- Recherche par emplacement également : même barre, le filtre tolère les tirets manquants (`a032` retrouve `A-03-2`).
- Quantité nulle sur un emplacement : afficher « vide », distinct de « non enregistré ».

### 6.3 Emplacement

Contenu de l'emplacement, et trois actions : **Entrée**, **Sortie**, **Transfert**.

Navigation par flèches entre emplacements, dans l'ordre `ordre` — zone, puis baie, puis niveau (§8). Barre d'accès avec recherche et bouton QR en haut de l'écran. Repris de la v1.

### 6.4 Mouvement

Un seul écran pour les trois sens, la différence tenant au sens et à la liste de motifs proposée.

- référence (sélecteur avec recherche) ;
- emplacement, prérempli s'il vient de l'écran Emplacement ;
- conditionnement : **masqué** si la référence n'en a qu'un, ce qui sera le cas courant. Sélecteur visible seulement si plusieurs sont actifs, celui marqué `a_ecouler` proposé en premier ;
- quantité : deux champs, **cartons** et **pièces**, chacun avec `−` / `+` et une valeur tapable ouvrant le pavé numérique. L'équivalent en pièces est affiché sous les champs, en clair, avec le taux appliqué (« 2 × 12 + 3 = 27 pièces ») ;
- motif : liste, obligatoire, sans valeur par défaut ;
- commentaire, facultatif ;
- pour un transfert : emplacement destination ;
- validation en **double appui**, comme en v1 : premier appui pour armer avec changement de couleur et de libellé, second pour écrire, retombée automatique après 3 secondes.

Une sortie qui rendrait le stock négatif est **refusée**, avec le stock disponible affiché. Pas de stock négatif silencieux : c'est le symptôme d'un mouvement manquant, et on veut le voir au moment où il se produit.

### 6.5 Inventaire

**Périmètre au lancement** : total, par client, ou sur une liste de références choisies (cas courant : répondre à un client sur quelques articles).

**Stock théorique figé au lancement.** Un `frozen_ts` est enregistré et le théorique se recalcule toujours par `ts < frozen_ts` sur `mouvements` — jamais par une copie de valeurs. Conséquence à traiter explicitement : les mouvements écrits **après** le gel sur le périmètre sont listés sur l'écran des écarts comme explication possible, sinon une expédition partie pendant le comptage apparaît comme un manquant.

**Saisie libre « en marchant »** : emplacement, référence, cartons et pièces, dans n'importe quel ordre, sans liste de casiers à cocher. Une liste construite depuis le théorique ne révélerait jamais une palette déplacée là où rien n'était attendu — c'est la raison de ce choix et elle est bonne.

**Affichage des écarts : un casier théorique jamais visité compte pour 0 et apparaît directement comme écart**, sans état intermédiaire. Décision explicite de l'utilisateur, à ne pas réintroduire : pendant la marche, un écart affiché est un signal utile — « va voir là-bas » — et attendre une couverture complète pour afficher quoi que ce soit rendait l'écran inexploitable.

**Mais la clôture, elle, doit distinguer les deux cas.** Écrire un `ajustement_inventaire` sur un casier que personne n'a visité détruit du stock réel en base sur la foi d'une absence de saisie. C'est la seule opération irréversible du module, et la seule où la nuance compte :

- avant clôture, l'app liste les casiers du périmètre sans aucune saisie et exige, pour chacun, soit une saisie, soit une confirmation explicite « vérifié, vide » ;
- cette confirmation est une saisie à zéro comme une autre, tracée dans `comptage_lignes` ;
- un compteur de couverture reste affiché pendant toute la marche — `38 casiers saisis / 12 sans saisie` — sans changer le calcul des écarts.

Autrement dit : le zéro implicite est bon pour regarder, mauvais pour signer.

**Écarts compensés** : la détection existe — écarts de somme nette nulle sur une même référence entre casiers différents, présentés comme déplacement probable. Elle est acquise et ne se refait pas.

Ce qui reste à construire est la **résolution**, à la clôture : sur une paire détectée, l'opérateur confirme le déplacement, et la clôture écrit alors **un transfert** — une sortie du casier source, une entrée sur le casier destination, même `transfert_id` — et non deux `ajustement_inventaire`. Physiquement, rien n'a disparu ni apparu : une palette a bougé. Écrire deux ajustements gonflerait artificiellement les statistiques d'écart de fin de pilote, qui sont l'indicateur du pilote. Si l'opérateur ne confirme pas, on retombe sur deux écarts ordinaires à justifier séparément.

**Correction** : une saisie se modifie ou se retire depuis l'écran des écarts, sans repasser par la saisie.

**Clôture** : un inventaire ne se clôture que lorsque chaque casier du périmètre porte une saisie — chiffrée ou confirmée vide — et que chaque écart restant est soit corrigé, soit justifié par un motif saisi. La clôture écrit alors un mouvement `ajustement_inventaire` par couple référence × conditionnement écarté, portant le `comptage_id`. Aucun écart, aucun mouvement.

**Résultat imprimable** : synthèse d'un inventaire clos — périmètre, dates, couverture, écarts avec leur justification, écart total en pièces — en page A4 via `@media print`.

Hors périmètre pour l'instant : le suivi de l'historique casier par casier au fil des inventaires.

### 6.6 Réglages

- **Langue de l'interface : français, 日本語, English.**
- Imports CSV : Références, Emplacements, Stock initial (§7).
- Ajout manuel unitaire d'une référence ou d'un emplacement.
- Exports : `.xlsx`, JSON complet (§9).
- État de la file hors ligne, avec possibilité de forcer une resynchronisation.
- Compteurs : références, emplacements, mouvements, date du dernier export.
- Numéro de version du build servi.

### 6.7 Langue de l'interface

À mettre en place **dès la première ligne d'interface**. Rapatrier des chaînes codées en dur après coup coûte dix fois plus que de partir avec un dictionnaire.

- Trois langues : `fr`, `ja`, `en`. Un fichier de dictionnaire par langue, plat, sans librairie d'i18n — quelques centaines de chaînes ne justifient pas une dépendance.
- Dictionnaire typé en TypeScript, `fr` servant de type de référence : une clé manquante dans `ja` ou `en` doit être une **erreur de compilation**, pas une chaîne vide découverte en entrepôt.
- Langue initiale déduite de `navigator.language`, repli sur `fr`. Choix explicite conservé localement, par appareil : ce n'est pas une donnée métier, elle ne va pas dans Supabase.
- Le changement de langue est immédiat, sans rechargement, et ne touche à aucune donnée.
- Dates en relatif via `Intl.RelativeTimeFormat`, nombres via `Intl.NumberFormat`, avec la locale courante. Ne pas construire « il y a 3 j » à la main.
- Attribut `lang` du document mis à jour avec la langue choisie.

**Ce qui n'est jamais traduit** : les codes de référence et d'emplacement, les libellés produits saisis par l'utilisateur, les clés de motif en base (§5), et les en-têtes des fichiers d'import/export (§9).

## 7. Imports en masse et saisie manuelle

Trois fichiers distincts, chacun son bouton. Ne pas fusionner en un seul fichier polyvalent : la validation devient floue et les erreurs silencieuses.

**Références** — `reference, libelle, pieces_par_carton`
Crée la référence et son premier conditionnement. Référence connue : le libellé est mis à jour. Si `pieces_par_carton` diffère d'un conditionnement existant, un **nouveau** conditionnement est créé et l'ancien marqué `a_ecouler` — jamais de modification de l'existant. L'aperçu d'import signale explicitement ces créations. Aucun mouvement.

**Emplacements** — `emplacement, ordre`
`ordre` facultatif. Aucun mouvement créé. Un emplacement sans stock est vide, pas inconnu.

**Stock initial** — `reference, emplacement, pieces_par_carton, cartons, pieces`
Génère un mouvement d'entrée de motif `stock_initial` par ligne. `pieces_par_carton` désigne le conditionnement concerné ; facultatif si la référence n'en a qu'un, obligatoire sinon. Refusé si le triplet référence/emplacement/conditionnement porte déjà du stock, avec la liste des lignes en conflit : le stock initial se charge une fois.

### Règles communes

- Séparateur `,` ou `;`, détecté automatiquement.
- UTF-8 et **Shift-JIS** acceptés — un export Excel japonais sort en Shift-JIS.
- Codes lus comme du texte : les zéros initiaux doivent survivre.
- Emplacements validés par `^[A-Z]{1,2}-\d{2}-\d$`.
- Prévisualisation avant écriture : lignes valides, lignes rejetées avec numéro de ligne et motif.
- **Import tout ou rien.** Aucune écriture partielle.

La saisie manuelle unitaire couvre les mêmes champs, un élément à la fois, pour les ajouts au fil de l'eau.

## 8. Emplacements

Repris de la v1, sans changement.

Code toujours `ZONE-BAIE-NIVEAU` : `A-03-2`. Zone à une lettre pour une allée, deux lettres pour une inter-allée (`AB`, `CD`). Baie sur deux chiffres. Niveau sur un chiffre, `0` au sol ; les inter-allées n'existent qu'au niveau `0`.

Ordre de tournée par défaut : zone comme texte, puis baie comme nombre, puis niveau comme nombre — on parcourt une baie de bas en haut avant d'avancer. Une colonne `ordre` à l'import impose un autre parcours sans toucher au code.

Feuille A4 de QR : une page par zone, nom de la zone en en-tête, contenu du QR en texte brut, code lisible en clair sous chaque QR.

### Saisie abrégée

Le format canonique reste le seul **stocké**. À la saisie, l'app accepte une forme abrégée sans tirets ni zéros de tête, avec une règle stricte : **le dernier chiffre tapé est toujours le niveau**, les chiffres précédents forment la baie, les lettres de tête la zone.

`a11` → `A-01-1`. `a111` → `A-11-1`. `ab110` → rejeté, une inter-allée n'existe qu'au niveau 0.

L'abréviation est une commodité d'entrée, jamais une valeur stockée ni affichée : dès la validation, le code canonique remplace la saisie à l'écran, pour que l'utilisateur voie ce qui a été compris.

## 9. Exports et sauvegarde

**`.xlsx`** généré côté client avec SheetJS — jamais un CSV, ce qui évite le piège d'encodage japonais et permet de forcer les codes en cellules texte.

**Les noms de feuilles et les en-têtes de colonnes ne sont pas traduits.** Ils restent identiques quelle que soit la langue de l'interface, faute de quoi un fichier exporté en japonais ne serait plus réimportable par une app réglée en français. Le motif, lui, est exporté sous sa clé technique.

Quatre feuilles :

- `Stock` — emplacement, zone, référence, libellé, cartons, pièces, total pièces ;
- `Mouvements` — le journal complet, brut, chronologique ;
- `References` ;
- `Emplacements`.

**JSON complet** pour restauration technique.

Supabase assure la durabilité, donc l'export n'est plus la seule barrière contre la perte. Il reste nécessaire pour deux raisons : travailler les données sur le PC, et disposer d'une copie hors de Supabase.

## 10. Hors périmètre v2

Le **client** est entré dans le périmètre depuis, mais au sens strict d'un rattachement sur la référence, servant à filtrer un périmètre d'inventaire et une recherche. Pas de séparation multi-locataire, pas de facturation, pas de policies RLS par client.

À ne pas coder, même si la structure de données le permettrait :

préparation de commande, réapprovisionnement automatique, seuils et alertes, optimisation de route de picking, étiquettes transporteur, multi-utilisateur simultané, RFID.

Les photos de référence restent facultatives ; si elles sont faites, elles passent par Supabase Storage, et non par des blobs en IndexedDB.

## 11. Critères d'acceptation

1. URL ouverte sans authentification : aucune donnée renvoyée.
2. Import Références de N lignes : références créées avec leur conditionnement, aucun mouvement.
3. Import Emplacements : emplacements présents dans la séquence des flèches et sur la feuille A4, affichés vides.
4. `AB-03-1` rejeté à l'import ; `AB-03-0` accepté.
5. Import Stock initial : un mouvement `stock_initial` par ligne, stock conforme.
6. Second import de stock initial sur les mêmes couples : rejeté, avec les lignes en conflit listées.
7. Référence à 6 pièces par carton, entrée de 2 cartons et 3 pièces : stock à 15 pièces, affiché « 2 cartons + 3 pièces », avec le calcul visible.
8. Livraison d'un second conditionnement à 12 : un nouveau conditionnement est créé, le premier est marqué à écouler, et les mouvements passés restent inchangés.
9. Référence à deux conditionnements au même emplacement : deux lignes distinctes en cartons, un total unique en pièces.
10. Référence à un seul conditionnement : aucun sélecteur de conditionnement n'apparaît sur l'écran Mouvement.
11. Sortie sur une référence à deux conditionnements : celui marqué à écouler est proposé en premier.
12. Comptage d'un casier : saisie en cartons et en pièces sur chaque ligne, sans refermer le pavé numérique entre les champs.
13. Sortie supérieure au stock : refusée, stock disponible affiché, aucun mouvement écrit.
14. Sortie sans motif : validation impossible.
15. Transfert : deux mouvements partageant un `transfert_id`, somme nulle, stock déplacé.
16. Annulation d'un mouvement : mouvement inverse créé, l'original toujours présent en base.
17. Recherche d'une référence : tous ses emplacements, quantités et total.
18. Comptage d'un casier avec un écart de −2 pièces : un seul mouvement `ajustement_inventaire` de −2, portant le `comptage_id`.
19. Comptage sans écart : aucun mouvement créé.
20. Comptage interrompu puis repris : la liste des emplacements restants est correcte.
21. Mode avion, deux mouvements saisis : bandeau « 2 en attente » ; réseau rétabli : les deux remontent, une seule fois chacun.
22. Même mouvement rejoué deux fois : un seul enregistrement en base.
23. Aucune requête `UPDATE` ni `DELETE` sur `mouvements` n'aboutit, même émise directement.
24. Export `.xlsx` : codes à zéro initial intacts, feuille `Stock` cohérente avec l'app.
25. Interface basculée en 日本語 : tous les libellés changent, aucune donnée modifiée, aucun rechargement.
26. Mouvement enregistré en japonais puis relu en français : le motif s'affiche traduit, la valeur en base reste la clé technique.
27. Export `.xlsx` fait en japonais : en-têtes et noms de feuilles identiques à ceux d'un export fait en français, et réimportable tel quel.
28. Une clé absente du dictionnaire `ja` ou `en` fait échouer la compilation.
29. Casier du périmètre sans aucune saisie : compté pour 0 dans les écarts, et signalé dans le compteur de couverture.
30. Clôture demandée alors qu'un casier du périmètre n'a aucune saisie : refusée, avec la liste des casiers concernés et l'option « vérifié, vide ».
31. Casier confirmé vide : une ligne de comptage à zéro existe, et la clôture devient possible.
32. Écart restant sans justification ni correction : clôture impossible.
33. Mouvement écrit après le gel sur le périmètre : listé sur l'écran des écarts comme explication possible.
34. `−10` sur `A-02-1` et `+10` sur `A-05-1` pour la même référence : présenté comme un déplacement probable, pas comme deux écarts.
35. Déplacement probable confirmé par l'opérateur à la clôture : un transfert est écrit — deux mouvements, même `transfert_id`, somme nulle — et aucun `ajustement_inventaire`.
36. Déplacement probable non confirmé : deux écarts ordinaires, à justifier séparément.
35. `a11` saisi : interprété en `A-01-1`, et le code canonique s'affiche après validation.

## 12. Ordre de livraison

Fait : socle Vite/PWA, traduction typée, schéma Supabase et RLS, authentification par code, écrans Mouvement, Inventaire (saisie libre, écarts, détection de déplacement probable), Recherche, Réglages.

### Le 18 septembre — démarrage avec l'app en l'état

**Aucune fonctionnalité n'est bloquante pour le démarrage.** Le stock d'ouverture des zones A, B et C se saisit à la main, en mouvements de motif `stock_initial` depuis l'écran Mouvement : sur le périmètre REUZEL, c'est l'affaire d'une session, et cette saisie est de toute façon le premier comptage physique. Construire un import en masse en trois jours, sur la fonction qui touche le plus directement à l'intégrité du stock, serait le mauvais arbitrage.

Deux choses seulement, et ce ne sont pas des chantiers :

1. **Vérifier qu'un échec d'écriture est visible.** Une erreur réseau avalée en silence, sur un mouvement que l'utilisateur croit enregistré, est le seul défaut capable de fausser l'indicateur du pilote sans laisser de trace.
2. **Écrire la consigne de repli** dans le README : si l'enregistrement échoue, noter sur papier et ressaisir au retour.

### Jusqu'au 18 octobre — point de situation

Ordre dicté par l'indicateur du pilote, l'écart entre l'app et le physique :

1. Automatisation du changelog — chantier isolé, sans dépendance, à sortir du chemin d'abord.
2. **File hors ligne** et bandeau « n en attente ». C'est ce qui protège l'indicateur : un mouvement perdu le corrompt directement.
3. **Clôture d'inventaire** : couverture dédiée à la clôture, justification des écarts, écriture des `ajustement_inventaire`.
4. **Mouvements postérieurs au gel** listés sur l'écran des écarts — à coupler au point 3, c'est la même conversation.
5. **Résolution des écarts compensés** en transfert (§6.5) — également couplée au point 3.
6. **Export `.xlsx`** : l'instrument de comparaison avec l'Excel tenu en parallèle, donc de mesure de l'indicateur.
7. Synthèse imprimable.

### Repoussé

**Imports en masse.** Avec le stock d'ouverture saisi à la main sur le périmètre du pilote, c'est une fonction de passage à l'échelle et non de démarrage. Elle revient si le pilote s'étend au-delà de REUZEL et des zones A, B et C.

Feuille A4 de QR, scan, export JSON complet, photos.

Rien hors de ces listes n'entre avant le 18 octobre, y compris si ça paraît utile.

## 13. Déploiement — GitHub Pages

L'app s'appelle **どこどこ**. Dépôt public `dokodoko` — le nom du dépôt reste en ASCII pour que l'URL soit propre et tapable ; seul l'affichage est en japonais.

```json
{
  "name": "どこどこ",
  "short_name": "どこどこ",
  "start_url": "/dokodoko/",
  "scope": "/dokodoko/",
  "display": "standalone",
  "orientation": "portrait",
  "lang": "ja"
}
```

- Icônes 192 et 512 px dans le manifeste, plus une `apple-touch-icon` de 180 px déclarée en `<link>` : iOS ignore encore les icônes du manifeste dans certains cas.
- `short_name` à quatre caractères : aucun risque de troncature sous l'icône.
- Pile de polices incluant une police japonaise du système (`-apple-system`, `"Hiragino Sans"`) pour les libellés en japonais.
- Site servi sous `https://<compte>.github.io/dokodoko/` : `base: '/dokodoko/'` dans `vite.config.ts`, aucun chemin absolu, `start_url` et `scope` du manifeste réglés sur ce sous-chemin, service worker enregistré avec le même scope, fichier `.nojekyll`.
- Secrets : la clé `anon` de Supabase est publique par nature et peut figurer dans le build. **La clé `service_role` ne doit jamais s'y trouver.** Le seul rempart est le RLS (§3).
- Nom de cache du service worker incluant la version du build, anciens caches supprimés à l'`activate`, invite explicite « Nouvelle version disponible — recharger » plutôt qu'un rechargement silencieux en pleine tournée.
- Publication par GitHub Actions sur `main`, source de déploiement réglée sur GitHub Actions dans les paramètres du dépôt.
- Ne plus changer l'origine : renommer le dépôt ou passer sur un domaine personnalisé casse l'installation sur l'écran d'accueil et vide le cache local. Les données, elles, sont chez Supabase — c'est le gain de l'architecture v2.
- Ne jamais committer un export, un CSV de stock ou une capture contenant des références clients : `*.csv`, `*.xlsx`, `*.json` d'export et tout dossier `data/` dans `.gitignore` dès le premier commit.
