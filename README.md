# どこどこ — suivi de stock en entrepôt

Savoir où se trouve une référence dans un entrepôt où l'adressage est fixe
et les palettes tournantes : enregistrer les mouvements, et conduire un
inventaire qui **révèle** les écarts au lieu de les présumer.

PWA installable sur téléphone, utilisable dans une allée, à une main, en
japonais comme en français.

- Spec de périmètre : [`docs/spec.md`](docs/spec.md) — ce qui est dans le
  périmètre, ce qui n'y est pas, et **pourquoi**. Elle fait foi.
- Règles de travail : [`CLAUDE.md`](CLAUDE.md).
- Journal des versions : [`CHANGELOG.md`](CHANGELOG.md).
- Sauvegarde et restauration : [`docs/sauvegarde.md`](docs/sauvegarde.md).

## Où en est le projet

**Projet personnel, mené hors cadre professionnel, sur des données
fictives.** L'app a d'abord été éprouvée un mois en entrepôt réel : la
plupart des règles de la spec viennent d'un défaut constaté sur appareil,
pas d'une anticipation. C'est ce qu'elle a gardé de cette période, et c'est
l'essentiel. Depuis, le cadre a changé — il n'y a plus de périmètre réel, ni
de date de décision, ni de donnée de client dans la base.

Ce que ça change pour qui lit ce dépôt : **l'app n'attend pas un verdict,
elle attend un premier utilisateur.** Le backlog ne se justifie plus par une
urgence mais par la démonstration — un chantier entre parce qu'il rend l'app
compréhensible ou utilisable par quelqu'un qui ne l'a pas écrite.

Version : `0.9.x`. Le numéro exact s'affiche en pied de page de l'app, pour
vérifier après un déploiement que c'est bien la bonne version qui est
chargée.

## Ce qui tourne

**Mouvement** — entrée, sortie, transfert, annulation. Vérifié en conditions
réelles contre les vraies policies RLS : une sortie supérieure au stock est
refusée par la base, pas seulement par l'écran.

**Inventaire** — saisie libre « en marchant » : emplacement, référence,
quantité (cartons et pièces séparés), tapés dans n'importe quel ordre, sans
liste de casiers à cocher. Choix délibéré : une liste de casiers *attendus*
construite depuis le stock théorique ne peut jamais révéler une palette
déplacée vers un emplacement qui n'était pas censé en avoir. Stock théorique
figé au lancement (`frozen_ts`) et toujours **recalculé**, jamais recopié.
Écran des écarts, détection de déplacement probable, correction d'une saisie
depuis les écarts, rappel filtrable des références à compter, et deux
documents imprimables en japonais (synthèse des écarts, feuille de
contre-validation à cocher et signer).

**Recherche** — stock courant, par référence (« où est tel article ? ») ou
par emplacement (« qu'y a-t-il dans A-05-1 ? »). Recherche par libellé
tolérante aux accents, à la casse et à l'ordre des mots ; un code tapé reste
prioritaire sur un libellé qui le contiendrait par coïncidence.

**Catalogue** — surface de lecture du référentiel : lister, chercher,
vérifier, corriger. Drapeau `actif` pour retirer une référence abandonnée
des sélecteurs de saisie sans rien effacer.

**Réglages** — clients, références, générateur d'emplacements en lot,
imports CSV (clients, références, stock d'ouverture) avec aperçu avant
écriture et import rejouable sans doublon.

**Cache de lecture** — référentiel et stock consultable disponibles hors
réseau, rafraîchis à l'ouverture, après chaque écriture et au retour du
réseau. L'Accueil affiche l'âge du cache. La vérification de stock avant une
sortie reste en direct, délibérément : ne jamais refuser une sortie légitime
sur une donnée périmée.

**Interface en trois langues** — `fr`, `ja`, `en`, typées, `fr` servant de
référence : une clé manquante dans une autre langue est une erreur de
compilation, pas un trou découvert par l'utilisateur.

## Ce qui n'y est pas encore

File d'écriture hors ligne (les lectures sont déjà servies par le cache, les
écritures exigent encore le réseau) · clôture d'inventaire · export `.xlsx`
· classeur Excel d'import en masse · version grand écran du Catalogue ·
tests unitaires.

L'ordre de livraison et ce qui attend un déclencheur sont dans la spec,
§12.

## Architecture

- Source de vérité : **Supabase** — Postgres, RLS, authentification par code
  reçu par e-mail (pas de lien magique : un lien ouvre Safari et jamais la
  PWA installée sur l'écran d'accueil iOS, le code évite le problème).
- Front : **React + TypeScript + Vite**, site statique, aucun backend à
  héberger.
- **Le stock n'est jamais une colonne.** Il est toujours la somme d'un
  journal de mouvements append-only, protégé par des triggers
  d'immutabilité : ni `update` ni `delete` sur `mouvements`. Une erreur se
  corrige par un mouvement inverse, qui laisse une trace.
- Pas de « synchronisation Excel » bidirectionnelle. Export depuis l'app, ou
  interrogation directe de la base depuis un PC.

Chaque décision d'architecture est dans la spec avec sa raison et sa date.
Ce README n'en est pas un résumé.

## Démarrage

```bash
cp .env.example .env   # puis renseigner les valeurs — voir supabase/README.md
npm install
npm run dev        # serveur de développement
npm run build      # build de production (sortie dans dist/)
npm run typecheck  # vérification TypeScript stricte
```

Déploiement automatique sur `main` via GitHub Actions
(`.github/workflows/deploy.yml`) vers GitHub Pages. Schéma, policies et
procédure de mise en place de la base : `supabase/README.md` et
`supabase/migrations/`.

> **Le dépôt est public.** Aucun export de données, aucun dump, aucune
> capture d'écran portant des références de client n'y entre. Seule la clé
> publique de Supabase y figure, et sa seule protection est RLS.
