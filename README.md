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
- Lectures via cache local (IndexedDB), écritures mises en file hors ligne
  et rejouées automatiquement (idempotentes par `id` UUID généré côté
  client).
- Aucune « synchronisation Excel » bidirectionnelle : export `.xlsx` depuis
  l'app, ou interrogation directe de Supabase depuis le PC (vue SQL, CSV,
  Power Query). Voir la spec pour le détail des décisions et leurs raisons.

La spec complète (modèle de données, motifs, écrans, imports, critères
d'acceptation) fait foi ; ce README n'en est pas un résumé exhaustif.

## Statut

Socle initial en place (étape 1 de l'ordre de livraison) :

- scaffold Vite + React + TypeScript + PWA (manifest, service worker avec
  invite de mise à jour explicite) ;
- socle de traduction typé `fr` / `ja` / `en` (`src/i18n`), `fr` servant de
  type de référence — une clé manquante dans une autre langue est une
  erreur de compilation ;
- écran d'accueil minimal (destinations inertes, sélecteur de langue).

Pas encore fait : schéma Supabase, RLS, authentification par lien magique,
imports, écrans Mouvement/Inventaire, file hors ligne, exports.

## Démarrage

```bash
npm install
npm run dev        # serveur de développement
npm run build      # build de production (sortie dans dist/)
npm run typecheck  # vérification TypeScript stricte
```

Le déploiement se fait automatiquement sur `main` via GitHub Actions
(`.github/workflows/deploy.yml`), vers
`https://<compte>.github.io/dokodoko/`. Régler la source de déploiement du
dépôt sur « GitHub Actions » dans les paramètres GitHub avant le premier
push sur `main`.
