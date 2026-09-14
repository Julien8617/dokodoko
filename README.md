# どこどこ — pilote de suivi de stock

## Cadre du pilote

- **Périmètre exact** : client **REUZEL**, zones **A, B et C**. Isolable
  physiquement parce que les commandes de ce client suivent leur propre
  processus, distinct des autres clients — aucun risque de mélanger un
  mouvement du pilote avec un mouvement resté sur l'Excel général.
- **Date de début** : vendredi 18 septembre 2026.
- **Excel en parallèle** : l'Excel existant reste tenu à jour sur ce même
  périmètre pendant toute la durée du pilote — l'app n'est pas encore
  considérée comme fiable seule.
- **Repli papier en cas d'échec** : l'app n'a pas encore de file hors
  ligne (voir Statut) — si l'écran affiche un message d'erreur après une
  saisie (mouvement ou inventaire), ce mouvement n'a **pas** été
  enregistré. Le noter sur l'Excel/papier comme d'habitude et réessayer
  plus tard ; ne jamais supposer qu'une erreur affichée s'est quand même
  enregistrée derrière.
- **Stock d'ouverture** : saisi à la main en mouvements `stock_initial`
  sur A, B et C (une session) — c'est aussi le premier comptage physique
  du pilote. Pas d'import en masse pour cette étape (voir Statut).
- **Durée prévue et critère d'arrêt** : 6 mois maximum. Point de situation
  après 1 mois (soit le 18 octobre 2026) : si l'écart entre l'app et le
  comptage physique est important et ne peut pas être expliqué, le pilote
  s'arrête à ce moment-là plutôt que d'aller au bout des 6 mois.

**Indicateur unique du pilote** : l'écart entre le stock que l'app annonce
et le comptage physique réalisé à la fin de la période. Pas le nombre de
fonctionnalités livrées.

## Architecture

- Source de vérité : **Supabase** (Postgres + API + authentification).
- Front : React + TypeScript + Vite, PWA installable sur écran d'accueil
  iPhone. Site statique déployé sur **GitHub Pages** — pas de backend à
  héberger.
- Prévu (voir spec) : lectures via cache local (IndexedDB), écritures
  mises en file hors ligne et rejouées automatiquement (idempotentes par
  `id` UUID généré côté client) — pas encore implémenté, voir Statut.
- Aucune « synchronisation Excel » bidirectionnelle : export `.xlsx` depuis
  l'app, ou interrogation directe de Supabase depuis le PC (vue SQL, CSV,
  Power Query). Voir la spec pour le détail des décisions et leurs raisons.

La spec complète (modèle de données, motifs, écrans, imports, critères
d'acceptation) fait foi ; ce README n'en est pas un résumé exhaustif.

## Statut

Base technique en place :

- scaffold Vite + React + TypeScript + PWA (manifest, service worker avec
  invite de mise à jour explicite) ;
- socle de traduction typé `fr` / `ja` / `en` (`src/i18n`), `fr` servant de
  type de référence — une clé manquante dans une autre langue est une
  erreur de compilation ;
- schéma Supabase + RLS + immutabilité de `mouvements`
  (`supabase/migrations/`) ;
- authentification par **code reçu par e-mail** (`src/auth/AuthGate.tsx`,
  `signInWithOtp` + `verifyOtp`) devant tout écran de l'app — pas de lien
  magique : un lien ouvre toujours Safari et jamais la PWA installée sur
  l'écran d'accueil iOS, le code évite complètement le problème (aucune
  redirection). Détails et pourquoi dans `supabase/README.md` §3.
- indicateur de version discret (pied de page Accueil/Réglages,
  `src/components/VersionFooter.tsx` + `src/changelog.ts`) pour confirmer
  après un déploiement que la bonne version est bien chargée sur iPhone.

Écrans fonctionnels :

- **Mouvement** (Entrée / Sortie / Transfert) — vérifié en conditions
  réelles contre les vraies policies RLS (refus si stock insuffisant,
  transfert entre deux emplacements).
- **Inventaire** — saisie libre « en marchant » : emplacement + référence
  + quantité (cartons et pièces séparés) tapés dans n'importe quel ordre,
  sans liste de casiers à cocher ni auto-complétion imposée. Choix
  délibéré : une liste de casiers « attendus » construite depuis le stock
  théorique ne peut jamais révéler une palette déplacée vers un
  emplacement qui n'était pas censé en avoir. Stock théorique figé au
  lancement (`frozen_ts`, comparaison stricte `ts < frozen_ts` sur
  `mouvements`, jamais une copie). Écran Écarts : un casier théorique
  jamais compté vaut 0 dans le calcul et apparaît directement comme un
  écart (pas d'état « en attente » séparé) ; détection de déplacement
  probable (écart net nul mais casiers différents) ; correction possible
  d'une saisie (modifier ou retirer) directement depuis l'écran des
  écarts. **Hors périmètre pour l'instant** : justification tracée d'un
  écart, clôture de l'inventaire (écriture d'`ajustement_inventaire`),
  impression des feuilles de comptage.
- **Recherche** — stock courant (jamais figé, contrairement à
  l'Inventaire) par référence (« où se trouve REU003 ? ») ou par
  emplacement (« qu'y a-t-il dans A-05-1 ? »).
- **Réglages** — ajout de clients, références (avec conditionnement et
  client rattaché) et emplacements.

Aide à la saisie partagée entre Inventaire et Recherche (même code,
`src/lib/db.ts`) : liste déroulante de suggestions sur les champs
référence et emplacement, jamais restrictive — un code absent de la
liste reste saisissable tel quel. Recherche floue par sous-chaîne pour
les références (« 65 » trouve « REU065 ») ; reconnaissance des codes
emplacement sans tiret ni zéro de tête pour les casiers (« A11 » →
« A-01-1 », règle stricte : le dernier chiffre tapé est toujours le
niveau).

**Supabase configuré** (projet `xvmroixkazhuxllssdrh`) : schéma appliqué,
RLS vérifié en conditions réelles, authentification par code fonctionnelle
(SMTP Gmail personnalisé), liste blanche peuplée. Détails et procédure
dans `supabase/README.md`.

**Rien de bloquant pour le démarrage du 18 septembre** : l'app se lance
en l'état, stock d'ouverture saisi à la main (voir Cadre du pilote).

Pas encore fait, par ordre de priorité jusqu'au point de situation du
18 octobre 2026 (voir `docs/spec.md` pour le détail et les raisons) :

1. File hors ligne (écritures en attente rejouées automatiquement,
   bandeau « n en attente »)
2. Export `.xlsx`
3. Justification et clôture d'inventaire — un seul chantier avec :
   affichage des mouvements postérieurs au gel sur l'écran des écarts,
   et résolution d'une paire compensée en un **transfert** (deux
   mouvements, même `transfert_id`, somme nulle) plutôt qu'en deux
   `ajustement_inventaire` séparés — sans quoi une palette simplement
   déplacée gonflerait à tort les statistiques d'écart de fin de pilote
4. Synthèse imprimable

**Repoussé** (fonction de passage à l'échelle, pas nécessaire tant que
le périmètre reste REUZEL/A/B/C) : imports en masse.

## Démarrage

```bash
cp .env.example .env   # puis renseigner les valeurs — voir supabase/README.md
npm install
npm run dev        # serveur de développement
npm run build      # build de production (sortie dans dist/)
npm run typecheck  # vérification TypeScript stricte
```

Le déploiement se fait automatiquement sur `main` via GitHub Actions
(`.github/workflows/deploy.yml`), vers
`https://julien8617.github.io/dokodoko/`. Source de déploiement du dépôt
déjà réglée sur « GitHub Actions », secrets `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` déjà renseignés.
