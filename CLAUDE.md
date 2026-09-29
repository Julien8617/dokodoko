# CLAUDE.md

Instructions pour toute session Claude Code travaillant sur ce dépôt.
`README.md` dit où on en est. Ce fichier dit comment travailler.
`docs/spec.md` dit ce qui est dans le périmètre et ce qui n'y est pas —
lire les trois au début de session.

## Le périmètre est fixé par la spec, pas par la conversation

`docs/spec.md` est la **référence de périmètre**, rédigée par l'agent
d'architecture — Claude Code (coder) ne l'écrit ni ne la reformule.

- Une fonctionnalité absente de la spec ne s'implémente pas, même si elle
  paraît évidente, même si elle est demandée en cours de session. Elle se
  propose, elle s'inscrit dans la spec, puis elle s'implémente — dans cet
  ordre.
- Un écart assumé par rapport à la spec se répercute dans la spec, au
  même commit, avec sa raison en une phrase.
- En cas de contradiction entre la spec et une instruction donnée en
  session : le signaler et demander l'arbitrage, ne pas trancher seul.

## Remonter une instruction de session dans le code sans attendre l'arbitrage

Un coder peut remonter une instruction reçue en session (ou un
correctif trouvé par `advisor()`) directement dans le code, sans
attendre l'arbitrage de l'agent d'architecture, seulement quand les
trois conditions suivantes tiennent **ensemble** :

1. **Écrite dans la spec** — la règle invoquée est déjà générale dans
   `docs/spec.md`, pas déduite ou étendue pour l'occasion.
2. **Risque actif maintenant** — pas une amélioration théorique, un
   défaut qui peut se produire dans l'usage courant de l'app en l'état.
3. **Correction contenue** — la portée du changement est cernée
   (une fonction, un écran, un chemin nommé), pas un refactor ouvert.

Si les trois tiennent : corriger, puis signaler ce qui a été fait et
pourquoi (règle générale et non règle d'écran, risque, portée). Si une
seule manque : signaler et attendre — ne pas trancher seul. Confirmé le
2026-09-24 sur le correctif de collision de déplacement dans l'écran
Écarts (règle 2.62 §6.5 sur l'opération, pas sur un écran ; risque actif
avant le comptage hebdomadaire ; correction limitée à `startMove`/
`validateMoveTarget`/`confirmMove`).

## Hors périmètre — ne pas implémenter

Préparation de commande, réapprovisionnement automatique, seuils et
alertes, optimisation de route de picking, étiquettes transporteur,
multi-utilisateur simultané, RFID, séparation multi-locataire par client,
facturation.

La dimension client existe uniquement comme rattachement sur la
référence, pour filtrer un périmètre d'inventaire et une recherche —
jamais comme séparation d'accès entre clients.

## Priorité jusqu'au point de situation du 18 octobre 2026

Le démarrage du pilote (18 septembre 2026) n'est bloqué par aucun de ces
chantiers — l'app se lance en l'état :
- **Stock d'ouverture** REUZEL/A/B/C : saisi à la main en mouvements
  `stock_initial`, une session, qui sert aussi de premier comptage
  physique. Pas d'import en masse pour ça.
- **Repli papier** : un échec d'écriture doit être visible à l'écran
  (jamais avalé en silence — c'est le seul défaut capable de fausser
  l'indicateur du pilote sans laisser de trace) ; la consigne de repli
  est dans `README.md`.

Ensuite, dans cet ordre, et rien d'autre avant le point de situation
(ordre révisé le 2026-09-16 — voir raison du point 2 ci-dessous) :

1. **Cache de lecture** (§3, `src/lib/referentielCache.ts`) — fait. Sans
   lui, hors réseau, aucun référentiel n'est disponible et il n'y a rien à
   saisir. Portée volontairement étroite : referentiels + instantané de
   stock informatif, jamais `getStock` (vérification bloquante d'une
   sortie) ni le théorique figé d'un inventaire, qui doivent rester exacts
   donc réseau.
2. **Fin du blocage sur stock négatif** (§6.4 : avertir plutôt que
   refuser). Promu avant la file — pas seulement une histoire de
   confirmation en conditions réelles : si `getStock` reste un verrou
   réseau, une sortie hors ligne échoue avant même d'atteindre l'écriture,
   donc la file d'écriture n'aurait rien à mettre en file tant que ce
   blocage existe. C'est un prérequis, pas une suite.
3. **File hors ligne** et bandeau « n en attente ».
4. Export `.xlsx`
5. Justification et clôture d'inventaire — **un seul chantier**
   regroupant :
   - couverture de casiers exigée pour clôturer (voir nuance ci-dessous)
   - mouvements postérieurs au gel affichés sur l'écran des écarts
   - résolution d'une paire détectée comme compensée (voir Module
     Inventaire) : la clôture écrit un **transfert** (deux mouvements,
     même `transfert_id`, somme nulle), jamais deux
     `ajustement_inventaire` — sinon une palette simplement déplacée
     gonfle à tort les statistiques d'écart de fin de pilote, qui sont
     l'indicateur du pilote
6. Synthèse imprimable

**Repoussé** : imports en masse (références/emplacements/stock en CSV).
Fonction de passage à l'échelle, pas nécessaire tant que le périmètre
reste REUZEL/A/B/C — revient si le pilote s'étend.

## Contraintes qui ne se négocient pas

- **Jamais Railway** — hébergement 100 % Supabase + GitHub Pages.
- **Jamais d'écrasement silencieux d'une donnée liée à l'audit**
  (`mouvements`, `comptage_lignes`) — ces tables sont append-only par
  design (triggers d'immutabilité sur `mouvements` ; `comptage_lignes`
  n'a jamais d'UPDATE, seule la ligne au `ts` le plus récent par clé
  compte). Une correction s'exprime toujours par une nouvelle ligne, pas
  par une modification en place.
- **RLS et sécurité se vérifient empiriquement**, jamais par lecture de
  policy seule — requête réelle en tant qu'utilisateur non autorisé,
  `get_advisors`, logs d'auth. Voir `supabase/README.md`.
- **Mise à jour PWA jamais totalement silencieuse** — le service worker
  doit continuer à proposer un bandeau explicite plutôt que de recharger
  sans prévenir.
- **i18n fr/ja/en obligatoire, à la compilation.** `fr` (`src/i18n/fr.ts`)
  sert de type de référence (`Dictionary` dans `src/i18n/types.ts`) : une
  clé ajoutée doit exister dans les trois fichiers, sinon `tsc` échoue.
  Ne jamais ajouter une clé dans un seul fichier « pour tester ».
- **Âges en relatif, gestes en absolu.** `formatRelativeTime` (âge d'un
  état : cache de lecture, file hors ligne à venir) jamais pour le journal
  des `mouvements`, où l'heure exacte du geste est l'information et ne
  doit pas s'effacer derrière un « il y a 2 h » approximatif.

## Règles de modèle qui ne se négocient pas

- **Le stock n'est jamais une colonne.** Toujours la somme signée des
  `mouvements` (vue `stock`). Ne jamais introduire de colonne de stock ni
  de cache persisté de stock, quelle que soit la raison de performance
  invoquée.
- **L'unité canonique stockée est la pièce.** Cartons et pièces sont une
  affaire de saisie et d'affichage, jamais de stockage séparé.
- **Le conditionnement est une entité, pas un attribut de la référence.**
  Deux conditionnements d'une même référence coexistent jusqu'à
  épuisement du premier ; le stock se tient par triplet emplacement ×
  référence × conditionnement, chaque mouvement porte son
  `conditionnement_id`. Une ligne de conditionnement est immuable : un
  nouveau conditionnement crée une nouvelle ligne, on ne corrige jamais
  `pieces_par_carton` sur une ligne existante.
- **Le motif d'un mouvement est une clé technique** (`MotifKey`), jamais
  un libellé traduit. La traduction se fait à l'affichage (`t.motifs`).
- **Les en-têtes des fichiers d'import et d'export ne sont pas
  traduits**, quelle que soit la langue de l'interface — sous peine de
  casser le round-trip Excel.

## À chaque changement visible par l'utilisateur

1. `npx tsc --noEmit` puis `npm run build` doivent passer avant tout
   commit. `npm run build` régénère automatiquement `CHANGELOG.md` et la
   version de `package.json` depuis `src/changelog.ts`
   (`scripts/generate-changelog.ts`, appelé en `prebuild`) — **ne jamais
   éditer `CHANGELOG.md` ni la version de `package.json` à la main**,
   ils seraient écrasés au prochain build.
2. Ajouter une entrée dans `src/changelog.ts` (seule source), relancer
   `npm run build`, committer `src/changelog.ts` + `CHANGELOG.md` +
   `package.json` ensemble (les trois changent, un seul est édité à la
   main).
3. Commit + push sur `main` (déploiement automatique via
   `.github/workflows/deploy.yml`), après un `git pull` — voir « Deux
   machines, une seule base ». Une migration de schéma ne s'applique
   jamais depuis le Pi : écrire le fichier, signaler, laisser le PC
   l'appliquer.
4. Donner un script de test concret à l'utilisateur — il vérifie en
   testant sur son iPhone en conditions réelles, pas en lisant le code.
   Voir [[user_profile]] en mémoire.

## Module Inventaire — vigilance particulière

`src/lib/inventaireDb.ts` et les écrans `Walk`/`Ecarts` de
`src/screens/Inventory.tsx` ont un historique de bugs subtils qui
passent `tsc` et le build sans problème (closures obsolètes, faux
positifs de correspondance floue, lignes de comptage silencieusement
ignorées, mauvais calcul d'écart). **Appeler `advisor()` après toute
modification de cette logique, avant de pousser** — voir
[[feedback_advisor_before_inventory_changes]] en mémoire pour le détail
des bugs déjà trouvés par ce réflexe.

Design actuel du module (2026-09-15), pour éviter de le refaire par
erreur :
- Saisie libre en marchant (emplacement + référence + quantité, sans
  liste de casiers à cocher ni auto-complétion imposée) — choix
  délibéré : une liste construite depuis le théorique ne peut jamais
  révéler une palette déplacée vers un endroit qui n'était pas censé en
  avoir.
- Écart calculé sur le théorique complet dès qu'un casier de la
  référence a été compté ; un casier théorique jamais visité compte
  pour 0 (pas d'état « en attente » intermédiaire — décision explicite
  de l'utilisateur, ne pas réintroduire un filtrage « pas encore
  complet »).
- Correction d'une saisie = nouvelle ligne dans `comptage_lignes`
  (latest-wins), jamais un UPDATE ; suppression ciblée par `id`, jamais
  par (réf, conditionnement) seul (une correction et l'ancienne valeur
  partagent cette paire).

**Nuance clôture vs affichage (2026-09-15).** La règle "casier jamais
visité = 0" ci-dessus vaut pour l'affichage des écarts. Elle ne vaut pas
pour la clôture (non implémentée) :
- écrire un `ajustement_inventaire` sur un casier que personne n'a
  visité détruirait du stock réel en base sur la foi d'une absence de
  saisie ;
- la clôture doit donc exiger que chaque casier du périmètre porte une
  saisie, chiffrée ou confirmée « vérifié, vide » (une ligne de comptage
  à zéro comme une autre — `comptage_lignes` le permet déjà) ;
- un compteur de couverture peut s'afficher pendant la marche, à titre
  indicatif, **sans modifier le calcul des écarts affiché** — ne pas
  réutiliser ce compteur pour filtrer/gater l'écran Écarts, c'est
  exactement ce qui a été retiré le 2026-09-14 sur demande explicite de
  l'utilisateur. Le zéro implicite est bon pour regarder, mauvais pour
  signer : deux mécanismes séparés, pas un seul champ recyclé.

## Deux machines, une seule base

Le dépôt existe en deux copies — le PC sous Windows et le Raspberry Pi
sous Linux — qui ne communiquent que par GitHub. La base Supabase, elle,
n'existe qu'en un seul exemplaire.

Cette asymétrie est tout le sujet : un conflit de code est bruyant et se
répare, un conflit de schéma est silencieux et ne se répare pas.

- **`main` est la branche de déploiement et le reste.** Pousser dessus
  déclenche `deploy.yml`, donc met l'app à jour sur l'iPhone de
  l'utilisateur, qui teste en conditions réelles. Faire travailler Claude
  sur des branches `claude/<sujet>` insérerait une fusion manuelle dans
  une boucle parcourue dix fois par jour, au bénéfice d'une relecture que
  personne ne fera — l'utilisateur n'est pas développeur et ne lit pas
  les diffs. Une relecture que personne n'exécute est un rituel, pas un
  garde-fou.
- **Une seule machine en service à la fois.** C'est la règle qui évite
  réellement les conflits ; les branches ne les évitent pas, elles les
  déplacent à la fusion. La passation est explicite : la machine qui
  quitte pousse, la machine qui prend tire avant de toucher quoi que ce
  soit.
- **`git pull` au début de chaque tâche, `push` à la fin.** Sans
  exception, même pour un changement d'une ligne : c'est l'oubli sur les
  petits changements qui fabrique les divergences.
- **Exception, et elle reste une exception** : si deux sessions doivent
  tourner en même temps, la seconde travaille sur une branche
  `claude/<sujet>` et l'utilisateur fusionne. Ce n'est pas le
  fonctionnement courant.

### La base : le PC écrit, le Pi lit

- **Les migrations s'appliquent depuis le PC, et seulement depuis lui.**
  Le Pi sert à travailler loin du bureau, c'est-à-dire précisément quand
  l'utilisateur est le moins en mesure de juger un changement de schéma.
- **Le serveur MCP Supabase du Pi est en lecture seule**, et c'est
  structurel, pas procédural. Une règle qui repose sur le fait de se
  souvenir de demander finit par être oubliée un soir de fatigue ; une
  connexion qui ne peut pas écrire ne l'oublie jamais.
- Une session sur le Pi qui a besoin d'une migration **écrit le fichier
  de migration, ne l'applique pas**, et le signale. Elle sera appliquée
  depuis le PC.

### Ce qui ne traverse pas GitHub

- **`.env`** est ignoré par git. Modifié sur une machine, il doit être
  recopié sur l'autre (`scp`). Ne contient que la clé publishable —
  jamais `service_role`.
- **`node_modules`** est propre à chaque machine. Après un `pull` qui
  touche `package.json`, lancer `npm install` sur la machine concernée
  avant de builder.
- **Plusieurs sessions Claude sur le Pi partagent le même dossier de
  travail.** N'en faire tourner qu'une à la fois : deux sessions
  éditeraient les mêmes fichiers sans se voir, et aucune des deux ne s'en
  apercevrait.
- **Fins de ligne** : `.gitattributes` porte `* text=auto eol=lf`, pour
  que les deux machines voient les mêmes octets. Ne pas le modifier. Si
  un jour des fichiers apparaissent entièrement modifiés sans qu'une
  ligne ait changé, c'est ce réglage qu'il faut vérifier en premier —
  et la renormalisation (`git add --renormalize .`) se fait **depuis une
  seule machine**, l'autre tirant ensuite.

## Environnement

- **Deux environnements.** Sur le PC : Windows, avec Git Bash (outil
  Bash) et PowerShell tous deux disponibles — préférer Bash pour la
  syntaxe POSIX déjà utilisée dans les commandes de ce projet
  (`npm run build 2>&1 | tail -N`, etc.). Sur le Raspberry Pi : Linux,
  shell POSIX natif. Écrire les commandes du projet en POSIX pour
  qu'elles tournent des deux côtés sans variante ; ne jamais introduire
  de commande PowerShell dans un script partagé.
- La sauvegarde hebdomadaire de la base vit aujourd'hui sur le PC
  (`C:\dokodoko-backups\backup-dokodoko.ps1`, procédure dans
  `docs/sauvegarde.md`). Le jour où elle passera en quotidien, sa place
  sera sur le Pi, allumé en permanence — ne pas l'automatiser côté
  Windows entre-temps.
- **Ne jamais taper d'échappement `\uXXXX` littéral dans le contenu
  passé à Write/Edit** — converti silencieusement en octet de contrôle
  réel sur disque dans cet environnement. Voir
  [[feedback_no_unicode_escapes_in_tool_writes]] en mémoire. Utiliser un
  séparateur visible (`'|'`, etc.) à la place.
- Secrets Supabase : jamais la clé `service_role` dans ce dépôt. `.env`
  local et secrets GitHub Actions ne contiennent que la clé publishable.

## Communication

Répondre en français dans ce projet (utilisateur non développeur, testeur
terrain — voir [[user_profile]] en mémoire pour le détail).
