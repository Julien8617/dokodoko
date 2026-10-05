# CLAUDE.md

Instructions pour toute session Claude Code travaillant sur ce dépôt.
`README.md` dit où on en est. Ce fichier dit comment travailler.
`docs/spec.md` dit ce qui est dans le périmètre et ce qui n'y est pas.
`docs/architecte.md` dit comment le projet se conduit — qui décide quoi,
et la propriété de chaque fichier. Lire les quatre au début de session.

**Propriété de ce fichier : le dépôt, pas l'agent d'architecture.**
`docs/architecte.md` fixe la règle pour tous les fichiers du dépôt ; pour
celui-ci en particulier, l'agent d'architecture demande des modifications
point par point et ne l'édite jamais en l'envoyant entier — contrairement
à `docs/spec.md`, `docs/jeu-de-demonstration.md`, `docs/architecte.md` et
`README.md`, qui se reçoivent tels quels et se committent sans
reformulation.

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
jamais comme séparation d'accès entre clients. Cette liste reste la
même après le changement de cadre du 5 octobre : ce n'est pas le
périmètre d'un pilote qui l'a produite, c'est le refus de construire
pour un besoin que personne n'a exprimé.

## Ce que vise le projet

**Changement de cadre, 5 octobre 2026.** どこどこ n'est plus un pilote
d'entreprise. Il n'y a plus d'entrepôt réel, plus de comptage
hebdomadaire, plus d'indicateur à mesurer, plus de date de décision,
et plus aucune donnée réelle de client. Le projet continue hors du
cadre professionnel, sur des **données fictives**.

La destination : **un produit présentable à une autre société.** Le
critère qui tranche tout arbitrage de priorité est donc : *est-ce que
ce chantier rend l'app compréhensible ou utilisable par quelqu'un qui
ne l'a pas écrite ?* L'ordre de livraison en découle — §12 de la spec,
qui fait foi.

Trois conséquences pour une session qui code :

- **Plus aucune date n'est une échéance.** Il n'y a plus de gel avant
  un comptage, plus de dette à assumer pour tenir un vendredi. En
  échange, un chantier ne se justifie plus par l'urgence : il se
  justifie par la démonstration.
- **Pas de séparation multi-société** tant qu'un second client réel
  n'existe pas. C'est le réflexe naturel et ce serait l'erreur la plus
  coûteuse disponible — chaque table, chaque policy, chaque requête —
  pour un besoin que personne n'a encore exprimé. Le modèle actuel ne
  la bloque pas ; la retrofitter sera mécanique, pas une réécriture.
- **Les données de démonstration se conçoivent, elles ne se remplissent
  pas.** Chaque cas présent en base doit démontrer une règle du §4 ou
  du §6 de la spec. Un jeu de `TEST001` démontre qu'on n'a pas fini.

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
   machines, une seule base ». Tout changement de schéma passe par un
   fichier de migration committé, sans exception : c'est lui qui
   permet de reconstruire la base à l'identique.
4. Donner un script de test concret à l'utilisateur — il vérifie en
   testant sur son iPhone en conditions réelles, pas en lisant le code.
   Voir [[user_profile]] en mémoire.
5. **À la fin de chaque épisode de codage**, donner en plus un résumé
   destiné à l'agent d'architecture : ce qui a été fait (et à quel
   commit), les écarts assumés par rapport à la spec, les traces de
   l'ancien cadre ou incohérences relevées en cours de route, et les
   points qui attendent son arbitrage plutôt que d'avoir été tranchés
   seul. Distinct du script de test du point 4, qui s'adresse à
   l'utilisateur-testeur et non à l'architecte — l'utilisateur relaie
   ce résumé, il n'a pas à relire le diff pour le reconstituer lui-même.

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

### La base : neuve, et peuplée de données fictives

La base de production porte un **jeu de démonstration fictif**,
reconstruit depuis les seules migrations du dépôt puis chargé par un
script committé. Aucune donnée réelle de client n'y figure, ni dans le
dépôt — qui est public.

Les deux machines travaillent contre cette base sans restriction :
développer, migrer, tester depuis le PC comme depuis le Pi. Il n'y a
rien à protéger qui ne soit reconstructible.

Deux conséquences pour une session qui code :

- **Une migration doit être un fichier committé**, toujours, sans
  exception. C'est ce qui a permis de reconstruire la base, et ce qui
  permettra la prochaine reconstruction. Un changement appliqué à la
  main et jamais écrit n'existe nulle part.
- **Le jeu de démonstration se modifie par son script, jamais à la
  main dans l'éditeur SQL.** Une base peuplée par des gestes manuels
  n'est plus reproductible, et cesse d'être une démonstration pour
  redevenir un état accidentel.

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
- La sauvegarde de la base est automatisée sur le Pi (minuteur
  systemd, hebdomadaire). Procédure, critère de réussite et limites
  connues dans `docs/sauvegarde.md` — ne pas en créer une seconde
  ailleurs.
- **Ne jamais taper d'échappement `\uXXXX` littéral dans le contenu
  passé à Write/Edit** — converti silencieusement en octet de contrôle
  réel sur disque dans cet environnement. Voir
  [[feedback_no_unicode_escapes_in_tool_writes]] en mémoire. Utiliser un
  séparateur visible (`'|'`, etc.) à la place.
- Secrets Supabase : jamais la clé `service_role` dans ce dépôt. `.env`
  local et secrets GitHub Actions ne contiennent que la clé publishable.

## Communication

Répondre en français dans ce projet. L'utilisateur n'est pas
développeur : il vérifie en testant sur son iPhone, pas en lisant le
code. Un script de test concret vaut donc mieux qu'une explication de
ce qui a été changé — voir [[user_profile]] en mémoire.
