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

Ensuite, dans cet ordre, et rien d'autre avant le point de situation :

1. File hors ligne et bandeau « n en attente »
2. Export `.xlsx`
3. Justification et clôture d'inventaire — **un seul chantier**
   regroupant :
   - couverture de casiers exigée pour clôturer (voir nuance ci-dessous)
   - mouvements postérieurs au gel affichés sur l'écran des écarts
   - résolution d'une paire détectée comme compensée (voir Module
     Inventaire) : la clôture écrit un **transfert** (deux mouvements,
     même `transfert_id`, somme nulle), jamais deux
     `ajustement_inventaire` — sinon une palette simplement déplacée
     gonfle à tort les statistiques d'écart de fin de pilote, qui sont
     l'indicateur du pilote
4. Synthèse imprimable

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
   `.github/workflows/deploy.yml`).
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

## Environnement

- Windows + Git Bash (outil Bash) et PowerShell (outil PowerShell) tous
  deux disponibles — préférer Bash pour la syntaxe POSIX déjà utilisée
  dans les commandes de ce projet (`npm run build 2>&1 | tail -N`, etc.).
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
