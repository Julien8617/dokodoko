# Jeu de démonstration — conception

> **Destination : `docs/jeu-de-demonstration.md`.** Ce document conçoit le jeu
> de données ; le script de semis committé l'implémente. En cas de divergence
> entre les deux, c'est ce document qui dit ce qui était voulu, et le script
> qu'il faut corriger.
>
> **Toutes les données décrites ici sont fictives.** Clients, références,
> libellés : inventés. Aucune ne provient d'un entrepôt réel.
>
> **Révision du 6 octobre, seconde passe.** Le §10 gagne une **annexe de
> mise en scène** : sur une démonstration sur papier, la feuille *est*
> l'entrepôt, donc une référence absente de la feuille n'existe pas et le fait
> 5 ne se déclenchait jamais. Trouvé par Claude Code. Et `VRN006` en `C-03-1`
> porte **6 cartons**, la valeur du script, non 15 — chiffre que j'avais
> recopié de l'ancienne adresse du fait 5 sans le vérifier.
>
> **Révision du 6 octobre.** Quatre corrections, toutes relevées par Claude
> Code en écrivant le script. Le **fait 3 est inversé** — la base dit moins
> que le physique, pas plus : dans l'autre sens, aucune position négative
> n'était possible et le commentaire du §6 était faux. Le **fait 5 déménage**
> en `C-03-1` sur `VRN006`, où l'opérateur est déjà. Le §3 ne prétend plus que
> deux faits utilisent les inter-allées — un seul le fait. Le §7 ne promet plus
> un `annule_mouvement_id` que l'app ne sait pas écrire. Les comptes réels du
> script remplacent les approximations. Et le §10, la feuille de comptage,
> n'existait pas : c'est désormais la pièce qui conditionne l'étape 8.3 de
> `docs/base-neuve.md`.
>
> **Révision du 5 octobre, au soir.** Trois corrections, relevées par Claude
> Code à la lecture : le fait 5 ne se démontre que sur un périmètre **par
> références** (§6) ; le fait 4 porte désormais un casier nommé, `C-04-2`
> (§5 et §6) ; et `VRN005` est dispersée sur `C-01-1`, `C-03-1` et `AB-02-0`
> — la version initiale citait `C-01-2` puis se contredisait deux lignes plus
> bas.

## 1. À quoi sert ce jeu de données

Pas à remplir la base. À **démontrer en cinq minutes les quatre choses que
l'app fait et qu'un tableur ne fait pas** :

1. le stock est un journal, pas une colonne — on voit d'où vient chaque chiffre ;
2. une référence vit dans plusieurs casiers, et un casier porte plusieurs références ;
3. le carton n'est pas une unité — il dépend du conditionnement, et deux conditionnements coexistent le temps d'un écoulement ;
4. **l'inventaire révèle les écarts au lieu de les présumer** — et notamment celui qu'une liste de casiers attendus ne peut pas trouver.

Règle de conception qui découle : **chaque fait planté sert une de ces quatre
démonstrations.** Une donnée qui ne démontre rien est du bruit, et le bruit
fait croire au visiteur qu'on n'a pas fini. Inversement, une base vide ne
démontre rien du tout.

**Le jeu ne contient aucun inventaire.** Un inventaire ouvert bloquerait celui
que le visiteur va lancer — c'est tout l'intérêt de la démonstration. Les
écarts sont **plantés dans l'écart entre la base et une feuille de comptage
papier** (§6), pas enregistrés.

## 2. La fiction

Un entrepôt sous douane au Japon, qui stocke et réexpédie les produits de
sociétés étrangères. Trois clients, trois familles de produits — assez pour
que « inventaire par client » ait un sens, assez peu pour que la base reste
lisible.

| Code | Nom | Activité | Préfixe des références |
|---|---|---|---|
| `VERNALIS` | Vernalis | Soins et cosmétiques | `VRN` |
| `MIRAVEL` | Miravel | Literie et mobilier d'appoint | `MRV` |
| `KALISTE` | Kaliste | Épicerie fine | `KLS` |

Trois familles très différentes en **volume par carton** — du baume à lèvres
à 60 par carton au matelas à 1 — ce qui rend visible, sans l'expliquer, que
la pièce est l'unité canonique et le carton une convention.

## 3. Emplacements — par le générateur, pas par un fichier

75 emplacements, créés par le générateur en lot (ce qui le démontre au passage) :

| Zone | Baies | Niveaux | Nombre | Usage |
|---|---|---|---|---|
| `A` | 01 → 12 | 1 → 3 | 36 | Rack palettes, volumes |
| `B` | 01 → 08 | 1 → 3 | 24 | Rack palettes, mixte |
| `C` | 01 → 06 | 1 → 2 | 12 | Picking, accès facile |
| `AB`, `BC` | 01 → 02 / 01 | 0 | 3 | Inter-allées, débord au sol |

Les trois inter-allées ne sont pas décoratives : ce sont les emplacements où
une palette finit quand le rack est plein, c'est-à-dire exactement là où le
stock théorique ne l'attend pas. Chacune a un rôle distinct, et la version
initiale de ce document prétendait à tort que deux des cinq faits les
utilisaient :

- **`AB-01-0`** porte le **fait 1**, la palette déplacée. C'est la seule
  inter-allée qui porte un fait planté.
- **`AB-02-0`** porte un tiers de `VRN005` — pas un fait planté, mais la
  dispersion la plus parlante du jeu : une référence de picking qui débord
  au sol.
- **`BC-01-0`** est **vide, délibérément.** Un emplacement sans stock est vide,
  pas inconnu (spec §7), et la Recherche doit savoir répondre « rien » à
  « qu'y a-t-il dans `BC-01-0` ? ». C'est une réponse, pas une absence de
  réponse — et c'est le seul endroit du jeu qui le démontre.

## 4. Références et conditionnements

24 références. Deux inactives, deux à double conditionnement.

**Vernalis — soins et cosmétiques**

| Code | Libellé | Pièces / carton |
|---|---|---|
| `VRN001` | Shampooing argile douce 250 ml | 12 |
| `VRN002` | Après-shampooing karité 200 ml | 12 |
| `VRN003` | Savon de Marseille 300 g | 24 |
| `VRN004` | Huile capillaire 100 ml | **24 (à écouler) et 12 (actuel)** |
| `VRN005` | Crème mains lavande 75 ml | 36 |
| `VRN006` | Baume à lèvres 15 ml | 60 |
| `VRN007` | Eau florale de rose 200 ml | 12 |
| `VRN008` | Gel douche agrumes 500 ml | 6 |
| `VRN009` | Masque argile verte 150 ml | 12 — **inactive**, fin de gamme |
| `VRN010` | Coffret découverte 4 pièces | 8 |

**Miravel — literie et mobilier d'appoint**

| Code | Libellé | Pièces / carton |
|---|---|---|
| `MRV001` | Matelas bébé 60×120 | 1 |
| `MRV002` | Matelas bébé 70×140 | 1 |
| `MRV003` | Surmatelas coton 60×120 | 2 |
| `MRV004` | Parc pliant hexagonal | 1 |
| `MRV005` | Tapis d'éveil matelassé | 4 |
| `MRV006` | Gigoteuse 6-18 mois | 10 |
| `MRV007` | Tour de lit tressé | 6 |
| `MRV008` | Drap-housse 60×120, lot de 2 | 12 — **inactive**, code créé en double |

**Kaliste — épicerie fine**

| Code | Libellé | Pièces / carton |
|---|---|---|
| `KLS001` | Confiture d'abricot 370 g | 12 |
| `KLS002` | Miel de châtaignier 500 g | 6 |
| `KLS003` | Huile d'olive vierge extra 750 ml | 6 |
| `KLS004` | Terrine de campagne 180 g | **24 (à écouler) et 12 (actuel)** |
| `KLS005` | Sel de Guérande 1 kg | 10 |
| `KLS006` | Biscuits sablés 150 g | 20 |

**Les deux inactives ne sont pas interchangeables, et c'est voulu.** `VRN009`
est une fin de gamme — une désactivation légitime. `MRV008` est un code créé
par erreur en double d'une autre référence — une désactivation de nettoyage.
Les deux raisons existent en entrepôt, et c'est la seconde qui justifie que
le drapeau existe au lieu d'une suppression. Les deux sont à **stock nul** :
l'invariant du drapeau doit être vrai dès le semis, sinon il est faux pour
toujours.

**Les deux doubles conditionnements portent du stock sur les deux à la fois.**
C'est le point de la règle d'écoulement : `VRN004` a 7 cartons de 24 et
11 cartons de 12 dans deux casiers différents, soit 300 pièces, et aucun
écran ne doit afficher « 18 cartons ». C'est la démonstration la plus rapide
que le carton n'est pas une unité.

**Familles de mélange** — la table n'existe pas encore (spec §10). Les
familles sont néanmoins fixées ici pour que le jour où elle existe, le jeu
n'ait pas à être repensé : `cosmetique` (VRN), `literie` (MRV001→005),
`textile` (MRV006→008), `alimentaire` (KLS). La règle plausible qu'elles
servent à démontrer : l'alimentaire ne partage pas de palette avec le
cosmétique.

## 5. Stock et dispersion

18 des 24 références portent du stock, sur **24 casiers occupés** — chiffre
du script, qui remplace l'approximation de la version initiale. Trois faits à planter explicitement, parce qu'ils sont la
démonstration 2 :

- **`VRN005` dans trois casiers** — `C-01-1`, `C-03-1` et `AB-02-0`. Une
  référence dispersée est le cas normal, et c'est pourquoi aucun indicateur
  d'avancement par référence n'est possible pendant un inventaire (spec §6.5).
- **`B-05-1` porte `KLS002` et `KLS003`** — mélange légitime, même famille.
- **`C-03-1` porte `VRN005` et `VRN006`** — idem côté cosmétique, et c'est
  l'un des trois casiers de `VRN005` : un casier mixte *et* une référence
  dispersée se croisent au même endroit, ce qui est le cas réel que les écrans
  doivent rendre lisible.
- **`MRV004` seul sur `A-10-1` et `A-10-2`** — les parcs occupent deux niveaux
  entiers, personne ne mélange rien avec eux.

Les 6 références sans stock : les deux inactives — `VRN009` et `MRV008` —,
plus quatre actives à zéro : **`VRN007`, `VRN008`, `MRV003`, `KLS005`**,
choisies par le script et ratifiées ici. Une référence active à stock nul est
un cas courant — en rupture, pas abandonnée — et c'est le cas qu'une saisie à
zéro pendant un inventaire confirme sans la réactiver.

**`VRN009` garde un casier, et c'est `C-04-2`.** Une référence à stock nul
n'est nulle part, ce qui ne donne rien à vérifier ni à contrôler — trou
relevé par Claude Code. Le journal lui donne donc une vie complète : entrée
au lot d'ouverture sur `C-04-2`, deux sorties qui l'épuisent, puis la
désactivation. Son théorique sur `C-04-2` est nul, le casier existe, et le
visiteur a un endroit précis où aller constater le vide. C'est au passage la
seule référence du jeu dont le journal raconte un cycle entier — reçue,
vendue, épuisée, retirée —, ce qui démontre mieux que n'importe quel écran
que le stock est un journal.

## 6. Les cinq faits plantés, et la feuille de comptage

C'est le cœur du jeu. Le script ne plante rien dans la base pour ces faits —
il plante un **stock théorique**, et la divergence vit dans une feuille de
comptage fictive qu'on remet au visiteur. Il compte, il saisit, l'app révèle.
La feuille elle-même est traitée au **§10** : elle ne s'écrit pas à la main.

| # | Référence | Ce que la base dit | Ce que la feuille dit | Ce que l'app doit révéler |
|---|---|---|---|---|
| 1 | `MRV002` | 18 cartons en `A-07-2` | 18 cartons en `AB-01-0` | **Déplacement probable** : écart net nul, casiers différents |
| 2 | `VRN003` | 40 cartons en `B-03-1` | 34 cartons | **Manque de 6 cartons** (144 pièces) |
| 3 | `KLS001` | **12** cartons en `C-02-1` | **21** cartons | **Surplus de 9 cartons** (108 pièces) que la base ignorait |
| 4 | `VRN009` | 0 sur `C-04-2` | `C-04-2` vérifié, vide | **Rien** — l'absence est confirmée, la référence reste inactive |
| 5 | `VRN006` | 6 cartons en `C-03-1` | 6 cartons | **Question d'extension de périmètre** — uniquement sur un inventaire **par références** |

**Chacun a une cause racontable, et c'est la cause qui fait la démonstration :**

1. Rack A plein un jour de réception : la palette a été posée dans
   l'inter-allée, et personne n'a saisi le transfert. **Aucune liste de casiers
   attendus ne peut trouver ça** — c'est l'argument qui a décidé de la saisie
   libre en marchant, et le seul fait planté qui le démontre.
2. Une sortie partie sans saisie. L'écart est un vrai manque : la marchandise
   n'est pas là, et le tableur ne l'aurait jamais su.
3. Une transposition à la réception, trois semaines plus tôt : **21 cartons
   arrivés, 12 saisis.** Neuf cartons sont sur l'étagère sans exister dans la
   base.

   **Le sens compte, et il était inversé dans les deux versions précédentes de
   ce document.** Relevé par Claude Code le 6 octobre : avec une base qui dit
   *plus* que le physique, aucune sortie plafonnée par le solde enregistré ne
   peut faire passer la base en négatif — l'erreur se manifeste en bout de
   course par « je ne trouve pas la marchandise », pas par une position
   négative. C'est l'autre sens qui produit le cas de la spec §4 : la base dit
   12, l'étagère en porte 21, et une sortie légitime de 15 est **refusée** —
   un fait physique refusé, au pire moment, en allée. Fait 3 est donc inversé.

   Conséquence à ne pas mettre dans la démonstration pour l'instant : cette
   sortie refusée est démontrable dès aujourd'hui, et ce serait montrer une
   dette à un visiteur. Elle devient la démonstration de la liste d'anomalies
   le jour où le §12 point 6 est livré — avertir au lieu de refuser. D'ici là,
   le fait 3 ne sert qu'à produire un écart, et c'est déjà beaucoup : l'app
   trouve neuf cartons que personne ne savait avoir.
4. Le contre-exemple, et il est indispensable : sans lui, le visiteur conclut
   que l'app crie à l'écart dès qu'on la regarde.
5. Le cas de l'opérateur consciencieux qui trouve, dans son allée, une
   référence qui n'est pas dans sa liste. **Déplacé le 6 octobre de `KLS006` en
   `B-07-1` vers `VRN006` en `C-03-1`**, sur une question de Claude Code à
   propos de ce casier. La mise en scène est meilleure : `C-03-1` contient
   `VRN005`, qui *est* au périmètre de la démonstration 1 — l'opérateur y est
   donc déjà, et il voit `VRN006` à côté. Envoyer quelqu'un en `B-07-1` pour un
   casier qui n'est pas sur sa feuille était artificiel. `KLS006` garde son
   stock en `B-07-1` et son rôle dans la démonstration 2.

**Le fait 5 ne se démontre que sur un périmètre par références, et ce n'est
pas un détail de mise en scène.** Correction du 5 octobre : la version
initiale de ce document le faisait porter sur un inventaire `VERNALIS`, où la
question d'extension **n'existe pas** — c'est le trou mis en file derrière la
clôture d'inventaire (spec §6.5). J'avais conçu une vitrine autour d'une
fonction que je venais moi-même de reporter. Relevé par Claude Code avant
l'écriture du script.

Les deux autres sorties possibles ont été écartées. Montrer « ce que l'app
fait aujourd'hui » reviendrait à mettre en vitrine un silence. Et avancer le
chantier pour les besoins de la démonstration inverserait l'ordre : le §12 ne
retient un chantier que s'il rend l'app compréhensible ou utilisable par
quelqu'un d'autre, pas parce qu'une démonstration en a besoin — et toucher le
module Inventaire juste avant de monter une base neuve ferait changer deux
choses à la fois.

**La démonstration produit en revanche un argument pour ce chantier, et il
faut l'inscrire** : un visiteur qui lance un inventaire par client et tape le
code d'une référence d'un autre client n'obtient aucune question. Ce n'est
plus une hypothèse d'architecte, c'est quelque chose qu'on peut voir. Le
chantier reste derrière la clôture, mais il passe devant le reste de la file.

**Le mode opératoire découle de la table, et il exerce les trois genres de
périmètre** — ce que la version initiale ne faisait pas :

1. **Inventaire par références**, sur `VRN003`, `VRN005` et `MRV002` → révèle
   les faits **1, 2 et 5**. C'est la démonstration principale : les trois
   choses les plus convaincantes en une seule tournée, dont la palette
   déplacée. À montrer en premier.
2. **Inventaire par client**, sur `VERNALIS` → révèle les faits **2 et 4**, et
   démontre le périmètre par ce qu'il **ne** demande pas : `KLS006` est
   physiquement dans l'allée, en `B-07-1`, et n'apparaît pas au rappel.
   `VRN009`, inactive, y apparaît en revanche — aucun périmètre ne filtre les
   inactives (spec §6.8), et c'est volontaire.
3. **Inventaire `Tout`** → révèle les faits **1 à 4**. Pas le 5 : tout est
   dans le périmètre, il n'y a rien à étendre. C'est le mode exhaustif, celui
   qui amorcerait un stock d'ouverture.

## 7. L'historique des mouvements

Le stock ne doit pas être un bloc de `stock_initial` : un journal d'une seule
ligne par casier ne démontre pas qu'il y a un journal.

- **Un lot d'ouverture** à J−90, étiquette `ouverture-demo`, qui pose la
  majeure partie du stock.
- **25 mouvements postérieurs** répartis sur les douze semaines suivantes —
  chiffre du script : entrées de réapprovisionnement, sorties de commande,
  trois transferts dont un vers une inter-allée. Motifs variés, jamais un seul
  motif partout. Avec les 22 du lot d'ouverture, 47 en tout.
- **Une annulation**, de motif `annulation` et avec son commentaire — qui est
  obligatoire sur une annulation. C'est la seule démonstration de la règle
  « une erreur se corrige par un mouvement inverse, qui laisse une trace ».

  **`annule_mouvement_id` reste nul, et c'est juste.** La version initiale de
  ce document demandait de le renseigner ; Claude Code a refusé, avec le bon
  argument : l'écran Mouvement ne renseigne jamais cette colonne aujourd'hui
  (dette assumée, spec §14), et l'écrire ici poserait en base un état que
  l'app ne sait pas produire — exactement ce que `docs/base-neuve.md` refuse
  pour la clôture. La démonstration tient quand même : le journal montre le
  mouvement inverse et son commentaire. C'est le **lien structurel** qui
  manque, pas la trace. Le jour où la dette se referme, le semis pose le lien.
- **Les quatre derniers mouvements dans les cinq derniers jours.** Un entrepôt
  dont le dernier mouvement date de huit mois dit « projet abandonné », et
  c'est la première chose qu'un visiteur voit sur l'accueil.

**Les dates sont relatives à la date d'exécution du script, jamais écrites en
dur.** J−90, J−62, J−3. Sans quoi la base vieillit sur l'étagère et la
démonstration se dégrade toute seule. Conséquence assumée : deux exécutions à
deux dates donnent des horodatages différents. L'invariant du jeu porte sur
les **quantités**, pas sur les instants.

**Aucune position négative n'est plantée**, et ce n'est pas un choix : les
policies refusent aujourd'hui une sortie supérieure au stock. La
démonstration de la liste d'anomalies arrive donc avec le §12 point 6, pas
avant. À ce moment-là, le fait 3 est exactement le terrain pour la planter.

## 8. Ce que le script doit vérifier sur lui-même

Même règle que le script de sauvegarde : **un script qui ne vérifie pas son
propre résultat ne protège de rien.** Après écriture, le script contrôle et
refuse de se déclarer réussi si l'un échoue :

1. le stock de chaque référence **inactive** est nul — sinon l'invariant du
   drapeau est faux dès la naissance de la base ;
2. **aucune position négative**, sur aucun triplet ;
3. la somme des mouvements par (référence, emplacement, conditionnement)
   **égale une table de stock attendue écrite en dur dans le script** — c'est
   le seul contrôle qui attrape une erreur de quantité, et il doit être écrit
   à la main, pas calculé depuis les mêmes données ;
4. les cinq faits du §6 sont vérifiés **nommément**, un contrôle chacun : ils
   sont la raison d'être du jeu, et une erreur sur l'un d'eux ruine la
   démonstration sans rien casser de visible ;
5. chaque emplacement cité existe, et les comptes par table sont ceux
   attendus : 3 clients, 24 références, 26 conditionnements, 75 emplacements.

## 9. Règles de tenue

- **Le script est committé, et c'est la seule façon de modifier le jeu.** Une
  retouche à la main dans l'éditeur SQL est invisible au dépôt, donc perdue au
  prochain remontage de la base — et elle casse silencieusement les contrôles
  du §8.
- **Rejeu idempotent.** Deuxième exécution : rien de plus écrit. Les `id` de
  mouvement sont dérivés du lot et du triplet, comme pour l'import de stock
  d'ouverture (spec §7).
- **Les données ne portent aucun nom réel**, et c'est à ce passage que les
  derniers codes réels sortent des fichiers vivants du dépôt : les exemples de
  `src/changelog.ts`, des trois fichiers d'internationalisation, de
  `src/lib/db.ts`, `Inventory.tsx` et `Search.tsx` prennent des codes de ce
  jeu. La migration qui insérait un client de démonstration perd ses données :
  un jeu de démonstration se peuple par son script, jamais par une migration
  de schéma.
- **La liste blanche n'est pas dans le jeu.** Elle contient des adresses
  e-mail réelles ; elle se peuple à la main, hors dépôt.

## 10. La feuille de comptage — générée, jamais écrite à la main

C'est la pièce qui manquait, et elle conditionne l'étape 8.3 de
`docs/base-neuve.md` : sans elle, il n'y a pas de démonstration.

**Elle doit être exhaustive sur le périmètre, casier par casier.** Observation
de Claude Code, et elle est décisive : la règle « un casier théorique jamais
compté vaut zéro » veut dire qu'une feuille qui ne donnerait des chiffres que
là où un fait est planté produirait un **écart fantôme sur tout le reste** —
le visiteur ne compterait que ce qui est écrit, et l'app annoncerait la
disparition de tout ce qui ne l'était pas. Une démonstration qui crie à la
catastrophe devant un prospect est pire que pas de démonstration.

**Elle est produite par une requête committée contre la base semée, pas
rédigée.** La raison est celle qui revient dans tout ce projet : une feuille
écrite à la main serait une **quatrième adresse** portant les mêmes chiffres —
après le document, le script, et la base — et la première retouche du semis la
rendrait fausse sans que rien ne le signale. Générée, elle ne peut pas
divulguer ; on la régénère après chaque changement du semis.

**Les trois divergences sont appliquées par la requête**, depuis une petite
table de substitutions déclarée en tête : `(référence, casier source, casier
feuille, cartons feuille)`. Déclarées une fois, visibles en haut du fichier,
impossibles à oublier — et c'est le seul endroit du dispositif où la feuille
s'écarte de la base.

| Référence | Base | Feuille |
|---|---|---|
| `MRV002` | 18 cartons en `A-07-2` | 18 cartons en `AB-01-0` |
| `VRN003` | 40 cartons en `B-03-1` | 34 cartons en `B-03-1` |
| `KLS001` | 12 cartons en `C-02-1` | 21 cartons en `C-02-1` |

**Colonnes, et aucune n'est décorative :** casier, code, libellé, **pièces par
carton**, cartons, total pièces. La colonne du conditionnement est celle qui
coûterait le plus cher à omettre : `VRN004` et `KLS004` ont deux
conditionnements, et le visiteur doit savoir lequel il compte. Les deux lignes
« 7 cartons de 24 » et « 11 cartons de 12 » sont exactement ce qui rend
lisible le « 300 pièces » affiché par l'app.

**Une feuille par périmètre, et la feuille à cocher ne porte que les
références du périmètre.** Pour la démonstration 1, celles de `VRN003`,
`VRN005` et `MRV002` — y compris les trois casiers de `VRN005`, dont
`AB-02-0`.

**Mais elle porte une annexe, et sans elle le fait 5 ne se déclenche jamais.**
Trouvé par Claude Code le 6 octobre, et c'est le défaut le plus intéressant du
jeu, parce qu'il vient d'une règle juste appliquée au mauvais monde. Sur une
feuille de comptage réelle, « ne porter que le périmètre » est correct : ce qui
est sur l'étagère existe indépendamment du papier. **En démonstration, il n'y a
pas d'étagère** — la feuille est le seul rayon que le visiteur voit. Une
référence absente de la feuille n'existe pas, donc personne ne tape jamais le
code de `VRN006`, donc la question d'extension ne se pose jamais.

La feuille joue donc deux rôles qu'un entrepôt sépare : **la consigne de
comptage** et **la réalité physique**. Il faut les séparer sur le papier
aussi, en deux blocs qu'on ne peut pas confondre :

1. **La feuille à cocher** — le périmètre, casier par casier, cases en tête de
   ligne. C'est la seule partie qui se compte.
2. **« Vous voyez aussi, dans les mêmes casiers »** — les références **hors
   périmètre** qui ont du stock dans un casier que la tournée visite, avec
   leurs quantités. Pas de cases à cocher, titre explicite, bloc séparé. Elle
   tient la place du monde physique que le papier ne peut pas montrer.

Pour la démonstration 1, l'annexe porte `VRN006` en `C-03-1`, 6 cartons — et
c'est la ligne qui fait exister le fait 5. **Elle se calcule, elle ne s'écrit
pas** : les références ayant du stock dans les casiers touchés par le
périmètre, moins le périmètre. La même requête produit les deux blocs, depuis
les mêmes données, et la règle « la feuille à cocher ne porte que le
périmètre » reste intacte.

Les deux autres sorties envisagées sont écartées. Une **ligne de données** sur
la feuille à cocher serait le contraire de la leçon : le visiteur compterait
`VRN006` comme s'il était au périmètre. Une **consigne verbale** de
l'animateur ne vit nulle part, et rien dans ce projet ne vit dans une
conversation.

**Mise en forme : un document d'une page par périmètre**, cases à cocher en
tête de ligne, trié par casier puis par référence — l'ordre de la tournée, qui
est le bon ici parce que le visiteur marche. Ce n'est pas la feuille de
contre-validation de l'app, qui imprime ce que la base contient : ce document
dit ce que l'**étagère** contient, et c'est tout l'intérêt qu'ils ne
coïncident pas.
