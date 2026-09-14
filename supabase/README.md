# Supabase — mise en place

Projet : `xvmroixkazhuxllssdrh` (organisation DOKODOKO), URL
`https://xvmroixkazhuxllssdrh.supabase.co`. Tout ce qui suit est **déjà
fait** sur ce projet — cette page sert de référence pour un nouveau projet
(staging, ou si celui-ci doit être recréé), et de rappel pour la
maintenance courante (ajouter un e-mail à la liste blanche, etc.).

Rien ici n'est scriptable sans la clé `service_role` du projet, qui ne
doit jamais transiter par ce dépôt — les étapes 3 (Dashboard) restent
manuelles par nature ; les étapes 2 et 4 ont été faites via le serveur MCP
Supabase (`claude mcp add supabase ...`, cf. historique du projet).

## 1. Créer le projet — fait

Projet créé sur https://supabase.com/dashboard. URL et clé `anon` /
publishable dans Project Settings → API Keys — c'est tout ce dont le front
a besoin, jamais la clé `service_role`.

## 2. Schéma appliqué — fait

Trois migrations appliquées, dans l'ordre :

- `20260911221229_init.sql` : tables de base (`references`,
  `emplacements`, `conditionnements`, `mouvements`, `comptages`), RLS,
  triggers d'immutabilité, vue `stock`. Vérifié en conditions réelles :
  RLS bloque l'accès anonyme même avec des données présentes, `mouvements`
  résiste à UPDATE/DELETE en direct (critères d'acceptation 1 et 23).
- `20260912000000_comptages_attendu_consulte.sql` : colonne
  `comptages.attendu_consulte` (comptage à l'aveugle).
- `20260914000000_inventaire_v2.sql` : module Inventaire — `clients`,
  `references.client_code`, `inventaires` (scope tout/client/références,
  stock théorique figé via `frozen_ts`, un seul inventaire `en_cours` à
  la fois via index partiel), `inventaire_references`,
  `comptage_lignes` (journal append-only : jamais d'UPDATE, seul le
  dernier `ts` par clé compte — permet la reprise et la correction sans
  perdre l'historique).

L'audit de sécurité (`get_advisors`) a signalé et corrigé : search_path
mutable sur les fonctions trigger, et la fonction `is_email_allowed()`
exécutable par `anon` sans connexion (Supabase l'autorise par défaut sur
toute nouvelle fonction — retiré explicitement).

Pour rejouer ce schéma sur un autre projet : coller le contenu du fichier
dans le SQL Editor du Dashboard, ou via le MCP (`apply_migration` a échoué
ici pour une raison de scope du token — `execute_sql` a fonctionné à la
place et donne le même résultat).

## 3. Authentification — code reçu par e-mail — fait

Dans **Authentication → Sign In / Providers** : provider **Email**
activé (c'est lui qui gère `signInWithOtp`/`verifyOtp` — aucun autre
provider n'est actif). Supabase ne propose pas, dans cette version du
Dashboard, de bloquer l'inscription par mot de passe tout en gardant
l'Email provider actif : ce n'est pas un problème pratique, puisque
l'app (`src/auth/AuthGate.tsx`) n'appelle jamais
`signInWithPassword`/`signUp`, et que la vraie barrière est le RLS.

**Pourquoi un code plutôt qu'un lien magique.** Sur iPhone, un lien
magique cliqué depuis l'app Mail ouvre toujours Safari, jamais la PWA
installée sur l'écran d'accueil — et Safari et l'app installée n'ont pas
le même stockage local (le vérificateur PKCE posé par `signInWithOtp()`
depuis l'app installée n'est pas visible par Safari). Vérifié en
pratique : demander le lien depuis l'app installée puis cliquer dessus
dans Safari échoue silencieusement ; demander depuis Safari directement
fonctionne. Le code à usage unique évite complètement le problème :
aucune redirection, la vérification (`verifyOtp`) se fait dans le même
onglet/contexte que la demande, qu'il s'agisse de l'app installée ou de
Safari.

**Longueur du code — réglage par projet, pas un défaut générique.**
**Authentication → Sign In / Providers → Email → Email OTP length** est
réglé à **8** sur ce projet (le défaut Supabase générique est 6 — ne
jamais assumer, toujours vérifier ce réglage). Le code correspondant
côté app est la constante `OTP_LENGTH` dans `src/auth/AuthGate.tsx` :
si ce réglage change côté Dashboard, mettre à jour cette constante.

**SMTP personnalisé — obligatoire pour éditer le contenu du mail.** Le
mailer intégré de Supabase ne permet pas d'éditer les templates tant que
« Set up custom SMTP » n'est pas activé (**Authentication → Emails →
SMTP Settings**) ; sans ça, le template par défaut est un lien magique
sans code visible. Ce projet utilise **Gmail SMTP**
(`smtp.gmail.com:587`) avec un **mot de passe d'application** Google
(nécessite la validation en 2 étapes sur le compte Gmail — jamais le mot
de passe Gmail normal, qui échoue avec `534 5.7.9 Application-specific
password required`). Une fois le SMTP personnalisé actif, le template
« Magic Link » (**Authentication → Emails → Templates**) a été modifié
pour inclure `{{ .Token }}` (le code) à la place de/en plus de
`{{ .ConfirmationURL }}`.

Dans **Authentication → URL Configuration** :
- **Site URL** : `https://julien8617.github.io/dokodoko/`
- **Redirect URLs** : la même, plus `http://localhost:5173/dokodoko/**`
  pour le développement local (le lien de secours dans le mail reste
  fonctionnel si demandé et cliqué depuis Safari, mais n'est plus le
  chemin principal).

**Important — la liste blanche n'est pas dans les réglages d'auth de
Supabase.** N'importe qui peut demander un code pour n'importe quelle
adresse ; la protection réelle est le RLS (`is_email_allowed()`,
voir la migration) : une adresse absente de la table `autorises` obtient
une session valide mais ne peut lire ni écrire aucune ligne.

## 4. Liste blanche — peuplée

```sql
insert into autorises (email) values ('julien@sanyogrp.co.jp');
```

Pour ajouter quelqu'un d'autre plus tard, dans le SQL Editor ou via MCP :

```sql
insert into autorises (email) values ('nouvelle.personne@exemple.com')
on conflict (email) do nothing;
```

## 5. Variables d'environnement — fait

- **Local** : `.env` à la racine (ignoré par git), `VITE_SUPABASE_URL` et
  `VITE_SUPABASE_ANON_KEY` renseignés avec la clé publishable
  (`sb_publishable_...`).
- **CI/CD (GitHub Actions)** : mêmes valeurs en secrets du dépôt
  (`Settings → Secrets and variables → Actions`) sous les noms
  `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` — le workflow
  `.github/workflows/deploy.yml` les injecte au build.

## Vérification rapide

```bash
curl "https://xvmroixkazhuxllssdrh.supabase.co/rest/v1/stock" \
  -H "apikey: sb_publishable_as8V9lFVGOWnnWzk7SbSEw_bvU6BUU8"
```

Sans jeton d'authentification, cette requête doit renvoyer un tableau vide
(`[]`), jamais les données de stock — c'est le critère d'acceptation 1.
Déjà vérifié côté base (`set role anon`) ; à revérifier via HTTP une fois
l'app en ligne.
