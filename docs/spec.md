# どこどこ — Spec v2 : pilote de suivi de stock

> **Référence de périmètre du dépôt.** Emplacement : `docs/spec.md`. Version 2.7 — 15 septembre 2026.
>
> Ce document dit ce qui est dans le périmètre et ce qui n'y est pas. Le `README.md` dit où on en est, le `CLAUDE.md` dit comment travailler.
>
> Une fonctionnalité absente d'ici ne s'implémente pas : elle se propose, elle s'inscrit ici, puis elle s'implémente. Un écart assumé se répercute dans ce fichier **au même commit**, avec sa raison en une phrase. En cas de contradiction entre ce document et une instruction donnée en session, le signaler et demander l'arbitrage plutôt que de trancher seul.

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

### File hors ligne

Écritures uniquement — jamais les lectures. Règles non négociables, parce qu'une file mal faite corrompt le stock plus sûrement qu'une absence de file.

**Tout est daté et identifié au moment du geste, jamais au moment de l'écriture.** Chaque opération mise en file porte un `id` UUID et un `ts` générés côté client, à la saisie. Aucun `default now()` du serveur ne doit intervenir sur une écriture rejouable.

- Pour `mouvements`, c'est déjà le cas.
- Pour `comptage_lignes`, `id` et `ts` doivent être fournis par le client. `id` existe déjà en base avec un défaut : **aucune migration n'est nécessaire**, il suffit de le renseigner et de passer en `upsert(ignoreDuplicates)`. Le défaut reste comme filet.
- `ts` est le point critique : la correction d'une saisie fonctionne en *latest-wins*. Une insertion rejouée qui prendrait l'heure du vidage de file pourrait battre une correction plus récente et ressusciter la valeur erronée.

**Contrepartie assumée : l'ordre dépend de l'horloge du téléphone.** Un appareil mal réglé peut dater une correction avant l'original qu'elle corrige, et casser le *latest-wins* par l'autre bout. Accepté pour un pilote mono-opérateur avec l'heure réseau active. Deux précisions :

- Le tri secondaire sur `id` donne du **déterminisme, pas de la justesse** : un UUID v4 n'a pas d'ordre signifiant, il évite seulement un résultat qui change d'un appel à l'autre. Ne pas le lire comme un correctif.
- Mitigation immédiate et sans DDL : au démarrage, comparer l'horloge de l'appareil à celle du serveur et avertir au-delà de quelques minutes de dérive. Le cas réaliste est un téléphone à la mauvaise date, pas un décalage de trois secondes.
- Correctif réel, à embarquer dans la migration du chantier de clôture : un **compteur monotone par appareil**, capturé au geste et persisté localement, utilisé comme clé d'ordre. Monotone quoi qu'il arrive à l'horloge, et immunisé au rejeu puisqu'il est pris à la saisie. `ts` reste l'heure du geste, pour l'affichage et la comparaison au gel.

**La création d'un casier est hors file en v1.** `getOrCreateCasier` reste synchrone : hors réseau, toucher un casier jamais visité échoue immédiatement. Conséquence à connaître avant de valider : dans un inventaire neuf, **tous** les casiers sont neufs, donc un inventaire hors ligne ne fonctionne pas du tout — ce n'est pas un cas limite. Acceptable seulement si la couverture réseau en allée est bonne, ce qui se vérifie en dix minutes avec le téléphone, pas en raisonnant.

Si des zones mortes existent, le correctif ne passe pas par l'index unique et ne demande aucun DDL : **dériver `comptages.id` de façon déterministe** à partir de `(inventaire_id, emplacement_code)` — un UUID v5, ou tout hachage stable. Le même casier produit toujours le même identifiant, donc `upsert(ignoreDuplicates)` sur la clé primaire déduplique par construction, y compris au rejeu, et la création entre dans la file comme le reste.

**File strictement ordonnée, vidée en FIFO.** Et lorsqu'une insertion et une suppression de la même ligne sont toutes deux en attente, les deux s'annulent et disparaissent de la file. Sans cette règle, une ligne supprimée par l'utilisateur réapparaît au rejeu de son insertion.

**Un rejet métier n'entre jamais en file.** Stock insuffisant, refus de policy, violation de contrainte : ce sont des réponses structurées du serveur, elles s'affichent immédiatement comme aujourd'hui. Seul l'échec réseau brut est mis en file. Le critère est la forme de l'erreur, pas son code.

**Un rejet survenant au vidage de la file ne disparaît jamais.** Une sortie mise en file hors ligne peut être refusée une heure plus tard, alors que la marchandise est physiquement partie. Ces opérations vont dans une liste « en échec », persistante et visible, avec le motif renvoyé par le serveur. Jamais rejouées indéfiniment, jamais écartées en silence, résolues à la main par l'utilisateur.

**Le bandeau affiche le nombre et l'âge.** « 3 en attente depuis 2 h » est actionnable ; « 3 en attente » devient du décor en deux jours.

**L'écran des écarts doit dire quand la file n'est pas vide.** Un écart calculé alors que des lignes de comptage n'ont pas atteint la base est faux, et c'est l'indicateur du pilote.

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
- `UPDATE` et `DELETE` refusés sur `mouvements`, sans exception ni condition.
- Sur `comptage_lignes` : `DELETE` **autorisé tant que l'inventaire n'est pas clôturé**, refusé après. Un inventaire en cours est un brouillon, et une ligne mal tapée n'est pas un fait sur le stock ; une fois clôturé, les lignes sont la pièce justificative des `ajustement_inventaire` écrits en base, et elles deviennent intouchables.
- **Cette policy ne s'écrit pas avant le chantier de clôture.** L'état auquel elle doit se référer est celui de l'inventaire, et il n'existe pas encore : `comptages.statut` désigne aujourd'hui « ce casier a été touché » et passe à `clos` dès la première saisie (§14). Une policy branchée dessus casserait l'annulation d'une saisie dans la minute.

Tester explicitement : ouvrir l'URL en navigation privée sans se connecter doit ne rien renvoyer.

## 4. Modèle de données

```sql
clients (
  code text primary key,
  nom  text not null
)

references (
  code        text primary key,
  libelle     text,
  client_code text not null references clients(code)
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
  id                   uuid primary key,     -- généré côté client
  ts                   timestamptz not null,
  ref_code             text not null,
  emplacement_code     text not null,
  quantite_pieces      int  not null,        -- signé : + entrée, − sortie
  motif                text not null,        -- enum, voir §5
  commentaire          text,
  transfert_id         uuid,                 -- lie les deux lignes d'un transfert
  comptage_id          uuid,                 -- lie un ajustement à son comptage
  annule_mouvement_id  uuid,                 -- pour une annulation
  conditionnement_id   uuid not null,
  auteur               text not null
)

inventaires (                                -- porte le périmètre et le gel
  id                uuid primary key,
  scope_kind        text not null check (scope_kind in ('tout','client','references')),
  scope_client_code text references clients(code),
  frozen_ts         timestamptz not null default now(),
  statut            text not null default 'en_cours'
                    check (statut in ('en_cours','clos')),
  auteur            text not null,
  created_at        timestamptz not null default now(),
  constraint scope_client_coherent check (
    (scope_kind =  'client' and scope_client_code is not null) or
    (scope_kind <> 'client' and scope_client_code is null)
  )
)
-- index unique partiel one_inventaire_en_cours (where statut = 'en_cours')

inventaire_references (                      -- périmètre « des références »
  inventaire_id uuid not null references inventaires(id),
  ref_code      text not null references "references"(code),
  primary key (inventaire_id, ref_code)
)

comptages (                                  -- un casier dans un inventaire
  id               uuid primary key,
  emplacement_code text not null references emplacements(code),
  ts               timestamptz not null,
  statut           text not null check (statut in ('en_cours','clos')),
  inventaire_id    uuid references inventaires(id)
)

comptage_lignes (                            -- journal des saisies
  id                 uuid primary key,
  comptage_id        uuid not null references comptages(id),
  ref_code           text not null references "references"(code),
  conditionnement_id uuid not null references conditionnements(id),
  cartons            int  not null check (cartons >= 0),
  pieces             int  not null check (pieces  >= 0),
  ts                 timestamptz not null default now(),
  auteur             text not null
)
```

Ce bloc reflète le schéma réellement appliqué en base au 15 septembre 2026.

**`comptage_lignes` stocke ce qui a été compté, pas son équivalent en pièces** — cartons, pièces et conditionnement séparément. C'est volontaire et il ne faut pas le « normaliser » plus tard : le grand livre stocke des pièces parce qu'il fait de l'arithmétique, le comptage stocke le geste humain parce qu'il sert de preuve. La conversion se dérive, l'inverse non.

`references.client_code` étant `not null`, tout stock appartient à un client ; du stock propre demanderait un pseudo-client dédié.

Un seul inventaire peut être `en_cours`, contrainte appliquée en base. Limite connue et acceptée pour le pilote : un comptage ponctuel sur trois références pour répondre à un client est impossible pendant un inventaire complet. À rouvrir seulement si le cas se présente réellement.

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

Une erreur se corrige par un mouvement inverse, de motif `annulation`, portant l'`id` du mouvement annulé dans `annule_mouvement_id`. L'historique conserve l'erreur et sa correction.

État réel : la colonne existe, mais le lien n'est pas posé — `annulation` est un motif ordinaire choisi à la main, sans écran d'historique depuis lequel annuler un mouvement précis. Dette assumée (§14). En attendant, **le commentaire est obligatoire quand le motif est `annulation`** : à défaut d'un lien machine, une trace lisible.

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

**Sélecteur de langue** — français, 日本語, English — sur cet écran plutôt que dans les Réglages : un testeur terrain qui change de langue ne doit pas avoir à la chercher.

Sous les boutons : état de la file hors ligne, date du dernier export, nombre de mouvements du jour. **Ces indicateurs n'affichent rien tant qu'ils ne sont pas branchés sur une vraie donnée** — jamais de texte fixe rassurant. Un « Tout est synchronisé » codé en dur est un mensonge en attente : il est vrai aujourd'hui parce qu'il n'y a pas encore de file, et il deviendra faux sans que personne s'en aperçoive.

### 6.2 Recherche

Repris de la v1, avec les quantités ajoutées.

- Recherche par référence, filtrage incrémental sur code et libellé, sans focus automatique.
- Les résultats sont des références ; taper l'une d'elles affiche **tous ses emplacements** avec la quantité à chacun, en cartons et pièces, plus le total en pièces.
- Une référence à deux conditionnements affiche une ligne par conditionnement à chaque emplacement concerné — « 4 cartons de 12 » et « 2 cartons de 6 » restent deux lignes distinctes. Le total en pièces, lui, est unique.
- Recherche par emplacement également, via **deux boutons de mode explicites** — par référence / par emplacement. C'est plus clair qu'une barre unique qui devine : `A11` peut être un code de casier comme un fragment de référence, et une heuristique qui se trompe une fois sur dix est pire qu'un bouton.
- Le filtre tolère les tirets manquants (`a032` retrouve `A-03-2`).
- Quantité nulle sur un emplacement : afficher **« vide »**, distinct de « non enregistré ». Aujourd'hui les lignes à zéro sont filtrées et disparaissent, ce qui rend les deux cas indistinguables ; à traiter avec le chantier de clôture, qui introduit la même notion de casier confirmé vide.

### 6.3 Emplacement — retiré du périmètre

Cet écran, hérité de la v1 (fiche par casier, navigation par flèches, bouton QR), **ne sera pas construit**. La consultation d'un casier est couverte par la Recherche par emplacement, et l'action par l'écran Mouvement. La navigation par flèches servait la tournée de vérification guidée de la v1, que la saisie libre en marchant a remplacée.

Conservé ici comme décision, pour qu'il ne soit pas réintroduit à la lecture de la v1.

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

**Première étape du chantier de clôture — une seule migration, quatre corrections de schéma :**

1. **`comptages.inventaire_id` passe en `not null`.** Aujourd'hui nullable, donc un comptage peut exister sans appartenir à aucun inventaire : ses lignes n'apparaissent alors dans le calcul d'écart d'aucun inventaire. Un trou silencieux, exactement dans le module qui produit l'indicateur du pilote. Vérifier d'abord s'il existe des lignes à `null` héritées de l'avant-refonte, et les rattacher ou les supprimer.
2. **Index unique sur `(inventaire_id, emplacement_code)`.** Sans lui, `getOrCreateCasier` peut créer deux comptages pour le même casier dans le même inventaire : les lignes se répartissent entre les deux et l'écart est faux. À vérifier dès maintenant en lecture seule — si des doublons existent déjà, ce n'est plus une précaution mais un bug à traiter.
3. **Suppression de `comptages.attendu_consulte`**, lue mais jamais écrite.
4. **Découpler les deux notions qui partagent `comptages.statut`.**

- « ce casier a été touché » — sert à l'affichage des écarts. Devient un horodatage, `visite_ts`, et non un statut : un horodatage ne peut pas se relire comme une clôture.
- « cet inventaire est clôturé » — c'est `inventaires.statut`, qui existe déjà et n'a besoin de rien. C'est ce que la policy `DELETE` (§3) interroge, en remontant `comptage_lignes → comptages → inventaires` — ce qui suppose le point 1 ci-dessus.

La synthèse des écarts se base alors sur la présence d'au moins une ligne de comptage, et non sur un statut. Ce découplage se fait **au début du chantier**, avant la clôture elle-même : le reste du chantier repose dessus.

**Clôture** : un inventaire ne se clôture que lorsque chaque casier du périmètre porte une saisie — chiffrée ou confirmée vide — et que chaque écart restant est soit corrigé, soit justifié par un motif saisi. La clôture écrit alors un mouvement `ajustement_inventaire` par couple référence × conditionnement écarté, portant le `comptage_id`. Aucun écart, aucun mouvement.

**Résultat imprimable** : synthèse d'un inventaire clos — périmètre, dates, couverture, écarts avec leur justification, écart total en pièces — en page A4 via `@media print`.

Hors périmètre pour l'instant : le suivi de l'historique casier par casier au fil des inventaires.

### 6.6 Réglages

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
- Nombres via `Intl.NumberFormat` avec la locale courante.
- **Dates affichées en absolu** (`14/09 10:32`), pas en relatif. Le relatif venait de la carte v1, où « vu ce matin » était l'information utile ; sur un journal de mouvements, une heure précise vaut mieux qu'un « il y a 3 jours ». Les helpers de format relatif existants restent inutilisés — à supprimer plutôt qu'à garder en réserve.
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

`a11` → `A-01-1`. `a111` → `A-11-1`. `ab110` → `AB-11-0`. `ab11` → rejeté, car cela donnerait `AB-01-1` et une inter-allée n'existe qu'au niveau 0.

La règle s'applique aussi aux zones à deux lettres : c'est l'algorithme qui décide, pas la longueur de la zone. Le rejet ne vient jamais de l'abréviation elle-même, toujours de la contrainte de niveau sur les inter-allées.

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
34. Même ligne de comptage rejouée deux fois : un seul enregistrement, et son `ts` est celui de la saisie, pas du vidage.
35. Ligne saisie puis corrigée hors ligne, les deux en file : après vidage, c'est la correction qui prévaut.
36. Ligne saisie puis supprimée avant vidage : rien n'atteint la base.
37. `−10` sur `A-02-1` et `+10` sur `A-05-1` pour la même référence : présenté comme un déplacement probable, pas comme deux écarts.
38. Déplacement probable confirmé par l'opérateur à la clôture : un transfert est écrit — deux mouvements, même `transfert_id`, somme nulle — et aucun `ajustement_inventaire`.
39. Déplacement probable non confirmé : deux écarts ordinaires, à justifier séparément.
40. `a11` saisi : interprété en `A-01-1`, et le code canonique s'affiche après validation.

## 12. Ordre de livraison

Fait : socle Vite/PWA, traduction typée, schéma Supabase et RLS, authentification par code, écrans Mouvement, Inventaire (saisie libre, écarts, détection de déplacement probable), Recherche, Réglages.

### Le 18 septembre — démarrage avec l'app en l'état

**Aucune fonctionnalité n'est bloquante pour le démarrage.** Le stock d'ouverture des zones A, B et C se saisit à la main, en mouvements de motif `stock_initial` depuis l'écran Mouvement : sur le périmètre REUZEL, c'est l'affaire d'une session, et cette saisie est de toute façon le premier comptage physique. Construire un import en masse en trois jours, sur la fonction qui touche le plus directement à l'intégrité du stock, serait le mauvais arbitrage.

Deux choses seulement, et ce ne sont pas des chantiers :

1. **Vérifier qu'un échec d'écriture est visible.** Une erreur réseau avalée en silence, sur un mouvement que l'utilisateur croit enregistré, est le seul défaut capable de fausser l'indicateur du pilote sans laisser de trace.
2. **Écrire la consigne de repli** dans le README : si l'enregistrement échoue, noter sur papier et ressaisir au retour.
3. **Retirer les deux indicateurs factices de l'Accueil.** C'est une suppression, pas une fonctionnalité : « Tout est synchronisé » en texte fixe est précisément ce qu'on regardera sans réfléchir pendant le pilote. Ils reviendront branchés avec la file hors ligne.
4. **Rendre le commentaire obligatoire sur le motif `annulation`** (§4), si c'est l'affaire de quelques minutes. Sinon, avec le chantier de clôture.

### Jusqu'au 18 octobre — point de situation

Ordre dicté par l'indicateur du pilote, l'écart entre l'app et le physique :

1. Automatisation du changelog — chantier isolé, sans dépendance, à sortir du chemin d'abord.
2. **File hors ligne** et bandeau « n en attente ». C'est ce qui protège l'indicateur : un mouvement perdu le corrompt directement.
3. **Clôture d'inventaire**, dans cet ordre interne : découplage de `comptages.statut` (§6.5) d'abord, puis policy `DELETE` conditionnée (§3), puis couverture, justification des écarts, écriture des `ajustement_inventaire`. Y rattacher l'affichage « vide » face à « non enregistré » dans la Recherche (§6.2) : c'est la même notion de casier confirmé vide.
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

## 14. Dettes assumées

Écarts connus entre cette spec et le code, acceptés en l'état pour la durée du pilote. Ce sont des décisions, pas des oublis : elles n'entrent dans une liste de livraison que si quelqu'un les y met explicitement.

- **`annule_mouvement_id` jamais posé.** `annulation` reste un motif choisi à la main, sans écran d'historique depuis lequel annuler un mouvement précis. Conséquence : les paires annulation/annulé ne sont pas reconstituables automatiquement, et les statistiques de fin de pilote comptent les annulations comme des mouvements ordinaires. Atténué par le commentaire obligatoire (§4). Se referme le jour où un écran d'historique des mouvements existe — qui n'est pas au programme.
- **Helpers de format relatif non utilisés.** À supprimer, pas à câbler (§6.7).
- **Suivi de l'historique casier par casier entre inventaires** : hors périmètre (§6.5).

- **`comptages.inventaire_id` nullable.** Un comptage orphelin est invisible de tous les inventaires, donc ses lignes ne comptent dans aucun écart. Coût : un trou silencieux dans le calcul de l'indicateur du pilote. Se referme à la migration du chantier de clôture (§6.5).
- **Pas de contrainte d'unicité sur `(inventaire_id, emplacement_code)`.** Coût : deux comptages possibles pour un même casier, lignes réparties entre les deux, écart faux. Vérification en lecture seule à faire tout de suite ; correction à la même migration.
- **Ordre des lignes de comptage dépendant de l'horloge du téléphone** (§3). Coût : sur un appareil à la mauvaise date, une correction peut être datée avant l'original et le *latest-wins* retenir la mauvaise valeur. Atténué par l'avertissement de dérive au démarrage. Se referme avec le compteur monotone par appareil, à la migration du chantier de clôture.
- **Création de casier hors file** (§3). Coût : un inventaire neuf est impossible hors réseau, puisque tous ses casiers sont neufs. Acceptable uniquement si la couverture en allée est vérifiée bonne. Correctif sans DDL disponible si elle ne l'est pas : identifiant de casier déterministe.
- **`comptages.statut` surchargé.** Il signifie « ce casier a été touché » et passe à `clos` dès la première saisie, alors que son nom laisse lire « inventaire clôturé ». Coût immédiat : nul, le code est cohérent avec lui-même. Coût réel : il bloque la policy `DELETE` conditionnée, et il fera lire `clos` pour une clôture à quiconque arrive sur le code sans contexte. Se referme au début du chantier de clôture (§6.5), pas avant — un refactor de `markCasierVisite` et de la boucle de fusion de `getInventaireSynthese`, sur le module que `CLAUDE.md` signale pour ses bugs subtils, n'apporte rien au démarrage du pilote.

Toute dette ajoutée ici doit dire ce qu'elle coûte, pas seulement ce qui manque.

## 15. Mode opératoire — découpage de la spec

### Structure cible

```
docs/
  spec.md                      ← invariants + index, toujours chargé
  spec/01-cadre.md             ← pilote, périmètre, indicateur
  spec/02-architecture.md      ← hébergement, sécurité, file hors ligne
  spec/03-modele.md            ← schéma, unités, conditionnements, motifs
  spec/04-ecrans.md            ← accueil, recherche, mouvement, inventaire, réglages, langue
  spec/05-imports-exports.md
  spec/06-emplacements.md      ← codes, tri, saisie abrégée, feuille A4
  spec/07-livraison.md         ← calendrier, hors périmètre, dettes assumées
```

`docs/spec.md` ne garde que ce qui s'applique à **toutes** les sessions : la règle d'autorité, les invariants de modèle, la liste de priorités en cours, et la carte indiquant quel module couvre quoi. Une page, pas plus.

### Règles du découpage

- **Une règle vit dans un seul fichier.** Aucune duplication entre modules ; on renvoie au module par son nom. La duplication est exactement la façon dont deux specs commencent à se contredire.
- **Les critères d'acceptation migrent auprès de la règle qu'ils testent**, dans leur module. C'est le vrai gain : la liste globale actuelle oblige à tout charger pour vérifier un seul point.
- **Chaque module porte sa propre version et sa date** en en-tête.
- **Un module est lu en entier ou pas du tout.** Si un module devient trop gros pour ça, il se scinde — mais c'est une décision d'architecture, pas de session.

### Règles de session

- Au démarrage d'une session : lire `docs/spec.md`, plus le ou les modules que la liste de priorités associe au chantier en cours. Rien d'autre.
- Un écart assumé se répercute **dans le module concerné, au même commit**, avec sa raison en une phrase et un incrément de la version du module.
- **Claude Code modifie le contenu d'un module, jamais la répartition entre modules.** Déplacer une règle d'un fichier à l'autre est une opération d'architecture : sinon la carte pourrit et plus personne ne sait où chercher.

### Quand

Au **changement de chantier**, jamais au milieu. Découper pendant que la file hors ligne est en cours ferait bouger ses règles de fichier sous elle. Le découpage se fait donc entre la fin de la file hors ligne et le début du chantier de clôture — qui est le plus gros des deux et celui qui en profitera le plus.

### Ce que ça économise, et ce que ça n'économise pas

Ce document pèse quelques milliers de tokens : ce n'est pas lui qui remplit une session. Le contexte part dans la lecture des sources, les sorties de build et les transcriptions d'outils. Le découpage se justifie par la **focalisation** — une session qui travaille sur la file hors ligne n'a pas les règles de clôture sous les yeux, donc moins d'occasions de pas de côté — et par la propreté des diffs. Pas par le budget de tokens.
