# CLAUDE.md

Instructions pour toute session Claude Code travaillant sur ce dépôt. Le
`README.md` décrit le projet et son état ; ce fichier décrit comment y
travailler.

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

## À chaque changement visible par l'utilisateur

1. `npx tsc --noEmit` puis `npm run build` doivent passer avant tout
   commit.
2. Ajouter une entrée dans **les deux** `src/changelog.ts` (source
   affichée dans l'app) et `CHANGELOG.md` (miroir lisible sur GitHub) —
   les deux dans le même commit, jamais un seul des deux.
3. Bumper la version dans `package.json` (suit `src/changelog.ts`), puis
   relancer `npm run build` pour que `__APP_VERSION__` soit à jour dans
   le bundle avant de committer.
4. Commit + push sur `main` (déploiement automatique via
   `.github/workflows/deploy.yml`).
5. Donner un script de test concret à l'utilisateur — il vérifie en
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
