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

`supabase/migrations/20260911221229_init.sql` appliqué (tables, RLS,
triggers d'immutabilité, vue `stock`). Vérifié en conditions réelles :
RLS bloque l'accès anonyme même avec des données présentes, `mouvements`
résiste à UPDATE/DELETE en direct (critères d'acceptation 1 et 23).

L'audit de sécurité (`get_advisors`) a signalé et corrigé : search_path
mutable sur les fonctions trigger, et la fonction `is_email_allowed()`
exécutable par `anon` sans connexion (Supabase l'autorise par défaut sur
toute nouvelle fonction — retiré explicitement).

Pour rejouer ce schéma sur un autre projet : coller le contenu du fichier
dans le SQL Editor du Dashboard, ou via le MCP (`apply_migration` a échoué
ici pour une raison de scope du token — `execute_sql` a fonctionné à la
place et donne le même résultat).

## 3. Authentification — lien magique — fait

Dans **Authentication → Sign In / Providers** : provider **Email**
activé (c'est lui qui gère `signInWithOtp`, donc le lien magique — aucun
autre provider n'est actif). Supabase ne propose pas, dans cette version
du Dashboard, de bloquer l'inscription par mot de passe tout en gardant le
lien magique sur le même provider Email : ce n'est pas un problème
pratique, puisque l'app (`src/auth/AuthGate.tsx`) n'appelle jamais
`signInWithPassword`/`signUp`, et que la vraie barrière est le RLS.

Dans **Authentication → URL Configuration** :
- **Site URL** : `https://julien8617.github.io/dokodoko/`
- **Redirect URLs** : la même, plus `http://localhost:5173/dokodoko/**`
  pour le développement local.

**Important — la liste blanche n'est pas dans les réglages d'auth de
Supabase.** N'importe qui peut demander un lien magique pour n'importe
quelle adresse ; la protection réelle est le RLS (`is_email_allowed()`,
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
