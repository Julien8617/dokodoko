# どこどこ — Spec v2 : pilote de suivi de stock

> **Référence de périmètre du dépôt.** Emplacement : `docs/spec.md`. Version 2.64 — 24 septembre 2026.
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

### Deux phases, deux indicateurs — révision du 18 septembre

Le stock d'ouverture ne sera pas amorcé avant fin octobre, au retour d'un déplacement professionnel. Jusque-là l'app reste un **outil de comptage** et ne détient aucun stock. Le pilote se scinde donc en deux, et confondre les deux phases reviendrait à prétendre mesurer ce qui n'a pas été mesuré.

**Phase 1 — l'app comme outil de comptage.** Du 18 septembre à fin octobre. Aucun stock en base, aucun mouvement enregistré, comparaison avec l'Excel faite à la main. Ce qui s'y mesure :

- le comptage hebdomadaire du vendredi est-il plus rapide et plus sûr qu'avant ;
- ce que la comparaison comptage/Excel révèle, semaine après semaine, sur la fiabilité du processus existant — premier point le 18 septembre : une boîte d'écart sur une référence.

C'est une phase valable en soi : elle éprouve l'ergonomie de comptage sans exposer la moindre donnée de stock. Le point du 16 octobre porte sur **elle**, et sur une décision explicite d'aller ou non en phase 2.

**Phase 2 — l'app comme système de stock.** Démarre à l'amorçage, fin octobre au plus tôt. C'est seulement là que l'indicateur historique du pilote — l'écart entre l'app et le comptage physique — devient mesurable, et son point de situation se fixe à un mois après l'amorçage, pas au 16 octobre.

La durée de six mois court sur la phase 2 : c'est elle qui engage le stock des clients.

**Conséquence pendant l'absence.** L'app ne sera pas utilisée pendant le déplacement, et le collègue ne sera pas formé d'ici là. Un projet Supabase en plan gratuit se met en pause après sept jours sans activité — donc si le déplacement dépasse une semaine, l'app sera en pause au retour. Les données survivent et le projet se relance d'un bouton depuis le tableau de bord, mais il faut le savoir avant de partir plutôt que de le découvrir au retour.

## 3. Architecture

**Décision : Supabase est la source de vérité. Le front est un site statique sur GitHub Pages. Railway est inutile ici** — il n'y a pas de backend à héberger, Supabase fournit Postgres, l'API et l'authentification.

- Front : React + TypeScript + Vite, PWA installée sur l'écran d'accueil de l'iPhone.
- Lectures : cache local (IndexedDB) rafraîchi à l'ouverture et après chaque écriture, pour que la consultation reste instantanée dans les allées.
- Écritures : envoyées à Supabase ; en cas d'échec réseau, mises en file dans IndexedDB et rejouées automatiquement. L'`id` UUID généré côté client rend le rejeu idempotent — c'est ce qui permet de rejouer sans jamais compter deux fois.
**Ne jamais tester `err instanceof Error` sur un retour Supabase.** Le client renvoie `{data, error}` avec un objet brut, pas une instance d'`Error` : le test est donc faux pour la quasi-totalité des échecs, et le repli affiche l'objet. Une **fonction unique d'extraction du message**, appelée partout, avec un repli explicite quand il n'y a pas de message. Cause réelle du `(objet Objet)`, trouvée le 17 septembre à dix-huit endroits dans cinq fichiers.

**Un chemin d'erreur ne se vérifie pas en lisant le code, il se vérifie en provoquant la panne.** L'audit du 15 septembre a lu les chemins qu'il connaissait et conclu que tout remontait ; le terrain a trouvé un message illisible partout, un `catch` absent sur le lancement d'inventaire, et un chargement sans fin sur l'écran des écarts. Trois défauts invisibles à la relecture. Tout audit de ce type se fait désormais en coupant le réseau et en cassant volontairement une entrée.

**Tout échec s'affiche en clair.** L'audit du 15 septembre a vérifié que les erreurs remontent ; il n'a pas vérifié qu'elles sont **lisibles**. Un `(objet Objet)` est visible et inutilisable : il ne dit ni la cause ni la marche à suivre, et il masque le vrai message. Toute erreur affichée passe par l'extraction de son message, avec un repli explicite quand il n'y en a pas — jamais l'objet lui-même. Un écran qui refuse d'avancer sans rien dire, comme le lancement d'inventaire hors réseau, relève du même défaut.

- L'état de la file hors ligne est **visible en permanence** : un bandeau « 3 mouvements en attente » tant que la file n'est pas vide. Un mouvement non remonté qu'on croit enregistré est le pire défaut possible pour ce genre d'outil.

### Résultat du test de couverture — 17 septembre

**La 4G passe dans tout le bâtiment.** Aucune zone morte sur les allées A, B et C. Trois conséquences.

La **file d'écriture** descend loin dans le calendrier : elle protège contre un risque qui ne se manifeste pas. Elle n'est pas abandonnée — la mesure vaut pour un jour, un état des rideaux, une charge du réseau donnés — mais elle passe après le chantier de clôture.

Ce qui la remplace dans l'immédiat : un **message d'erreur lisible et une ressaisie possible**. Sur une coupure passagère, retaper un mouvement à ce volume est acceptable ; sur un message illisible, non.

La **création de casier reste hors file** sans discussion, et la piste de l'identifiant déterministe pour `comptages.id` devient sans objet.

### Cache de lecture — prérequis de tout le reste

Constat de terrain : hors réseau, l'app perd l'accès aux références et aux emplacements, donc **on ne peut rien saisir du tout**. Une file d'écriture sans cache de lecture ne sert à rien : il n'y a rien à mettre dedans.

Le cache passe donc **avant** la file, et les deux forment un seul chantier.

Ce qui se met en cache, et c'est petit — quelques centaines de kilo-octets en tout :

- les référentiels : `references`, `emplacements`, `conditionnements`, `clients`. « Et les familles » figurait ici par erreur de rédaction : `familles_melange` appartient à la carte thermique post-pilote et n'existe pas en base ;
- un **instantané du stock** par emplacement × référence × conditionnement — quelques centaines de lignes — et non le journal des mouvements, qui n'a pas à descendre sur le téléphone.

Rafraîchi à l'ouverture de l'app, après chaque écriture réussie, et au retour du réseau. **Toute modification de la forme ou du sens des données mises en cache change la clé du cache.** Sans quoi une copie locale ressert en silence l'ancienne sémantique jusqu'au prochain réseau — et le défaut sera imputé au code qui lit, pas au cache qui mentait.

**L'âge du cache est affiché** au même titre que celui de la file : « référentiel à jour il y a 2 h ». Un cache silencieusement périmé est le même piège qu'un « tout est synchronisé » codé en dur.

**Le cache ne sert que la consultation.** La vérification de stock qui conditionne une sortie reste une lecture réseau et n'est jamais branchée sur le cache : refuser sur une donnée périmée serait pire que refuser sur une donnée fraîche, puisque l'app interdirait une sortie que le serveur aurait acceptée. Cette règle vaut indépendamment du calendrier — elle tiendrait même si la fin du blocage était déjà codée.

L'instantané de stock est donc **informatif**, pour la Recherche. Il est forcément décalé hors ligne, et c'est sans gravité tant qu'il ne fonde aucun refus.

**Conséquence de séquencement, à ne pas manquer : la file d'écriture ne peut pas fonctionner tant que la vérification de stock est un verrou réseau.** Hors réseau, une sortie échoue à la vérification avant même d'atteindre l'écriture, donc il n'y a rien à mettre en file. La fin du blocage (§4) passe ainsi **avant** la file, et non après comme le calendrier le prévoyait initialement.

**Format des durées et des dates.** Relatif pour les **âges** — âge du cache, âge de la file — parce que ce qui compte est l'écart au présent. Absolu pour le **journal des mouvements**, où l'heure exacte du geste est l'information. Les deux formats coexistent, chacun pour son usage.

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

**Une référence ou un emplacement créé hors ligne doit partir avant le mouvement qui s'en sert.** Le FIFO l'assure, mais la conséquence sur le classement des erreurs est à traiter : une violation de clé étrangère au vidage n'est pas un rejet métier, c'est un problème d'ordre. Elle se réessaie après le vidage des éléments antérieurs, elle ne part pas dans la liste « en échec ».

**Le vidage ne doit pas dépendre de l'événement `online`.** Constaté le 19 septembre sur la garde de périmètre : `online` ne se déclenche que sur une vraie bascule de connectivité, pas sur un creux 4G ni sur un Wi-Fi associé sans accès réel à internet. Une file qui attendrait cet événement pour se vider resterait pleine indéfiniment après une simple baisse de signal. Le vidage se tente à chaque action de l'utilisateur et sur minuterie ; `online` n'est qu'un déclencheur d'appoint.

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

**Friction opératoire à anticiper** : les instructions `create policy` sont refusées par le classifieur d'auto-mode des sessions de développement — constaté deux fois. Elles doivent donc être préparées à l'avance et exécutées à la main dans l'éditeur SQL de Supabase. Une fonctionnalité qui suppose une nouvelle policy n'est pas terminée quand le code est poussé : elle l'est quand la policy est jouée. À dire dans le rapport, jamais à découvrir au premier essai.

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
  ordre   int              -- séquence de création, pas un parcours ; voir §8
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

### L'app ne refuse jamais un fait physique

Elle ne refuse jamais un placement, une cohabitation ou un rangement jugé peu orthodoxe, parce que la palette, elle, est déjà posée.

**Ni une sortie qui rendrait le stock négatif** — révision de la règle antérieure, qui justifiait ce refus comme « de l'arithmétique sur la réalité ». Ce n'est vrai que si le théorique est juste. Après une faute de frappe — 100 saisi au lieu de 10 sur un stock de 110 — le théorique dit 10 et la palette en porte 100 : bloquer la sortie suivante revient à refuser un fait physique, au pire moment, en allée.

Pire, le blocage ne prévient pas l'erreur, il la cache. L'opérateur bloqué ne corrige pas la saisie d'il y a trois jours : il contourne, et la position négative — qui est la **preuve** qu'une erreur antérieure existe — n'apparaît jamais. C'est le signal le plus fiable dont dispose un système de stock, et le blocage le détruit.

Un système qui interdit ce que l'entrepôt fait quand même ne corrige pas l'entrepôt : il se fait contourner, et à partir de là il ment. Toute règle d'organisation — familles de mélange, plafond de références, affectation par niveau — est donc **indicative** : elle alimente une suggestion et un signal sur la carte, jamais une validation.

### Aucune modification, aucune suppression

Une erreur se corrige par un mouvement inverse, de motif `annulation`, portant l'`id` du mouvement annulé dans `annule_mouvement_id`. L'historique conserve l'erreur et sa correction.

État réel : la colonne existe, mais le lien n'est pas posé — `annulation` est un motif ordinaire choisi à la main, sans écran d'historique depuis lequel annuler un mouvement précis. Dette assumée (§14). En attendant, **le commentaire est obligatoire quand le motif est `annulation`** : à défaut d'un lien machine, une trace lisible.

### Les données de référence ne sont pas des faits d'audit

L'immuabilité ci-dessus vise `mouvements` et `comptage_lignes`, c'est-à-dire ce qui s'est passé. Une référence, un client, un emplacement décrivent le monde, pas un événement : leur régime est différent, et le confondre revient à figer des fautes de frappe pour toujours. Trois niveaux, à distinguer nettement.

**Toujours modifiable, même avec des mouvements : les attributs descriptifs.** Libellé, client rattaché, code tarifaire, famille de mélange, dimensions. Aucun mouvement ne les référence — ils pointent sur le **code**. Corriger « PINK 113g » en « Pomade Pink 113g » ne réécrit aucune histoire.

**Jamais modifiable : le code lui-même**, qui est l'identité et la clé étrangère de tout l'historique. Le renommer demanderait une cascade sur les mouvements, c'est-à-dire réécrire le passé.

**Supprimable tant que rien ne la référence** : une référence sans aucun mouvement **ni aucune ligne de comptage** ne porte aucune histoire.

Troisième lien à ne pas oublier, ajouté le 19 septembre : `inventaire_references`, qui enregistre le **périmètre** d'un inventaire. Une référence peut y figurer sans avoir jamais été comptée — elle était dans le périmètre, on ne l'a pas trouvée. La supprimer efface alors, en cascade et en silence, une partie du procès-verbal de cet inventaire. Deux règles :

- Le décompte affiché en cas de refus mentionne aussi ce lien — « présente dans le périmètre de 2 inventaires » — pour que l'on sache ce que l'on efface.
- **Dès que la clôture existera, la suppression sera refusée si la référence appartient au périmètre d'un inventaire clos.** Le périmètre d'un inventaire clos est une donnée d'audit ; celui d'un inventaire en cours ou abandonné ne l'est pas. La supprimer et la recréer sous le bon code est plus simple et plus sûr qu'un renommage en cascade. Au-delà, la suppression est refusée, et l'app dit **pourquoi** — « 3 mouvements, 12 lignes de comptage » — au lieu d'un refus muet.

Conséquence pratique constatée le 18 septembre : une référence mal saisie puis comptée le matin même porte des lignes de comptage. Elle ne redevient supprimable qu'une fois ces lignes retirées, ce que l'inventaire en cours autorise (§3). L'ordre est donc : retirer les saisies, puis supprimer la référence.

**`pieces_par_carton` garde son régime propre** : jamais modifié, un nouveau conditionnement est créé (§4). Ce n'est pas un attribut descriptif, c'est une unité de compte dont dépendent les quantités déjà écrites.

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

Cinq destinations, pleine largeur, empilées : **Rechercher**, **Mouvement**, **Inventaire**, **Catalogue**, **Réglages**.

**Sélecteur de langue** — français, 日本語, English — sur cet écran plutôt que dans les Réglages : un testeur terrain qui change de langue ne doit pas avoir à la chercher.

Sous les boutons : état de la file hors ligne, date du dernier export, nombre de mouvements du jour. **Ces indicateurs n'affichent rien tant qu'ils ne sont pas branchés sur une vraie donnée** — jamais de texte fixe rassurant. Un « Tout est synchronisé » codé en dur est un mensonge en attente : il est vrai aujourd'hui parce qu'il n'y a pas encore de file, et il deviendra faux sans que personne s'en aperçoive.

### 6.2 Recherche

Repris de la v1, avec les quantités ajoutées.

- Recherche par référence, filtrage incrémental sur **code et libellé**, sans focus automatique. Le libellé n'est pas un confort : les factures ne portent pas toujours la référence, et le nom de l'article est alors le seul point d'entrée.
- **Correspondance par jetons, pas par sous-chaîne entière.** « matelas bleu » doit retrouver « Matelas XL bleu » : chaque mot de la requête est cherché indépendamment, dans n'importe quel ordre, et tous doivent être présents. Une sous-chaîne sur la chaîne complète échouerait sur la moitié des libellés recopiés d'une facture.
- **Normalisation avant comparaison** : minuscules, accents retirés, séparateurs ignorés — « Pommade à cheveux » et « pommade cheveux » doivent se rejoindre. Le japonais, sans espaces, reste couvert par la recherche en sous-chaîne de chaque jeton.
- **Ordre des résultats**, sans quoi le libellé noie le code : code en préfixe exact, puis code en sous-chaîne, puis libellé. Taper « 65 » doit continuer à donner `REU065` avant tout article dont le nom contient 65.
- **Le résultat affiche le code et le libellé** — chercher par nom et ne voir que des codes ne permet pas de choisir. Cela vaut pour l'écran Recherche comme pour les sélecteurs : un filtre partagé ne change pas ce qui est rendu, l'affichage se vérifie écran par écran.
- **Portée de cette exigence : les résultats, pas l'état sélectionné.** Une fois une référence choisie, l'affichage ne sert plus à choisir mais à **confirmer**. Cette confirmation doit exister sur tout écran qui écrit, avant l'écriture : compter ou sortir contre la mauvaise référence fabrique un faux écart à deux endroits, ce qui touche directement l'indicateur du pilote. Elle se place en ligne en lecture seule sous le champ, sans modifier le contrat d'un composant de saisie partagé, et le libellé figure aussi dans la liste des saisies (§6.5) — l'un confirme avant, l'autre après.
- **`libelleCourt` désigne le conditionnement, jamais le produit.** Il a déjà été affiché à la place du nom de l'article sur deux écrans — c'est le champ qui invite à l'erreur. À renommer pour qu'il ne puisse plus se lire comme un nom de produit, et à afficher toujours en suffixe : « REU265 — Matelas XL bleu · carton de 12 ». Sans ce renommage, il y aura une troisième occurrence.
- **Jamais de troncature silencieuse.** Un plafond de résultats est légitime dans une liste déroulante ; sur l'écran Recherche il ferait conclure qu'un article n'existe pas. Soit aucun plafond sur cet écran, soit le nombre total affiché — « 8 affichés sur 34 ».
- `libelle` est facultatif en base. Une référence sans nom s'affiche par son seul code et ne sera jamais trouvée par nom : acceptable, et c'est une raison de renseigner les noms dès la création.
**Clavier d'ouverture des champs de référence — chantier abandonné.** L'usage réel a tranché en deux jours : les lettres servent très régulièrement, y compris dans la saisie d'inventaire. Le clavier texte reste partout, l'`inputMode="decimal"` posé en mesure est retiré, et il n'y a plus de bouton de bascule à concevoir.

Trace utile de l'épisode : `inputMode` s'est révélé **inerte dans cette PWA** sur l'iPhone de l'utilisateur, malgré sa présence prouvée sur l'`<input>`. Toute conception qui en dépendrait devrait être mesurée avant d'être promise.

- **Un seul filtre partagé** entre la Recherche, le sélecteur de référence de Mouvement et celui de l'Inventaire. Même règle que pour la suppression : une implémentation, plusieurs appelants.
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
- validation en **double appui** : premier appui pour armer avec changement de couleur et de libellé, second pour écrire, retombée automatique après 3 secondes.

**Confirmation proportionnée au risque.** Une boîte de confirmation systématique devient invisible en une semaine — on la ferme sans la lire, et elle ne protège plus de rien. Deux régimes :

- **Mouvement ordinaire** : le double appui ci-dessus, rapide.
- **Mouvement inhabituel** : un récapitulatif en toutes lettres, à lire avant de confirmer — « Sortie de 2 cartons de REU003 depuis A-03-2 », « Transfert de A-03-2 vers B-01-0 : 3 cartons de REU003 ». Une phrase attrape la faute de frappe qu'un changement de couleur laisse passer, parce qu'on la lit au lieu de ré-appuyer.

Est inhabituel : une quantité supérieure au stock théorique, une quantité qui vide entièrement le casier, ou une quantité très supérieure à l'ordre de grandeur habituel des sorties de cette référence — calculable sur l'historique des `mouvements`. Cas particulier à traiter explicitement parce qu'il est fréquent et détectable : une quantité valant exactement dix ou cent fois une valeur plausible déclenche la question directe, « vouliez-vous dire 10 ? ».

Ainsi la grande majorité des mouvements reste à deux appuis, et seuls ceux qui pourraient être une faute demandent une phrase.

**Correction en un geste.** L'écran Mouvement affiche les derniers mouvements de la session avec un bouton « corriger » qui écrit l'inverse et renseigne `annule_mouvement_id`. La plupart des fautes de frappe sont vues dans les secondes qui suivent ; ce qui empêche de les corriger aujourd'hui, c'est qu'il faut choisir le motif `annulation` à la main et tout ressaisir. C'est aussi ce qui referme la dette du lien d'annulation (§14).

**Sortie supérieure au stock théorique : avertie, jamais bloquée.** Le stock disponible est affiché, la sortie est confirmée par récapitulatif, puis enregistrée. La position négative qui en résulte entre dans une liste d'anomalies visible jusqu'à résolution — c'est le signal le plus fiable qu'une erreur de saisie antérieure existe.

Pas de stock négatif **silencieux** : il est signalé, confirmé, et suivi dans la liste d'anomalies. Mais pas interdit — voir « L'app ne refuse jamais un fait physique » (§4).

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

**Navigation par flèches sur le champ casier, et casier persistant.** C'est le principal frottement de la marche : retaper un code à chaque casier.

- Une flèche avant et une flèche arrière à côté du champ, qui avancent d'un casier dans l'ordre de tournée défini au §8 — niveau suivant dans la même baie, puis baie suivante au niveau le plus bas, puis zone suivante. C'est exactement l'ordre par défaut, il n'y a pas de second ordre à inventer.
- **La navigation parcourt la liste des emplacements existants, elle ne calcule pas un code.** Une inter-allée n'a qu'un niveau 0, et une baie peut n'avoir que trois niveaux : composer `A-03-3` par arithmétique produirait un cul-de-sac ou un casier fantôme. On avance dans la liste réelle des emplacements, triée zone/baie/niveau (§8).
- **Changer de casier ne vide rien.** Règle inversée le 24 septembre : voir « une navigation ne détruit pas une saisie en cours », plus bas. La crainte d'origine — reporter une quantité à moitié saisie sur le casier suivant fabriquerait un comptage — supposait qu'une navigation puisse écrire. Elle ne le peut pas : seule la validation écrit, et elle est explicite. Le coût réel allait dans l'autre sens, une saisie perdue à chaque correction de casier.
- **Le casier reste inscrit après enregistrement.** On enregistre plusieurs références au même casier avant de passer au suivant ; le vider à chaque validation impose de le retaper.
- Au retour dans le champ, **le contenu est sélectionné plutôt qu'effacé**. Taper le remplace, comme un effacement ; mais un appui involontaire ne perd rien. Sur un téléphone tenu à une main, l'effacement franc coûte plus qu'il ne rapporte.

Ces flèches sont le retour, à leur bonne place, de la navigation prévue par la v1 pour l'écran Emplacement — écran retiré du périmètre (§6.3), dont c'était le seul usage qui manquait.

**Liste des saisies pendant la marche.** Sous le formulaire, la liste de ce qui a déjà été saisi dans cet inventaire, la plus récente en haut, modifiable au clic.

- Chaque ligne porte **le casier, la référence, le conditionnement et la quantité**. Le casier est indispensable : sans lui, la même référence comptée à deux endroits ressemble à un doublon.
- La liste montre **l'état effectif**, une ligne par couple casier × référence × conditionnement avec sa dernière valeur — pas le journal brut, sinon une correction apparaît comme une seconde saisie.
- **Aucun théorique, aucun écart dans cette liste.** C'est le relevé de ce qu'on a tapé, pas un tableau de bord. Y afficher l'attendu transformerait la marche en comptage vers une cible, ce que la saisie à l'aveugle cherche justement à éviter.
- Saisir une référence déjà relevée au même casier déclenche la question : « déjà saisi, 4 cartons — remplacer ou ajouter ? ». C'est le vrai gain de la fonction, et la double saisie est l'erreur qu'elle supprime.
- Vingt dernières lignes affichées, le reste derrière un lien. Sur un écran de téléphone, une liste sans plafond devient un mur.
- **« Modifier » remonte au formulaire de saisie, prérempli.** C'est là qu'on saisit, c'est donc là qu'on corrige : ouvrir un second champ de saisie sous la ligne créerait une deuxième surface d'édition sur le même écran, et l'utilisateur ne saurait plus laquelle fait foi. Le formulaire passe en **mode modification**, visiblement — il dit quelle ligne il modifie et offre une sortie sans écrire.
- **En mode modification, la question de collision ne disparaît pas : elle change de cible.** Une collision **avec soi-même** — le triplet ne change pas — n'est pas une collision, c'est l'objet de l'opération ; la poser transformerait chaque correction en un choix piège dont une branche crée le doublon qu'on venait corriger. Mais une modification qui atterrit sur un triplet **déjà occupé par une autre ligne** est précisément le cas pour lequel la question a été écrite : deux comptages distincts se retrouvent au même endroit et rien ne dit lequel fait foi. Écraser sans demander perd un comptage réel, sans trace et sans bruit — le défaut le plus coûteux du module, puisqu'il ne se découvre qu'à la comparaison finale, quand il est trop tard pour retourner au casier. La question est donc posée **à la destination, avant écriture** : « déjà saisi à A-03-1, 6 cartons — remplacer ou ajouter ? ». Les deux branches sont explicites ; aucune ne perd de donnée que l'utilisateur n'ait choisi de perdre.
- **Un déplacement qui entre en collision ne pose qu'une seule question.** Le récapitulatif de déplacement et la question de collision portent sur la même décision et se présentent ensemble, jamais l'un après l'autre : « Déplacer REU003 de A-02-1 vers A-03-1 ? Déjà saisi à A-03-1 : 6 cartons » avec trois issues — Ajouter (10), Remplacer (4), Annuler. Les totaux sont calculés et affichés ; on ne fait pas d'arithmétique debout dans une allée. Deux dialogues d'affilée feraient confirmer un déplacement avant d'en connaître la conséquence, et chaîneraient deux gestes là où il n'y a qu'un choix à faire.
- **Toute confirmation qui écrit est une fenêtre modale** : centrée, sur fond assombri, fermée seulement par un de ses boutons — jamais par un toucher hors de la fenêtre. C'est le composant déjà utilisé pour le rappel des références, pas une copie de plus. Défaut constaté le 24 septembre : les boutons Ajouter / Remplacer s'affichaient hors écran et demandaient de faire défiler pour les atteindre. Un choix qu'on va chercher en faisant défiler est un choix qu'on fait mal, et une fermeture au toucher hors fenêtre transforme un geste imprécis en décision écrite. La distinction est là : ce qui **écrit** exige un choix explicite ; ce qui ne fait que **montrer** — le rappel des références — peut se fermer au toucher hors fenêtre, puisque rien ne s'y décide.
- **Un déplacement emporte toute la ligne.** Répartir une quantité entre deux casiers ne passe pas par le déplacement : on corrige la quantité à l'origine, puis on saisit le reste au casier cible. Ce n'est pas un contournement mais la description exacte de ce qu'on a sous les yeux — deux quantités, chacune vraie à son casier. Ajouter un champ de quantité à la fenêtre de déplacement chargerait, pour un cas rare, l'écran le plus tendu du module.
- **La quantité affichée et la quantité utilisée sont le même nombre**, celui de l'état local. Ne pas relire le serveur avant de calculer : sur un seul appareil, l'état local est la vue **la plus complète**, puisqu'il intègre les écritures encore en file hors ligne que le serveur ignore. Une relecture donnerait la mauvaise valeur précisément quand une saisie est en attente, et poserait une dépendance réseau au milieu d'une confirmation, en allée, où la coupure est le cas courant — un risque d'arithmétique rare échangé contre un risque de blocage fréquent. Cette règle tient tant qu'un seul appareil écrit ; voir §14.
- **Le casier du formulaire est la destination.** Le changer en mode modification — aux flèches comme à la main — ne corrige pas un champ, il déplace la ligne : la validation montre alors le récapitulatif de déplacement (§ ci-dessous) au lieu de la confirmation ordinaire.

**Suppression et modification d'une saisie : une seule implémentation, deux appels.** La marche et l'écran des écarts doivent appeler la même fonction. Le bug trouvé le 16 septembre — « annuler » ne retirait que la ligne la plus récente, laissant resurgir une correction antérieure du même casier × référence — existait aux deux endroits parce que le code était écrit deux fois. Corriger un seul appelant institutionnalise la divergence, et le troisième écran aura le même défaut.

Ce qui doit être unique, c'est **l'écriture**, pas les pixels. Chaque écran corrige dans son propre formulaire — la marche dans celui de saisie, les écarts dans le sien — et les deux appellent la même fonction, qui compare le triplet avant et après et décide seule s'il s'agit d'une correction de valeur ou d'un déplacement. La règle à ne pas enfreindre : **jamais deux surfaces d'édition sur un même écran**.

**Les champs de saisie appartiennent à un composant unique**, réutilisé partout où on saisit la même chose. Le champ casier de la boîte de déplacement est celui de la saisie, avec ses suggestions et sa saisie abrégée — pas un champ texte réécrit pour l'occasion. Un composant recopié perd ses correctifs un par un.

**Une navigation ne détruit pas une saisie en cours.** Passer au casier suivant déplace la cible ; ce qui est déjà tapé reste tapé. Défaut constaté le 23 septembre : les flèches vidaient le champ référence, alors que saisir le casier à la main le conservait — deux gestes pour la même opération, deux comportements. L'écart entre les deux est le vrai défaut, indépendamment de celui qui gagne. Seule la validation d'une saisie vide les champs, parce que là le contenu a été écrit quelque part.

**L'identité d'une saisie est le triplet (casier, référence, conditionnement). En changer une composante n'est pas une modification de champ, c'est un déplacement.** La quantité est une valeur : elle se corrige sur place. Le triplet est une clé : le corriger, c'est retirer la ligne de là où elle était et en écrire une équivalente là où elle doit être.

Le cas du casier est le plus visible, et le plus piégeux. Un `comptage` porte un emplacement et regroupe toutes les références comptées à cet endroit. Modifier `comptages.emplacement_code` déplacerait donc **toutes** les lignes de ce casier d'un coup — une corruption silencieuse dans le module qui produit l'indicateur, et le genre de défaut qui ne se voit qu'à la comparaison finale. La règle : écrire la ligne dans le comptage du casier cible, celui-ci étant créé s'il n'existe pas, puis retirer l'originale. C'est exactement ce que l'utilisateur fait aujourd'hui à la main en supprimant puis ressaisissant ; l'app lui épargne la ressaisie, elle ne change pas la nature de l'opération.

Les deux autres composantes suivent la même règle au même casier. Corriger la référence seule était jusqu'au 23 septembre un `update` qui laissait l'ancienne ligne en place : elle restait rattachée à son comptage, donc comptée, et la correction s'ajoutait au lieu de remplacer. Défaut antérieur à la fonction de déplacement, découvert en l'écrivant. C'est la raison pour laquelle la règle s'énonce sur le triplet et non sur l'emplacement : formulée sur le seul casier, elle laissait deux portes ouvertes.

**Un seul chemin pour les trois.** La marche et l'écran des écarts appellent la même fonction, qui décide elle-même, en comparant le triplet avant et après, s'il s'agit d'une correction de valeur ou d'un déplacement. Un appelant qui choisirait à la place de la fonction réintroduira le défaut.

Confirmation simple avec récapitulatif — « Déplacer REU003 de A-02-1 vers A-03-1 ? » — et non double appui : rien n'est détruit, le contenu est relocalisé. Le casier cible se valide comme à la saisie ; il n'a pas à appartenir au périmètre, qui ne porte que sur les références.

**Le correctif ne vaut que pour l'avenir.** Une correction de référence faite avant le 23 septembre a laissé une ligne fantôme en base, et rien ne la distingue en SQL d'une référence légitimement comptée à ce casier : deux références au même endroit sont le cas normal. Il n'y a donc pas de requête de détection à écrire. Le seul contrôle est la comparaison au physique, qui est précisément ce que fait le comptage du vendredi.

#### Inventaire partiel — le périmètre doit se voir pendant le comptage

Défaut constaté le 19 septembre sur un inventaire à périmètre `references` : toutes les références apparaissent dans les suggestions, rien ne rappelle celles à compter, et une référence hors périmètre a pu être saisie. C'est le cas d'usage de chaque vendredi — le comptage hebdomadaire porte sur les références sorties dans la semaine.

La saisie libre reste la règle du module, parce qu'elle seule révèle une palette déplacée. Mais elle vise **l'emplacement** : une référence du périmètre trouvée dans un casier inattendu. Une référence **hors périmètre** est une autre question — non pas où elle se trouve, mais si elle appartient à cet inventaire.

**1. Suggestions filtrées au périmètre.** En inventaire partiel, la liste déroulante ne propose que les références du périmètre. Le champ reste libre : un code tapé en entier est toujours accepté, ce qui préserve le principe des suggestions jamais restrictives. Taper un code complet est déjà un geste délibéré.

**2. Référence hors périmètre : proposer d'étendre, jamais enregistrer en silence.** Question explicite — « REU050 n'est pas dans le périmètre de cet inventaire. L'ajouter ? ». Oui : la référence entre dans `inventaire_references`, puis la saisie s'enregistre normalement. Non : rien n'est écrit.

Étendre un périmètre en cours de route est **sans danger**, et c'est une décision antérieure qui le rend possible : le théorique n'est jamais une copie figée au lancement, il se recalcule sur `ts < frozen_ts` (§6.5). Une référence ajoutée après coup est comparée au même instant que les autres. Avec un théorique copié au lancement, l'extension aurait été impossible.

**3. Rappel des références à compter**, en inventaire partiel uniquement. Liste du périmètre, chaque référence avec son état : **non comptée**, ou **comptée dans N casiers**. Jamais « terminée » : une référence peut se trouver dans un casier de plus, et seul l'opérateur sait quand il a fini de la chercher. Et **jamais l'emplacement attendu** — ce serait afficher le théorique, donc compter vers une cible (§6.5).

En inventaire complet ou par client, rien ne change : le rappel serait une liste de trois cents lignes, du bruit.

**4. Les saisies hors périmètre déjà enregistrées ne doivent pas disparaître.** Vérifié le 19 septembre : aucune n'était perdue. Elles figuraient déjà à l'écran des écarts et sur la feuille imprimée, avec un théorique nul — le défaut était un manque de signalement, pas une perte. Elles apparaissent désormais marquées **hors périmètre**, avec la même action « ajouter au périmètre ».

**Deux gardes, et c'est la seconde qui fait foi.** À la saisie, le contrôle de périmètre dépend d'une valeur chargée en mémoire ; il **échoue fermé** — si le périmètre n'est pas confirmé chargé, la saisie est refusée avec un message plutôt qu'acceptée par défaut. Correct, mais un contrôle côté client peut toujours être contourné par un chemin de code qu'on n'a pas prévu. Le marquage « hors périmètre » sur l'écran des écarts, lui, lit **ce qui est réellement en base** : il rattrape tout ce qui aurait passé la première garde. Si les deux divergent un jour, c'est l'écran des écarts qu'il faut croire.

**Une garde qui échoue fermée doit savoir se rouvrir.** Constaté le 19 septembre : après une coupure puis le retour du réseau, la saisie restait refusée — le périmètre n'était jamais rechargé. La correction de la veille avait transformé une erreur passagère en blocage permanent, et le message « vérifiez votre connexion et réessayez » promettait une reprise que l'app ne faisait pas : un message qui ment, de la même famille que le « tout est synchronisé » codé en dur.

Règle : **toute tentative de saisie qui trouve le périmètre non chargé tente d'abord de le recharger**, et ne refuse que si cette tentative échoue elle-même. Le rechargement se déclenche aussi à l'événement `online`. La garde se répare alors d'elle-même dès que le réseau revient, sans quitter l'écran.

Leçon de méthode, valable au-delà de ce cas : tester qu'une garde se ferme ne suffit pas ; il faut tester qu'elle se rouvre. La première moitié du test aurait laissé passer ce défaut.

**Étendre le périmètre engage à compter la référence partout — à dire en phase 2.** En phase 1 le théorique est nul et l'extension n'a aucun effet de bord. En phase 2, ajouter une référence au périmètre rend attendus **tous** ses emplacements théoriques : ceux qui ne seront pas visités apparaîtront en écart. C'est le comportement juste, mais une extension faite au passage, pour une référence aperçue par hasard dans un casier, produirait des écarts déroutants. La question devra alors le dire : « Ses autres emplacements deviendront attendus. »

#### Écran des écarts — mise en page et navigation

Le premier inventaire réel, le 18 septembre sur les références sorties dans la semaine, a montré un écran conçu pour une liste courte et utilisé au-delà — des libellés longs, souvent bilingues, qui repoussent les chiffres hors de portée du regard. Quatre corrections, toutes de même nature : **les chiffres sont ce qu'on vient lire, ils doivent être trouvables sans effort.**

- **Les chiffres occupent leur propre ligne, sous le libellé.** Aujourd'hui le libellé et les nombres se disputent une seule ligne : un nom long repousse « 0 → 72 (+72) » dans une colonne étroite qui se coupe en trois. Ligne 1 : `CODE — libellé`, pleine largeur, retour à la ligne autorisé. Ligne 2 : `théorique → compté (écart)`, d'un seul tenant, jamais coupé.
- **Position horizontale fixe.** Les nombres doivent commencer au même endroit d'une ligne à l'autre, indépendamment de la longueur du libellé. C'est ce qui permet de balayer la colonne du regard plutôt que de la chercher à chaque ligne — et c'est précisément ce qui a coûté du temps.
- **Barre d'action collante.** Le bouton d'accès aux écarts sort de l'écran après quelques saisies et oblige à faire défiler jusqu'au bord. Il se fixe en bas, dans la zone sûre (`safe-area-inset-bottom`), atteignable au pouce à tout moment.
- **Filtre de recherche en tête de l'écran des écarts**, avec le filtre partagé déjà en place (§6.2). Sur une gamme entière, atteindre une référence par défilement n'est pas tenable. Coût faible : la fonction existe et a trois appelants.
- L'étiquette « Écart réel » n'a pas besoin d'une ligne à elle : une pastille compacte en fin de ligne de chiffres suffit.

#### Abandonner un inventaire

Manque révélé le 18 septembre. Un inventaire ouvert et non clôturé **bloque tout inventaire suivant**, l'index `one_inventaire_en_cours` n'en admettant qu'un seul actif. Sans action d'abandon, la seule sortie serait la clôture — qui écrirait des `ajustement_inventaire` que l'on ne veut pas.

La clôture n'étant pas construite, il n'existe aujourd'hui **aucune sortie** d'un inventaire. Conséquence heureuse : l'accident décrit plus haut — une clôture écrivant des centaines d'`ajustement_inventaire` sur un théorique nul — est matériellement impossible. Conséquence bloquante : l'inventaire du 18 septembre restera ouvert et interdira le suivant tant que l'abandon n'existe pas.

L'abandon ferme l'inventaire sans écrire aucun mouvement : `statut = 'abandonne'`, motif libre saisi, lignes de comptage conservées telles quelles.

Deux points de mise en œuvre : la contrainte `check (statut in ('en_cours','clos'))` doit accueillir `'abandonne'`, donc une petite migration ; l'index partiel `one_inventaire_en_cours`, lui, ne change pas — un inventaire abandonné n'est plus `en_cours` et libère la place de lui-même. Elles restent la trace du comptage et demeurent exportables — c'est ce qui permet de réutiliser un comptage autrement que par une clôture.

**Première étape du chantier de clôture — une seule migration, quatre corrections de schéma :**

1. **`comptages.inventaire_id` passe en `not null`.** Aujourd'hui nullable, donc un comptage peut exister sans appartenir à aucun inventaire : ses lignes n'apparaissent alors dans le calcul d'écart d'aucun inventaire. Un trou silencieux, exactement dans le module qui produit l'indicateur du pilote. Vérifier d'abord s'il existe des lignes à `null` héritées de l'avant-refonte, et les rattacher ou les supprimer.
2. **Index unique sur `(inventaire_id, emplacement_code)`.** Sans lui, `getOrCreateCasier` peut créer deux comptages pour le même casier dans le même inventaire : les lignes se répartissent entre les deux et l'écart est faux. À vérifier dès maintenant en lecture seule — si des doublons existent déjà, ce n'est plus une précaution mais un bug à traiter.
3. **Suppression de `comptages.attendu_consulte`**, lue mais jamais écrite.
4. **Découpler les deux notions qui partagent `comptages.statut`.**

- « ce casier a été touché » — sert à l'affichage des écarts. Devient un horodatage, `visite_ts`, et non un statut : un horodatage ne peut pas se relire comme une clôture.
- « cet inventaire est clôturé » — c'est `inventaires.statut`, qui existe déjà et n'a besoin de rien. C'est ce que la policy `DELETE` (§3) interroge, en remontant `comptage_lignes → comptages → inventaires` — ce qui suppose le point 1 ci-dessus.

La synthèse des écarts se base alors sur la présence d'au moins une ligne de comptage, et non sur un statut. Ce découplage se fait **au début du chantier**, avant la clôture elle-même : le reste du chantier repose dessus.

**Clôture** : un inventaire ne se clôture que lorsque chaque casier du périmètre porte une saisie — chiffrée ou confirmée vide — et que chaque écart restant est soit corrigé, soit justifié par un motif saisi. La clôture écrit alors un mouvement `ajustement_inventaire` par couple référence × conditionnement écarté, portant le `comptage_id`. Aucun écart, aucun mouvement.

**Résultat imprimable** : synthèse d'un inventaire — périmètre, dates, couverture, écarts avec leur justification, écart total en pièces — en page A4 via `@media print`, d'où l'iPhone produit un PDF par le partage.

#### Le document imprimé — retour d'essai du 19 septembre

`window.print()` fonctionne depuis la PWA installée : la question ouverte est close, et le repli Safari comme la piste d'une dépendance PDF deviennent sans objet.

**Le document est toujours en japonais, quelle que soit la langue de l'interface.** L'interface sert l'opérateur, le document sert ses lecteurs — ce sont deux publics différents. La feuille est rendue avec le dictionnaire `ja` de façon figée, et les dates suivent la convention japonaise `2026/09/18`, sans secondes. Les libellés produits, déjà bilingues en base, restent tels quels.

Vocabulaire à employer, pour que la feuille se lise comme un document d'entrepôt japonais plutôt que comme une traduction :

| Rôle | Terme |
|---|---|
| Titre, comptage sans théorique | 棚卸結果報告 |
| Titre, avec théorique | 棚卸差異報告 |
| Mention de statut | 進行中 ― 未確定 |
| Périmètre | 対象 |
| Date d'impression | 印刷日時 |
| Emplacement | 棚番 |
| Code article | 品番 |
| Désignation | 品名 |
| Stock théorique | 理論在庫 |
| Quantité comptée | 実棚数量 |
| Écart | 差異 |
| Cartons | ケース |
| Pièces | バラ |
| Total | 合計 |
| Case de contre-validation | 確認 |
| Bas de page | 確認者 ／ 日付 |

**Le titre nomme le type de document, le périmètre est un champ d'en-tête.** Correction du 19 septembre : j'avais confondu les deux, d'où un titre dérivé qui disait le périmètre sans dire ce qu'on tenait entre les mains. Les deux pages retrouvent une structure parallèle — un titre, puis 対象.

| Page | Titre |
|---|---|
| Synthèse | 棚卸差異報告 |
| Contre-validation | 棚卸確認表 |

Le périmètre se dérive de `inventaires.scope_kind` et alimente le champ 対象, sur les deux pages :

| Périmètre | 対象 |
|---|---|
| `tout` | 全体 |
| `client` | 得意先 REUZEL |
| `references` | 品目指定（REU003, REU004, REU008 他5件） — trois codes puis le décompte |

Ainsi disparaît aussi la redondance de « 対象：全体棚卸 », où le mot 棚卸 apparaissait deux fois.

**Deux dates, et elles ne disent pas la même chose.** **棚卸実施日** — la date de la **première saisie**, une seule date, jamais un intervalle. **基準日時** — le `frozen_ts` du lancement, contre lequel le théorique est calculé : c'est elle qui rend l'écart interprétable. Afficher l'une sans l'autre laisse un document ambigu dès la phase 2.

L'intervalle première/dernière était une addition de ma part, et c'est elle qui créait le défaut signalé le 19 septembre : une correction passée depuis l'écran des écarts quatre jours plus tard étirait la plage, et la feuille annonçait un comptage étalé sur quatre jours là où il y avait eu un après-midi plus une retouche. Une correction n'est pas du comptage. Le retour à une date unique supprime le défaut **sans aucune requête supplémentaire** — c'est le minimum des horodatages déjà en main, et les lignes non corrigées gardent celui du comptage.

**Les glyphes japonais s'impriment correctement** — vérifié sur le PDF du 19 septembre. Les blancs observés venaient du lecteur qui l'a ouvert, pas du document. Point clos, à ne pas rouvrir.

**Un seul format de document, celui de la phase 2, construit dès maintenant.** Les colonnes 理論在庫 et 差異 restent même quand le théorique est nul : les lecteurs de la feuille savent que l'app est en développement et lisent le total compté. Construire une variante de phase 1 reviendrait à la jeter au moment de l'amorçage, et à refaire la mise en page au pire moment — quand le stock réel arrive. Le document est donc prêt pour le jour J.

**Une addition d'une ligne qui lève l'ambiguïté sans variante.** La feuille totalise **合計数量** — la quantité comptée — *et* **差異合計** — le total des écarts, côte à côte. Aujourd'hui la première vaut 58 151 et la seconde autant, ce qui se lit correctement au lieu d'annoncer une disparition massive. En phase 2 les deux divergent et disent chacune quelque chose. Le total compté figure de toute façon sur un 棚卸 japonais : ce n'est pas une béquille de phase 1.

La mention **進行中 ― 未確定** reste tant que la clôture n'existe pas : elle décrit le statut de l'inventaire, pas le format du document, et elle servira aussi en phase 2 pour un inventaire imprimé avant sa clôture.

**Mise en page.** Fond blanc et texte noir imposés en `@media print` — le fond gris de l'écran ne doit pas partir à l'impression. Corps de table à 9 ou 10 pt. `break-inside: avoid` sur chaque ligne, une ligne coupée entre deux pages étant illisible. `thead` en `display: table-header-group` pour que les en-têtes de colonnes se répètent sur chaque page : sur l'essai, la deuxième page n'est qu'une suite de nombres sans titre. Code article et désignation en **deux colonnes distinctes**, la première étroite pour que les codes s'alignent.

**Marges réduites à 10–12 mm**, pour rendre de la largeur à la désignation. Pas en deçà : les imprimantes ont une zone non imprimable de l'ordre de 5 à 10 mm, et descendre plus bas fait rogner le contenu sur certaines d'entre elles sans prévenir.

**Pagination — à mesurer avant de promettre.** Les compteurs `counter(page)` dans les boîtes de marge `@page` relèvent d'une spécification que les navigateurs, WebKit en particulier, n'implémentent pas. Essayer d'abord, constater sur l'appareil, et **dire si ça ne marche pas** plutôt que de livrer un numéro de page qui ne s'affiche jamais — la leçon de l'épisode `inputMode`.

**Constaté le 19 septembre : aucun numéro de page ne s'affiche** sur l'iPhone. La règle `counter(page)` est donc retirée du code — une règle sans effet qui reste dans le dépôt fait croire au lecteur suivant qu'elle fonctionne. Seul le repli ci-dessous subsiste.

Si la pagination CSS est inopérante, le repli ne consiste pas à ajouter une bibliothèque de mise en page paginée. Le besoin réel, sur un document signé, est de **détecter une page manquante** : il est couvert en imprimant le nombre total de lignes en tête — `全 47 行` — ce qui fonctionne partout et sans dépendance.

#### La feuille de contre-validation

Second document, après un saut de page : **le relevé complet du comptage**, une ligne par saisie, avec une case à cocher en tête de ligne.

**Il porte son propre bloc d'en-tête**, ajouté le 19 septembre : titre **棚卸確認表**, puis 対象 et la date, comme la première page. Cette feuille est faite pour être détachée et emportée dans l'entrepôt ; séparée de la page 1, sans titre ni périmètre, elle n'est plus qu'une liste anonyme de nombres avec des cases — et c'est pourtant elle qui sera signée.

**Sa source doit être dédupliquée en dernière-valeur-gagne.** Lire le journal des saisies plutôt que l'agrégat de l'écran des écarts est le bon choix — l'agrégat passe par le statut de casier que le §14 signale comme surchargé, et un document destiné à être signé ne peut pas dépendre d'un filtre douteux. Mais le journal conserve chaque correction à côté de la saisie d'origine : sans un `distinct on (casier, référence, conditionnement)` trié par `ts` puis `id` décroissants, une référence corrigée apparaîtra **deux fois** sur la feuille, avec deux quantités différentes. Exactement le piège traité dans la requête CSV, sur la même table.

- Colonnes : 確認 (case vide), 棚番, 品番, 品名, ケース, バラ, 合計.
- **Trié par référence, puis par emplacement** — révision du 19 septembre. J'avais prescrit l'ordre de tournée en supposant un contrôle en marchant ; l'usage réel est la **revérification ciblée** d'une ligne qui paraît fautive, et pour cela on part de la référence. Deux bénéfices qui confirment le choix : une référence présente dans plusieurs casiers occupe des lignes consécutives, ce qui donne sa dispersion d'un coup d'œil ; et l'ordre devient **le même qu'en page 1**, donc une ligne repérée sur la synthèse se retrouve à la même position relative sur le détail.
- L'ordre de tournée ne redeviendrait pertinent que si cette feuille servait un jour à un parcours physique complet. Le cas échéant, ce serait une option de tri, pas un changement de règle.
- Case à cocher dessinée en carré vide, assez grande pour être cochée au stylo.
- **Une seule heure d'impression, capturée une fois et partagée par les deux pages.** La feuille détachée reste ainsi prouvablement issue de la même impression que la page 1 — deux horodatages distincts sur un document en deux parties suffiraient à en faire douter.
- **Colonnes de codes en `white-space: nowrap` avec une largeur minimale, jamais une largeur fixe.** Une largeur fixe tronque ou coupe en silence le jour où un code dépasse la longueur observée aujourd'hui — six caractères sur le jeu REUZEL. La colonne doit pouvoir s'élargir et pousser la désignation, qui absorbe sans dommage.
- En-têtes répétés sur chaque page, comme ci-dessus.
- Ligne 確認者 ／ 日付 en pied de la dernière page.

**Une réserve à connaître, puisqu'elle porte sur ce que le document prouve.** Les quantités y étant imprimées, celui qui contrôle voit la réponse avant de compter — c'est un dispositif de **vérification**, rapide et utile pour un contrôle par sondage ou pour une signature, mais pas un recomptage indépendant. Un vrai recomptage demanderait la même feuille avec les quantités laissées vides. C'est la même distinction qu'entre compter à l'aveugle et compter vers une cible (§6.5). La variante à colonnes vides est le même document moins trois colonnes : à offrir en option le jour où le besoin d'un second comptage réellement indépendant se présente.

**Le repli « ouvrir dans Safari » n'est pas gratuit.** Une PWA installée sur l'écran d'accueil et Safari ont des stockages séparés : la session Supabase ne suit pas, et imprimer depuis Safari impose de se reconnecter par code e-mail à chaque fois. Si `window.print()` ne fonctionne pas en mode autonome, ce n'est donc pas une solution de repli acceptable au quotidien. La bonne réponse serait alors de ne rien bricoler en phase 1 — la sortie CSV couvre le besoin de chiffres — et de traiter l'impression avec l'export `.xlsx` de phase 2, plutôt que d'ajouter une dépendance de génération PDF pour combler un mois.

**Un inventaire en cours est imprimable aussi**, révision du 18 septembre : le besoin de justifier un comptage auprès de collègues n'attend pas la clôture, qui n'existe pas encore. La feuille porte alors une mention **« en cours, non clôturé »** en tête, non dissimulable — un document d'inventaire sans son statut se met à circuler comme s'il était définitif.

Hors périmètre pour l'instant : le suivi de l'historique casier par casier au fil des inventaires.

### 6.6 Réglages

- Imports CSV : Références, Emplacements, Stock initial (§7).
- Générateur d'emplacements.
- La création et la modification des références vivent désormais dans le **Catalogue** (§6.8), pas ici : on ne crée pas à un endroit pour vérifier à un autre.
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

### 6.8 Catalogue

Manque révélé le 18 septembre : les Réglages sont un entonnoir en écriture seule — on y crée des références et on ne les revoit jamais. D'où les fautes de saisie constatées, et l'impossibilité de les retrouver.

**Le Catalogue est d'abord une surface de lecture.** Lister, chercher, vérifier ; la modification n'arrive qu'ensuite. C'est l'inverse des Réglages, et c'est ce qui manque.

- Liste de toutes les références : `CODE — libellé`, client, conditionnements, stock total en pièces.
- Filtre par le filtre partagé (§6.2), plus un filtre par client.
- Fiche de référence : attributs descriptifs modifiables, code non modifiable, suppression proposée seulement si aucun mouvement ni ligne de comptage ne la référence (§4).
- C'est ici qu'atterriront `code_tarifaire`, `famille_melange` et les dimensions du carton quand leurs tables existeront. Le Catalogue est le bon foyer pour ces champs — les Réglages ne l'étaient pas.

**Référence inactive.** Avec le temps, les références abandonnées et les codes mal saisis encombrent tous les sélecteurs. Un drapeau `actif` les en retire sans rien effacer. C'est le mécanisme de retrait du module, et il n'y en a pas d'autre : **une référence qu'une ligne de comptage référence ne se supprime pas, elle s'archive.** L'abandon d'un inventaire ne libère pas ses références — il marque un inventaire, il n'efface pas ses lignes. Toute idée de « mode test » séparé retombe ici : l'unité d'isolement du module est l'inventaire pour les comptages, et le drapeau `actif` pour les références. Un interrupteur global dans les Réglages ajouterait un état caché qui change le sens de chaque geste, et dont l'oubli coûte soit un comptage réel perdu, soit une base polluée.

- Une référence inactive disparaît des sélecteurs de saisie — mouvement, comptage — mais reste visible dans la Recherche (signalée comme telle), dans l'historique et dans les exports. Rien n'est jamais supprimé.
- Réactivable à tout moment.
- **Désactivation refusée tant que le stock n'est pas nul**, avec le stock affiché. Ce n'est pas un fait physique que l'on refuserait (§4) mais un acte administratif : une référence inactive qui porte du stock sortirait des périmètres d'inventaire, et ce stock cesserait d'être compté sans que personne le voie.

## 7. Imports en masse et saisie manuelle

Trois fichiers distincts, chacun son bouton. Ne pas fusionner en un seul fichier polyvalent : la validation devient floue et les erreurs silencieuses.

**Références — réintégré au périmètre avant le 18.** Distinction qui sauve l'arbitrage antérieur : le report des imports en masse visait le **stock initial**, qui écrit des mouvements et touche l'intégrité du stock. L'import de références n'écrit aucun mouvement ; une erreur y est visible et corrigible. Ce n'est pas le même risque, ce n'est donc pas la même décision. Et les dimensions des cartons se saisissent dans un tableur, pas sur un téléphone.

**Le stock d'ouverture rejoint le classeur** — révision de l'arbitrage du 15 septembre, parce que l'usage change : la feuille devient la **feuille de comptage**. On compte, on remplit, on importe. Plus sûr que de taper trois cents mouvements sur un téléphone.

**L'amorçage se fera en une fois, à un comptage mensuel de fin octobre** — décision du 18 septembre, préférée à un amorçage progressif par vagues, puis reportée au retour d'un déplacement professionnel. Le périmètre REUZEL est déjà soumis à deux rythmes de comptage préexistants, indépendants de l'app :

- **hebdomadaire, le vendredi**, sur les références sorties dans la semaine ;
- **mensuel**, sur tout le stock.

Amorcer sur le comptage mensuel donne un stock d'ouverture complet, daté d'un seul jour, issu d'un comptage physique intégral. C'est le meilleur socle possible pour l'indicateur, et il rend inutile toute couture entre vagues.

**L'inventaire mensuel devient une porte à sens unique.** Il fixe le stock d'ouverture ; tout ce qui est faux dans le référentiel à ce moment-là est figé dedans. Les codes mal saisis se suppriment tant qu'aucun mouvement ne les référence (§4) — après l'amorçage, ils en porteront. **Le nettoyage du Catalogue doit donc précéder le comptage mensuel**, et c'est ce qui date le §6.8.

**La mesure du pilote commence à l'amorçage, pas le 18 septembre.** C'est cette date qui borne l'analyse du point de situation, et elle se note au README le jour où elle survient. Si le comptage mensuel tombe trop près du 16 octobre, c'est la date du point de situation qui se décale, pas la qualité du socle.

**Le rythme hebdomadaire devient l'instrument de mesure.** Une fois le stock amorcé et les mouvements enregistrés, chaque comptage du vendredi produit un écart réel sur les références qui ont bougé. L'indicateur du pilote cesse d'être un point unique en fin de période pour devenir une **série** — quelques mesures avant le point de situation, et la possibilité de voir une dérive s'installer au lieu de la découvrir. L'app se greffe ici sur une discipline de comptage tournant qui existait déjà ; elle ne l'impose pas.

**Conséquence sur le calendrier : l'abandon d'inventaire (§6.5) a une échéance ferme.** Un comptage a lieu chaque vendredi, et rien ne permet aujourd'hui de fermer celui du 18 septembre. Sans l'abandon, le comptage du vendredi suivant est impossible.

**Entre aujourd'hui et l'amorçage, l'app est un outil de comptage, pas un système de stock.** Les comptages hebdomadaires s'y font, la comparaison avec l'Excel reste manuelle, et aucun mouvement n'est enregistré. Le basculement doit être net : **à partir de l'amorçage, tous les mouvements sont saisis, sans exception**. Une sortie non enregistrée après cette date fabrique un écart que rien n'expliquera.

**Le comptage physique reste l'autorité, même contre un Excel fiable.** Le 18 septembre, la comparaison du comptage avec l'Excel tenu par la collègue a donné un écart d'une boîte sur une seule référence. Ce résultat valide le **processus** de saisie des ventes, pas le **socle** : une référence qui ne bouge pas depuis des mois ne peut pas acquérir d'erreur de saisie récente, mais rien ne dit que sa valeur de départ a jamais été vérifiée. C'est précisément pour les références à faible rotation que l'amorçage doit venir d'un comptage et non d'une recopie.

Exigence de méthode qui pèse plus que le gain de temps : **le stock d'ouverture se compte physiquement, il ne se recopie pas de l'ancien fichier de suivi.** Un stock semé depuis l'existant embarque ses erreurs, et l'inventaire de mi-octobre mesurerait la dérive de l'app **plus** l'erreur initiale sans pouvoir les séparer — l'indicateur unique du pilote perdrait son sens.

`reference, libelle, pieces_par_carton`
Crée la référence et son premier conditionnement. Référence connue : le libellé est mis à jour. Si `pieces_par_carton` diffère d'un conditionnement existant, un **nouveau** conditionnement est créé et l'ancien marqué `a_ecouler` — jamais de modification de l'existant. L'aperçu d'import signale explicitement ces créations. Aucun mouvement.

**Emplacements** — remplacé par le **générateur** : zone, plage de baies, niveaux, création en lot, `ordre` servant uniquement à ne pas renuméroter les emplacements déjà créés (§8). L'import CSV d'emplacements n'est plus au périmètre. Aucun mouvement créé. Un emplacement sans stock est vide, pas inconnu.

**Stock initial** — `reference, emplacement, pieces_par_carton, cartons, pieces`
Génère un mouvement d'entrée de motif `stock_initial` par ligne. `pieces_par_carton` désigne le conditionnement concerné ; facultatif si la référence n'en a qu'un, obligatoire sinon. Refusé si le triplet référence/emplacement/conditionnement porte déjà du stock, avec la liste des lignes en conflit : le stock initial se charge une fois.

### Modèle Excel

Un seul classeur, produit par la même session que l'analyseur qui le lit — sinon un décalage de colonnes est inévitable.

- **Lisez-moi** : légende des couleurs, et le rappel que le fichier reste la source et doit être conservé.
- **Clients** : `client_code`, `nom`.
- **Références** : une ligne par couple référence × conditionnement — deux lignes pour une référence qui en a deux. C'est le contresens le plus probable, à écrire dans le fichier.
- **Stock d'ouverture** : sert de feuille de comptage du vendredi matin.
- **Tarifs** : `code_tarifaire`, `libelle`, `valeur`, `devise`, `unite` (pièce ou carton), `nature` (prix de vente du client, ou prestation facturée par l'entrepôt), `valide_a_partir_de`. **Aucune valeur sans son unité ni sa nature** : un montant seul est inexploitable, et c'est exactement ce qui rendrait la carte thermique impossible à interpréter.
- Pas de feuille Emplacements : le générateur les crée.

**Trois codes couleur en en-tête, pas deux** : obligatoire, facultatif, et *collecté maintenant mais pas encore importé* — dimensions de cartons, `max_par_palette`, `code_tarifaire`, `famille_melange`, feuille Tarifs. Leurs tables n'existent pas ; le classeur leur sert de stockage intermédiaire et reste réimportable. Sans cette troisième couleur, on croira ces données en base.

**Format texte forcé** sur `reference`, `client_code`, `emplacement` et `code_tarifaire` — format de cellule et validation de données, pas seulement une consigne écrite, sinon Excel mange les zéros initiaux.

### Règles communes

- Séparateur `,` ou `;`, détecté automatiquement.
- UTF-8 et **Shift-JIS** acceptés — un export Excel japonais sort en Shift-JIS.
- Codes lus comme du texte : les zéros initiaux doivent survivre.
- Emplacements validés par `^[A-Z]{1,2}-\d{2}-\d$`.
- Prévisualisation avant écriture : lignes valides, lignes rejetées avec numéro de ligne et motif.
- **La propriété exigée est le rejeu idempotent, pas le tout ou rien.** C'est une révision : « tout ou rien » visait à ne jamais laisser un état à moitié connu, mais sur un fichier de trois cents lignes, une coquille ne doit pas bloquer les deux cent quatre-vingt-dix-neuf autres, et ce qui protège réellement est de pouvoir rejouer le fichier sans effet de bord. L'atomicité par ligne est donc acceptée **à condition** que le rejeu soit exactement idempotent.
- Pour les imports qui n'écrivent **aucun mouvement** — clients, références — l'upsert sur clé suffit.
- Pour le **stock d'ouverture**, qui écrit des mouvements, l'idempotence doit être construite : l'`id` du mouvement est **dérivé de façon déterministe** de (lot d'import, référence, emplacement, conditionnement), et l'écriture passe par `upsert(ignoreDuplicates)`. Le même fichier rejoué n'écrit rien de plus, et un import interrompu à mi-course **reprend** au lieu de bloquer. **Le lot est une étiquette saisie par l'utilisateur, pas un hachage du fichier.** Un hachage de contenu protège dans le seul cas où le fichier est rejoué octet pour octet, et échoue dans le cas probable : le jour du comptage, on corrige une cellule, on réexporte, et le hachage change — tout le stock d'ouverture s'écrit alors une seconde fois. Une étiquette du genre `ouverture-2026-09-18`, saisie une fois et rappelée à l'aperçu, reste stable à travers les réexports.

**Corollaire à dire explicitement à l'écran : un réimport ne corrige rien.** Avec des mouvements immuables et un `upsert(ignoreDuplicates)`, une ligne déjà importée sous le même lot est ignorée — y compris si sa quantité a changé dans le fichier. Une correction passe par un mouvement ou une annulation, jamais par un réimport. Sans ce message, l'utilisateur croira sa correction appliquée alors qu'elle a été avalée : c'est le seul scénario où l'import mentirait.
- **Friction proportionnée à l'ampleur du recouvrement.** Quelques triplets déjà pourvus, c'est un chevauchement normal : un avertissement et un appui suffisent. Au-delà d'un tiers des lignes, c'est la signature d'un second chargement complet — l'aperçu doit alors demander de **taper une confirmation** plutôt que d'accepter un appui. Même principe que la confirmation proportionnée au risque du §6.4 : l'ampleur distingue le chevauchement de l'accident.
- Le garde-fou « déjà du stock sur ce triplet » reste, mais comme **avertissement à l'aperçu** et non comme refus global : il attrape le vrai danger, un second chargement depuis un autre fichier ou après de vrais mouvements — ce que l'identifiant déterministe ne voit pas. Un refus global, lui, rendrait impossible la reprise d'un import interrompu.

La saisie manuelle unitaire couvre les mêmes champs, un élément à la fois, pour les ajouts au fil de l'eau.

## 8. Emplacements

Repris de la v1, sans changement.

Code toujours `ZONE-BAIE-NIVEAU` : `A-03-2`. Zone à une lettre pour une allée, deux lettres pour une inter-allée (`AB`, `CD`). Baie sur deux chiffres. Niveau sur un chiffre, `0` au sol ; les inter-allées n'existent qu'au niveau `0`.

**L'ordre de tournée est zone, puis baie, puis niveau, toujours** — on parcourt une baie de bas en haut avant d'avancer. Il n'y a pas d'ordre alternatif.

La possibilité d'imposer un autre parcours par une colonne `ordre` est **retirée de la spec**. Le champ existe en base mais il ne sert qu'à empêcher le générateur en lot de renuméroter des emplacements déjà créés : c'est une séquence de création, pas un parcours. Le faire primer sur zone/baie/niveau a produit le défaut du 16 septembre — les flèches suivaient l'ordre de génération dès qu'une zone était générée en plusieurs appels.

C'est le même défaut que `comptages.statut` : **un champ avec deux significations**. À renommer pour ce qu'il fait — une séquence de création — plutôt qu'à remettre en priorité. Si un parcours non alphabétique devient réellement nécessaire (sens de circulation imposé, allée remontée en sens inverse), il prendra un champ distinct et correctement nommé, à ce moment-là seulement.

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

## Sauvegarde et sécurisation des données

Ce n'est pas un sujet post-pilote : à partir du 18 septembre, la base porte le stock réel d'un client. Perdue en semaine 2, le pilote s'arrête là.

### Ce qui existe aujourd'hui, selon le plan Supabase

- **Plan gratuit : aucune sauvegarde automatique.** La documentation Supabase recommande explicitement des exports réguliers par le CLI et des copies hors site. Si le projet est en Free, il n'existe donc **aucune** sauvegarde à ce jour.
- **Pro (25 $/mois)** : 7 jours de sauvegardes quotidiennes automatiques. PITR — restauration à la seconde près, rétention 7, 14 ou 28 jours — reste une option payante en plus.
- **Mise en pause** : un projet gratuit est mis en pause après 7 jours sans activité. Les données restent intactes et le projet se relance depuis le tableau de bord, avec une fenêtre d'un an au-delà de laquelle les sauvegardes ne sont plus conservées. Sans risque pendant le pilote, qui tourne tous les jours ; le risque naît d'une période creuse — congés, pilote suspendu.

### Risques réels, classés

1. **Propriété du compte.** Projet sous un compte personnel, avec une adresse et un moyen de paiement personnels : la société perd tout le jour du départ, ou à l'expiration de la carte. Coût de la correction : nul. Conséquence : totale. C'est le premier risque, et il n'est pas technique.
2. **Absence de sauvegarde en plan gratuit** — voir ci-dessus.
3. **Migration malheureuse.** Les triggers d'immuabilité protègent les lignes de `mouvements`, pas une table supprimée par une migration. Le risque culmine précisément pendant la migration à quatre volets du chantier de clôture.
4. **Erreur de logique.** Une sauvegarde ne protège pas de ça : un stock faux sauvegardé reste faux. C'est l'inventaire qui couvre ce risque. Les deux dispositifs ne se remplacent pas.

Point favorable : le modèle étant en ajout seul, le scénario classique « quelqu'un a écrasé les données » est largement exclu par conception. La perte réaliste est structurelle ou liée au compte.

### Plan, par ordre de rapport au coût

**Niveau 0 — gratuit, cette semaine, trente minutes.** Vérifier sous quel compte et quelle organisation vit le projet ; le transférer à une organisation Sanyo avec un moyen de paiement de la société. Vérifier le plan en cours.

**Niveau 1 — gratuit, hebdomadaire.** Un `supabase db dump` par le CLI, fichier `.sql` daté, conservé **hors de GitHub** : Drive de la société, ou disque local plus une copie ailleurs. Deux copies au minimum, dont une sur un autre support que le PC.

> **Piège à éviter absolument : le dépôt est public.** Ni dump ni export de stock n'y entrent — et les artefacts GitHub Actions d'un dépôt public sont lisibles par quiconque peut lire le dépôt. Toute automatisation de sauvegarde qui y dépose un fichier revient à publier le stock des clients.

**Prise avant chaque migration**, en plus de l'hebdomadaire. Une ligne dans la procédure du chantier de clôture.

**Niveau 2 — 25 $/mois, à décider au 16 octobre.** Le plan Pro supprime d'un coup l'absence de sauvegarde et la mise en pause. L'arbitrage ne se fait pas contre un budget informatique mais contre la valeur du stock client tenu dans la base : c'est une assurance, pas une dépense d'outillage.

### La règle qui prime sur tout le reste

**Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde.** Restaurer une fois dans un projet Supabase séparé, vérifier que `mouvements` et `comptage_lignes` sont là et cohérents, puis supprimer ce projet. Une fois avant le 16 octobre. Sans cette vérification, le dispositif entier repose sur une hypothèse.

### Après le pilote — modes de saisie

Quatre demandes du 17 septembre : un mode commande, un mode transfert, un mode réception, et des inventaires en parallèle.

**Les trois premiers ne sont pas trois écrans, c'est un écran avec trois préréglages.** Chaque mode se décrit par trois réglages et rien d'autre : le sens du mouvement, le motif par défaut, et **le champ qui reste figé entre deux saisies**. C'est ce dernier qui fait tout le gain, et il diffère selon le mode :

| Mode | Sens | Motif | Champ figé |
|---|---|---|---|
| Commande | sortie | `commande_client` | rien, ou l'emplacement en préparation groupée |
| Réception | entrée | `reception` | la référence, tandis que l'emplacement change |
| Transfert | transfert | — | la destination, tandis que les sources défilent |

Écrire trois écrans séparés les ferait diverger ; un préréglage garde une seule logique de saisie. À concevoir dans cet esprit, pas comme trois chantiers.

**Le champ figé est une case à cocher, pas une propriété du mode.** L'idée du « transfert de masse » généralise : chaque mode offre un verrou sur le champ qui s'y prête — la destination en transfert, la référence en réception — et l'utilisateur décide selon sa session. Une grande réorganisation verrouille la destination ; un remplissage de fin de journée ne verrouille rien. Un seul mécanisme, `verrouiller <champ>`, et la question « destination verrouillée ou simple motif par défaut » n'a plus à être tranchée à l'avance.

Deux conditions pour que le verrou ne devienne pas un piège : il est **visible en permanence** — un bandeau nommant le champ figé et sa valeur, pas une case cochée hors écran — et il **ne survit pas à la sortie du mode**. Un verrou oublié écrit en silence au mauvais endroit, et c'est exactement le type de saisie qu'aucun contrôle ne rattrape.

**Mode commande, tri des emplacements proposés** : niveau le plus bas d'abord, puis plus petite quantité d'abord. Le second critère est le plus utile — vider d'abord la palette entamée consolide le stock et libère un casier, ce qui attaque directement le problème de saturation. Deux précisions : le niveau le plus bas est le **0** dans la numérotation canonique, pas le 1 ; et la liste s'affiche **en entier**, pas en menu déroulant, jusqu'à cinq lignes — sur un téléphone tenu à une main, un déroulant coûte un appui et cache les options.

C'est aussi dans ce mode que vivrait un jour la règle de tri de la liste de prélèvement par classe de volume. Sans objet tant que les commandes sont mono-ligne.

### Après le pilote — requêtes de mapping

**Mapping références → emplacements** (demande de la direction) : c'est exactement la feuille `Stock` de l'export `.xlsx` déjà au calendrier. Aucune fonction à écrire, la demande est satisfaite par l'export.

**Mapping inversé emplacements → références**, avec quantité par référence et total par palette : une seconde feuille du même export. Et c'est le bon préalable à la carte thermique — la table répond à l'essentiel de la question pour une fraction du coût. À construire d'abord, puis à décider si la carte est encore souhaitée. Les scores d'occupation et de rentabilité s'ajoutent en colonnes de cette table avant d'être des couleurs sur un plan.

### Après le pilote — périmètre d'inventaire dérivé des mouvements

Le comptage hebdomadaire porte sur « les références sorties dans la semaine ». Aujourd'hui, cette liste se sélectionne à la main chaque vendredi. Une fois les mouvements enregistrés, elle se calcule : **périmètre = les références ayant eu un mouvement depuis telle date**, ou depuis le dernier inventaire clos.

Extension naturelle du sélecteur de périmètre existant, qui supprime la tâche la plus répétitive du rituel hebdomadaire. À ne construire qu'une fois les mouvements réellement enregistrés — donc après l'amorçage, et pas avant d'avoir vu quelques vendredis se dérouler.

### Après le pilote — inventaires en parallèle

Réouverture assumée de la limite acceptée en §4, l'index `one_inventaire_en_cours`. La contrainte est trop grossière : elle interdit aussi des cas légitimes, REUZEL et YGI n'ayant rien en commun.

**Mais la règle n'est pas « un seul à la fois », c'est « pas deux qui se recouvrent ».** Deux inventaires actifs sur un même casier auraient deux stocks théoriques gelés à des instants différents et deux jeux de lignes de comptage pour le même endroit : les écarts se contrediraient sans qu'on puisse dire lequel a raison. Or « allée A » recouvre REUZEL et YGI, alors que REUZEL et YGI ne se recouvrent pas.

Le remplacement de l'index n'est donc pas sa suppression : c'est un contrôle au lancement contre l'**union des périmètres actifs**, refusant tout chevauchement de casier ou de référence. Plus fin à écrire qu'un index partiel, et c'est la seule forme qui autorise le cas voulu sans ouvrir le cas dangereux.

### Après le pilote — aide au rangement

Analyse du stock, des emplacements sous-exploités et des priorités de sortie, puis **proposition de transferts** pour faciliter la préparation et désencombrer les allées. C'est l'aboutissement de tout le reste : c'est là que la couche analytique paie, et c'est la seule fonction qui attaque directement le problème d'origine — la saturation de l'entrepôt.

Quatre conditions, dans cet ordre.

**Commencer par un rapport, pas par un moteur.** Une liste classée de « casiers à consolider » — palettes entamées d'une même référence, faibles rotations en position basse, références fragmentées sur plusieurs casiers — apporte l'essentiel de la valeur sans aucune logique de décision. Même raisonnement que la table avant la carte : construire le rapport, s'en servir un mois, puis décider si un moteur de propositions est encore souhaité.

**Prérequis de données, déjà identifiés et non réunis** : `max_par_palette` et les dimensions de cartons pour juger le sous-emploi, les familles de mélange pour savoir quoi peut cohabiter, la rotation calculée sur les `mouvements` pour les priorités de sortie. Sans la séance de mesure des cartons, l'analyse n'a pas de dénominateur — elle ne peut pas exister avant.

**Strictement indicatif**, conformément à « l'app ne refuse jamais un fait physique » (§4). Une suggestion qu'on ne peut pas ignorer est une suggestion qu'on finit par contourner, et à partir de là l'outil entier perd sa crédibilité.

**Sortie = une liste de travail, pas une carte.** Chaque proposition est un transfert : source, destination, quantité, raison en une ligne. Cette liste alimente directement le mode transfert avec sa destination verrouillée — les deux idées du 18 septembre sont les deux moitiés d'une même chaîne, l'une propose, l'autre exécute.

### Après le pilote — reprise et maintenance

Question posée le 18 septembre 2026. **À trancher au point de situation, pas avant** : on ne contracte pas la maintenance d'un outil qui peut être abandonné le 16 octobre.

**Ce que coûte une reprise externe** (marché japonais, septembre 2026)

- 保守契約 d'agence : 15 à 20 % du coût de développement par an. Une reprise chiffrée 3 à 5 M¥ donne 40 000 à 85 000 ¥/mois — et l'agence voudra réécrire plutôt que reprendre.
- Freelance en 準委任 : 4 000 à 6 000 ¥/h, soit 64 000 à 80 000 ¥/mois pour un jour par semaine, ou 30 000 à 50 000 ¥/mois pour une simple veille.
- Prise en main : 2 à 5 jours avant la première ligne utile, soit 150 000 à 300 000 ¥ une fois.

**Ce qui abaisse cette facture existe déjà** : `docs/spec.md`, `CLAUDE.md`, le changelog. La spec vaut plus que le code parce qu'elle porte les **raisons** — pourquoi la saisie libre, pourquoi un casier non compté vaut zéro. Un repreneur qui les ignore casse le module d'inventaire en trois semaines.

**Ce que cette app demande réellement** : pas de serveur à patcher, pas de pipeline à surveiller, pas de montée en charge. Quelques heures par trimestre — dépendances npm, comportement de Safari iOS (environ annuel), migrations Postgres. Le reste est de l'évolution, pas de la maintenance, et se facture toujours à part.

**Automatisation — ce qui marche**

Dependabot ou Renovate, plus une CI bloquante (`tsc --noEmit` et `npm run build`) sur chaque PR : une mise à jour cassante n'atteint jamais `main`. Et `anthropics/claude-code-action` pour relire les PR et analyser les échecs de CI. Coût nul sur un dépôt public. Cela couvre l'essentiel de ce qu'un retainer facture.

**Automatisation — ce qui ne marche pas**

Le jugement. Les arbitrages de septembre — `comptages.statut` surchargé, le champ `ordre` promettant un parcours qu'il ne fournissait pas, l'`inputMode` inerte, le « tout ou rien » qu'il fallait remplacer par l'idempotence, le hachage de fichier qui aurait doublé le stock d'ouverture — ont tous été trouvés parce que quelqu'un arbitrait, aucun par relecture de code. Un agent en veille sans arbitre les aurait acceptés.

**À proscrire** : un agent autonome avec accès en écriture sur `main`, dans un dépôt qui porte le stock d'un client. Une régression du module d'inventaire pendant une absence n'apparaîtrait qu'au comptage suivant, sans pouvoir être attribuée. C'est pire que pas de maintenance. L'automatisation propose, elle ne fusionne jamais.

**La veille utile n'est pas celle du code, c'est celle des données.** Une requête hebdomadaire (`pg_cron` plus une Edge Function, sans IA) remontant les positions négatives, les casiers sans mouvement prolongé et les mouvements au motif incohérent. C'est la liste d'anomalies du §6.4, **poussée** au lieu d'être consultée — seul dispositif automatique capable de signaler une dérive avant le comptage.

**Deux points qui ne sont pas techniques**

- **Propriété.** Développée sur le temps de travail, l'app relève du 職務著作 et appartient à Sanyo : c'est donc Sanyo qui budgète la maintenance, pas Julien. À écrire avant tout contrat.
- **Succession.** Aucune automatisation ne règle l'absence de destinataire : une alerte suppose quelqu'un pour la lire et décider. C'est l'argument permanent pour que le registre du stock vive chez un éditeur, et la couche analytique seulement ici.

### Après le pilote — carte thermique de l'entrepôt (version bureau)

Consignée ici pour ne pas être perdue, et parce que deux prérequis se décident tôt. Hors périmètre du pilote : elle ne sert pas son indicateur.

Page bureau représentant les zones, baies et niveaux en grille, avec un code couleur par casier pour cibler visuellement les casiers prioritaires. C'est exactement la couche analytique en lecture seule évoquée depuis le début : si elle tombe, l'entrepôt tourne.

Trois décisions à retenir maintenant :

- **Rotation avant revenu.** La rotation se calcule aujourd'hui avec les seuls `mouvements` : pièces sorties du casier par mois. C'est le bon indicateur de « ce casier mérite-t-il sa place », et l'entrée directe du travail de slotting.
- **Le code tarifaire est la bonne structure** — un code rattaché à plusieurs articles, pour en changer un lot d'un coup. Trois exigences pour qu'il ne se retourne pas contre vous :
  - **Un tarif est daté et immuable**, comme un conditionnement. `tarifs (code_tarifaire, valeur, devise, unite, valide_a_partir_de)`, en ajout seul, et le calcul retient le tarif en vigueur à la date du mouvement. Sans ça, changer un prix réécrit silencieusement le revenu des mois passés, et la carte de septembre ne sera plus la même en novembre.
  - **L'unité est explicite** sur la ligne de tarif — à la pièce ou au carton — puisque les conditionnements diffèrent.
  - **La nature est explicite aussi** : prix de vente du client, ou prestation facturée par l'entrepôt. Ce ne sont pas les mêmes chiffres et ils ne désignent pas les mêmes casiers comme prioritaires. Les garder séparés permet d'afficher l'un ou l'autre ; les mélanger ne produit rien d'interprétable.
- **Le taux d'occupation se dérive de la palettisation**, pas d'une capacité saisie casier par casier : `cartons présents / max_cartons_par_palette`, cumulé sur les références du casier. Cinq cents saisies évitées. Trois précisions :
  - `max_cartons_par_palette` se porte sur le **conditionnement**, pas sur la référence : des cartons de 6 et de 12 pièces n'ont pas les mêmes dimensions, donc pas le même nombre par palette.
  - Un casier vaut **une palette, partout** — palettier, sol et inter-allée. Donc aucun champ de capacité sur `emplacements` : le besoin que j'avais anticipé n'existe pas, et un champ valant toujours 1 est un champ à supprimer.
  - Cette donnée sort gratuitement de la séance de mesure des cartons prévue pour le dossier transport.

- **L'inter-allée ne se mesure pas en volume mais en encombrement**, et la métrique change de grain. Ce qui compte dans une allée n'est pas qu'une palette soit pleine, c'est que le passage soit pris. Une référence y valant en règle générale une palette, l'indicateur est le nombre de positions occupées sur le nombre de positions de la travée — donc un indicateur **par zone**, pas par casier, alors que le palettier se lit casier par casier.

  Conséquence sur les couleurs, et elle est contre-intuitive : **le sens s'inverse.** Un palettier plein est une bonne nouvelle, une inter-allée pleine est un problème de circulation. Deux échelles, deux orientations, à ne surtout pas unifier au nom de la cohérence graphique.

- **Table `cartons`, entité à part.** Le carton physique est référencé par le conditionnement, pas décrit dans celui-ci : le même carton sert souvent plusieurs références.

  ```sql
  cartons (
    id              uuid primary key,
    libelle         text,
    longueur_mm     int not null,
    largeur_mm      int not null,
    hauteur_mm      int not null,
    poids_g         int,
    max_par_palette int not null   -- mesuré, pas calculé
  )
  -- conditionnements.carton_id → cartons(id)
  ```

  ```sql
  -- colonnes complémentaires sur cartons
  debord_mm    int  not null default 0   -- dépassement hors emprise palette
  melangeable  bool not null default true
  gerbable     bool not null default true -- peut-on poser quelque chose dessus
  ```

  **Le volume ne sert pas à mesurer l'occupation.** L'occupation d'un casier est `cartons présents / max_par_palette`, cumulé sur les références présentes. Aucune donnée volumétrique n'y entre, et c'est ce qui la rend valable aussi pour les cartons qui débordent.

  **Un carton en débord n'a pas un mauvais taux de remplissage : il a un problème d'emprise.** Le rapporter au volume de la palette donnerait un pourcentage supérieur à 100, ou un chiffre qui ne veut rien dire. Le débord ne gaspille pas du volume, il prend celui du voisin ou celui de l'allée. Il se signale donc comme un **drapeau et un dépassement en millimètres**, jamais comme un pourcentage — et sur la carte, comme un marqueur sur les casiers adjacents, puisque c'est eux qu'il pénalise.

  L'efficacité structurelle d'un emballage — combien de place une référence gâche quand son casier est plein — est une analyse distincte de l'occupation, et son dénominateur est le **volume utile de l'alvéole**, pas celui de la palette. Cela suppose la hauteur libre par niveau, qui varie sur des palettiers non modulaires. À traiter le jour où cette analyse sera demandée, pas avant.

  `max_par_palette` reste **mesuré** et non calculé : il dépend du schéma de gerbage et de la hauteur disponible, pas seulement du volume.

- **Le mélange se gouverne par familles, pas par paires ni par booléen.** Les exemples réels — matelas entre eux, parcs entre eux mais pas avec les matelas, Reuzel seulement avec Reuzel — décrivent tous la même forme : des groupes fermés. La règle tient en une phrase : **deux références peuvent partager une palette si et seulement si elles appartiennent à la même famille de mélange.**

  ```sql
  familles_melange (
    code    text primary key,   -- 'matelas', 'parcs', 'reuzel'
    libelle text not null
  )
  -- references.famille_melange_code → familles_melange(code)
  ```

  **Cette règle n'interdit rien.** Elle oriente une suggestion de rangement et colore la carte ; elle ne bloque aucune saisie. Un casier de reliquats ou un coin de retours clients contient légitimement un peu de tout, et l'app doit l'enregistrer sans discuter — voir « L'app ne refuse jamais un fait physique ».

  Un seul champ, assigné en lot — par client ou par famille de produits — exactement comme le code tarifaire. Trois cents références se rangent en une poignée de familles, et l'entretien reste linéaire.

  **La famille se porte sur la référence, pas sur le carton.** Les attributs physiques — `debord_mm`, `gerbable`, `melangeable` — décrivent l'objet et restent sur `cartons`. La famille, elle, exprime une règle de cohabitation dont le motif peut être physique (un matelas et un parc ne s'empilent pas) ou commercial (on ne mêle pas le stock d'un client à celui d'un autre). Deux motifs, une seule mécanique.

  `melangeable = false` reste utile à côté : il dit « seul sur la palette », ce qu'une famille d'un seul membre exprimerait mal — elle redeviendrait mélangeable le jour où une deuxième référence la rejoint.

  **La limite du modèle, à connaître.** Il suppose que la compatibilité est une relation d'équivalence : si A va avec B et B avec C, alors A va avec C. Tous les cas cités le respectent. Si un jour A et B sont incompatibles alors que chacun se mélange avec le reste, la réponse est de **scinder en familles plus fines**, pas de construire une matrice — trois cents références en produiraient quarante-cinq mille paires, impossibles à tenir à jour.

  « Mélangeables dans la mesure du raisonnable » n'est pas une donnée : c'est le plafond de quatre références, plus le jugement de l'opérateur. Trois couches qui font chacune un seul travail — la famille dit **avec qui**, le plafond dit **combien**, l'opérateur tranche le reste.

  **Certains casiers sont mixtes par vocation**, et un signal permanent sur eux est un signal qu'on apprend à ignorer — ce qui finit par masquer les vrais. D'où une vocation sur l'emplacement, `standard` par défaut, renseignée pour la poignée d'exceptions :

  ```sql
  -- sur emplacements
  vocation text not null default 'standard'
           check (vocation in ('standard','reliquats','retours'))
  ```

  Sur un casier `reliquats` ou `retours`, le mélange est attendu : aucun signal de fragmentation, et ni la rotation ni l'occupation ne s'y jugent comme ailleurs — un coin de retours plein ne dit pas la même chose qu'un palettier plein.

  Conséquence sur la carte : un casier `standard` portant une référence non mélangeable est **plein dès la première référence**, quel que soit le nombre de cartons. Son occupation est binaire, pas graduée.

  Cette table sert quatre usages pour une seule séance de mesure : la palettisation, le taux d'occupation, l'affectation des références aux niveaux selon la hauteur du carton, et le calcul du palier transporteur par la somme des trois côtés. C'est ce qui rend la mesure des 300 cartons rentable indépendamment de tout logiciel.
- **Ne pas confondre la mesure et la règle.** « Au-delà de quatre références, ne plus proposer d'ajout, sauf si le nombre total d'articles est faible » est une règle de **placement**, pas une mesure d'occupation. Elle relève de la suggestion de rangement, qui n'est pas la carte. Sur la carte, elle s'affiche comme un marqueur distinct — « saturé en nombre de références » — à côté de la jauge de volume, jamais fondu dans la même couleur.

  Cette règle arbitre une tension réelle : les palettes mixtes économisent de l'espace sur les faibles rotations, et dégradent la fiabilité du prélèvement et la vitesse de comptage. Le plafond de quatre est exactement le curseur entre les deux. Le seuil « x articles total » reste à chiffrer.
- **Deux échelles rouge→vert séparées ne disent rien d'actionnable**, parce que « plein » n'est ni bon ni mauvais en soi et que « forte rotation » se juge par rapport à la distance au quai. Le signal utile est le **croisement** : forte occupation et faible rotation, c'est le casier à traiter en premier ; faible occupation et forte rotation, c'est un casier à recharger ou à agrandir. Une vue en quadrants plutôt que deux curseurs indépendants.

Rendu en **grille schématique** dérivée de zone, baie et niveau — pas de plan à l'échelle. Des coordonnées physiques seraient une donnée de plus pour un gain de lisibilité marginal.

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
3. **Modèle Excel et import des références** (§7) — codes en texte, une ligne par couple référence × conditionnement, colonnes de dimensions collectées mais non importées tant que la table `cartons` n'existe pas.
4. **Messages d'erreur lisibles** (§3) — remplacer `(objet Objet)` par le message réel, sur tous les chemins d'écriture. Admis avant le 18 : c'est la différence entre un échec diagnosticable et un mystère le jour du démarrage.
5. **Retirer l'`inputMode` de la saisie d'inventaire** — retour au clavier texte, une ligne.
6. **Retirer les deux indicateurs factices de l'Accueil.** C'est une suppression, pas une fonctionnalité : « Tout est synchronisé » en texte fixe est précisément ce qu'on regardera sans réfléchir pendant le pilote. Ils reviendront branchés avec la file hors ligne.
7. **Rendre le commentaire obligatoire sur le motif `annulation`** (§4), si c'est l'affaire de quelques minutes. Sinon, avec le chantier de clôture.
8. **Générateur d'emplacements** — zone, plage de baies, niveaux, création en lot. Sert la saisie du référentiel avant le démarrage, et **remplace l'import CSV d'emplacements** (§7) : une substitution, pas une addition.
9. **Liste des saisies pendant la marche** (§6.5), **remontée depuis la liste du 18 octobre**. Raison : usage réel imminent — la répétition à blanc et les premiers comptages ont lieu cette semaine, et la double saisie qu'elle supprime pollue directement l'écart. Le reste du chantier de clôture ne bouge pas. Le gain d'une passe d'`advisor()` partagée ne valait pas un mois de comptages sans visibilité sur ce qui a déjà été saisi.
10. **Cache de lecture** (§3) — à faire après les deux précédents, il sert le pilote et non le démarrage.
11. **Recherche par libellé** (§6.2). Ce n'est pas une addition au périmètre : la spec l'exigeait déjà, le code ne cherchait que sur le code. Mise en conformité, et elle sert dès le premier jour — les factures sans référence se lisent vendredi.

### Phase 1 — jusqu'au 16 octobre

Révisé le 18 septembre. L'app est un outil de comptage jusqu'à fin octobre : **tout ce qui concerne le stock cesse d'être urgent**, et seul ce qui sert le comptage hebdomadaire compte. C'est une liste nettement plus courte qu'avant, et c'est voulu.

1. **Abandon d'inventaire** (§6.5). **Échéance ferme : avant le vendredi 25 septembre.** Un comptage a lieu chaque vendredi, celui du 18 est ouvert, et rien ne permet de le fermer — sans l'abandon, le comptage suivant est impossible. Premier point du projet à porter une vraie date.
2. **Inventaire partiel** (§6.5) : suggestions filtrées au périmètre, extension du périmètre proposée pour une référence hors liste, rappel des références à compter. **Échéance : avant le vendredi 25 septembre** — le comptage hebdomadaire est un inventaire partiel. Commencer par vérifier si les saisies hors périmètre existantes sont ignorées par l'écran des écarts : c'est la seule perte de donnée possible du lot.
3. **Écran des écarts** (§6.5) : chiffres sur leur propre ligne à position fixe, barre d'action collante, filtre de recherche. Absorbe les corrections d'ergonomie relevées le 17 septembre — même écran, une seule passe. Utilisé chaque vendredi : ce qui a coûté du temps une fois en coûtera chaque semaine.
4. **Catalogue, noyau seulement** (§6.8) : liste, recherche, modification des attributs descriptifs, suppression si aucun mouvement ni ligne de comptage ne référence la ligne. Remonté en phase 1 contre l'arbitrage précédent : la gêne est immédiate — des références mal saisies encombrent les sélecteurs de chaque comptage hebdomadaire — et la suppression est **plus facile maintenant** qu'après l'amorçage, puisque aucune référence ne porte encore de mouvement. Les champs tarif/dimensions restent en phase 2 ; le drapeau `actif`, lui, est remonté en phase 1 par le point 4 bis.
4 bis. **Drapeau `actif` sur les références** (§6.8). Remonté de la phase 2 le 24 septembre. La suppression du point 4 ne couvre pas le cas réel : une référence de test a été comptée, donc une ligne la référence, donc elle n'est pas supprimable — et abandonner l'inventaire qui la porte ne change rien, l'abandon n'efface pas. Sans archivage, ces références restent dans les sélecteurs de chaque comptage hebdomadaire, indéfiniment. Deux raisons de le faire maintenant plutôt qu'à l'amorçage : la gêne est hebdomadaire, et la règle « désactivation refusée tant que le stock n'est pas nul » est inerte tant qu'aucun stock n'existe — elle s'écrit donc sans avoir à être éprouvée dans le même mouvement. **Commit isolé** : ce point touche les sélecteurs de saisie, il ne se mêle à aucun autre.

5. **Sauvegarde et propriété du compte Supabase** (§ Sauvegarde) — trente minutes, **sans code, côté Julien**. À faire avant le déplacement : c'est là que la mise en pause du plan gratuit se manifestera.
6. **Synthèse imprimable** (§6.5), y compris pour un inventaire en cours avec sa mention de statut. Sert à justifier un comptage auprès des collègues, et à laisser des chiffres lisibles derrière soi pendant une absence.
7. **Sortie du comptage en CSV.** Requête en lecture seule sur `comptage_lignes`, en `distinct on` pour ne retenir que la dernière valeur par casier × référence × conditionnement — sans quoi une correction serait comptée deux fois. Rend cheap la comparaison hebdomadaire avec l'Excel, qui est l'unique mesure de la phase 1.

### Phase 2 — à partir de l'amorçage, fin octobre

8. **Catalogue, compléments** (§6.8) : les champs `code_tarifaire`, `famille_melange` et dimensions quand leurs tables existeront. Le drapeau `actif` est passé en phase 1 (point 4 bis) ; ce qui reste ici est la vérification de sa règle de stock nul, qui n'a rien à éprouver tant qu'aucun stock n'existe.
9. **Fin du blocage sur stock négatif** (§6.4) : avertissement et confirmation à la place du refus, liste d'anomalies, confirmation proportionnée au risque, correction en un geste. Sans objet tant qu'aucun stock n'existe ; nécessaire dès le premier jour où il en existe.
10. **Export `.xlsx`** : l'instrument de comparaison avec l'Excel tenu en parallèle.
11. **Clôture d'inventaire**, dans cet ordre interne : découplage de `comptages.statut` (§6.5) d'abord, puis policy `DELETE` conditionnée (§3), puis couverture, justification des écarts, écriture des `ajustement_inventaire`. Y rattacher l'affichage « vide » face à « non enregistré » dans la Recherche (§6.2), les **mouvements postérieurs au gel**, et la **résolution des écarts compensés** en transfert (§6.5) — c'est une seule conversation. Sans objet en phase 1, où chaque comptage se termine par un abandon.
12. **File d'écriture** et bandeau « n en attente depuis ». Descendue après le test de couverture du 17 septembre : la 4G passe partout dans le bâtiment (§3). Prérequis conservé : le point 7.
13. **Import des dimensions de cartons**, quand la table `cartons` existera. Jusque-là, les colonnes du modèle Excel sont remplies et conservées dans le fichier, qui fait office de stockage intermédiaire et reste réimportable.
14. **Tests unitaires des deux fonctions pures à bugs subtils** : `matchReferences` et la résolution des codes d'emplacement abrégés. Trois appelants chacune, quatre bugs déjà trouvés entre elles, et ce sont les seules parties du code testables sans base ni écran. Un fichier de test qui **importe** la fonction, pas une copie exécutée à part : une copie prouve qu'un extrait fonctionne, pas que le code livré fonctionne, et elle cesse d'être fidèle au premier changement.

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
- **Pas de contrainte d'unicité sur `(inventaire_id, emplacement_code)`.** Coût : deux comptages possibles pour un même casier, lignes réparties entre les deux, écart faux. Vérifié le 17 septembre : aucun doublon en base à ce jour. Conséquence découverte le 19 septembre, qui en relève la portée — la déduplication de la feuille 棚卸確認表 s'appuie sur « un comptage = un casier » pour que sa clé effective soit bien (casier, référence, conditionnement). Ce postulat est aujourd'hui tenu par la discipline, pas par une contrainte : deux comptages sur un même casier produiraient des lignes en double sur un document destiné à être signé. Correction à la migration du chantier de clôture.
- **Ordre des lignes de comptage dépendant de l'horloge du téléphone** (§3). Coût : sur un appareil à la mauvaise date, une correction peut être datée avant l'original et le *latest-wins* retenir la mauvaise valeur. Atténué par l'avertissement de dérive au démarrage. Se referme avec le compteur monotone par appareil, à la migration du chantier de clôture.
- **Création de casier hors file** (§3). Coût : un inventaire neuf est impossible hors réseau, puisque tous ses casiers sont neufs. Acceptable uniquement si la couverture en allée est vérifiée bonne. Correctif sans DDL disponible si elle ne l'est pas : identifiant de casier déterministe.
- **« Supprimer » est un vrai `DELETE` dans un journal en dernière-valeur-gagne.** C'est un générateur de bugs : toute suppression doit raisonner sur l'ensemble des lignes d'un couple casier × référence × conditionnement, pas sur la dernière. Coût : chaque nouvel appelant peut réintroduire le défaut. La réponse structurelle est une **ligne d'absence** — un marqueur, comme l'annulation dans `mouvements` — plutôt qu'une suppression de lignes ; elle rendrait aussi sans objet la question de la policy `DELETE` (§3). Candidate pour la migration du chantier de clôture, qui restructure déjà cette table. Pas avant.
- **« Ajouter » calcule à partir de l'état local, pas du serveur.** Juste tant qu'un seul appareil écrit — l'état local intègre alors la file hors ligne, ce que le serveur ne fait pas — et faux le jour où un deuxième compteur travaille en parallèle : chacun ajouterait à sa propre vue et la dernière écriture écraserait l'autre. Coût aujourd'hui : nul, le pilote est mono-appareil. Ce qui le referme : l'addition faite côté serveur, c'est-à-dire la même fonction Postgres que la ligne suivante — le jour où elle existe, « ajouter » devient un incrément atomique et la question ne se pose plus. À traiter le jour où un deuxième appareil entre dans le périmètre, pas avant, et à traiter **ce jour-là sans faute** : c'est une perte de comptage silencieuse, pas une gêne.
- **Le déplacement d'une saisie n'est pas atomique.** Il écrit au casier cible puis retire l'originale, en deux requêtes : entre les deux, une coupure laisse la saisie en double. Le code nomme cet état dans son message d'erreur et déconseille de relancer, ce qui évite le doublement en cascade mais laisse le doublon. Coût : rare, visible à la comparaison au physique, réparable à la main. La réponse structurelle est une fonction Postgres appelée en `rpc()`, qui fait les deux écritures dans une transaction et supprime la classe d'erreur entière ; elle demande un `create function` passé à la main dans le SQL Editor, comme les trois policies `DELETE`. À grouper avec la migration du chantier de clôture, qui impose déjà un passage manuel — pas un aller-retour pour elle seule.
- **Le rafraîchissement du cache n'est pas attendu par les écrans.** Un écran ouvert juste avant la fin du rafraîchissement rend sur des données périmées quelques instants. Coût : faible, mais trompeur — un ordre de tournée périmé sera imputé à la logique de tri, qui sera innocente. À traiter après le 18, en distinguant bien ce cas du tri lui-même.
- **`ordre` sur `emplacements` est surchargé** : nommé comme un parcours, utilisé comme une séquence de création (§8). À renommer. Coût tant que ce n'est pas fait : quiconque lit le schéma croira qu'un parcours personnalisé existe.
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
