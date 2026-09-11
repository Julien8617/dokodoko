# Supabase — mise en place

Étapes manuelles, à faire une fois, dans le Dashboard Supabase
(https://supabase.com/dashboard). Rien ici n'est scriptable sans la clé
`service_role` du projet, qui ne doit jamais transiter par ce dépôt.

## 1. Créer le projet

Créer un projet Supabase (région proche de l'entrepôt). Noter l'URL du
projet et la clé `anon` (Project Settings → API) — c'est tout ce dont le
front a besoin, jamais la clé `service_role`.

## 2. Appliquer le schéma

Copier le contenu de `supabase/migrations/20260911221229_init.sql` dans le
SQL Editor du Dashboard et l'exécuter. (Ou, une fois le projet lié :
`npx supabase link` puis `npx supabase db push`.)

## 3. Authentification — lien magique uniquement

Dans **Authentication → Providers** :

- Désactiver **Email / Password** (ou au minimum désactiver les
  inscriptions par mot de passe) — seul le lien magique (Magic Link / OTP
  par e-mail) doit rester actif.
- Dans **Authentication → URL Configuration**, régler **Site URL** sur
  `https://<compte>.github.io/dokodoko/` et ajouter cette même URL aux
  **Redirect URLs**.

**Important — la liste blanche n'est pas dans les réglages d'auth de
Supabase.** N'importe qui peut demander un lien magique pour n'importe
quelle adresse ; la protection réelle est le RLS (`is_email_allowed()`,
voir la migration) : une adresse absente de la table `autorises` obtient
une session valide mais ne peut lire ni écrire aucune ligne. Vérifier
explicitement ce point (critère d'acceptation 1) une fois le projet en
ligne.

## 4. Peupler la liste blanche

Dans le SQL Editor :

```sql
insert into autorises (email) values
  ('prenom.nom@exemple.com'),
  ('autre.personne@exemple.com');
```

## 5. Variables d'environnement

- **Local** : copier `.env.example` en `.env` à la racine, renseigner
  `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
- **CI/CD (GitHub Actions)** : ajouter ces deux mêmes valeurs comme
  secrets du dépôt (`Settings → Secrets and variables → Actions`), sous
  les noms `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` — le workflow
  `.github/workflows/deploy.yml` les injecte au build.

## Vérification rapide

```bash
curl "https://<projet>.supabase.co/rest/v1/stock" \
  -H "apikey: <clé anon>"
```

Sans jeton d'authentification, cette requête doit renvoyer un tableau vide
(`[]`), jamais les données de stock — c'est le critère d'acceptation 1.
