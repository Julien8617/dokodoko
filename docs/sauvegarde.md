# Sauvegarde et restauration de la base

> Emplacement : `docs/sauvegarde.md`. Établi et **prouvé par une restauration réelle le 26 septembre 2026**.
>
> Ce document ne contient aucun identifiant, aucun mot de passe, aucun nom d'hôte. Le dépôt est public.

## Pourquoi ce document existe

Le plan gratuit de Supabase n'offre **aucune sauvegarde automatique**. La base contient le seul exemplaire au monde des comptages, du référentiel et des emplacements. Le schéma, lui, vit dans les migrations du dépôt — il est donc déjà protégé par GitHub. Ce qui est en jeu ici, ce sont les **données**.

Une sauvegarde dont on n'a jamais tenté la restauration n'est pas une sauvegarde, c'est un fichier. La procédure ci-dessous a été exécutée de bout en bout, restauration comprise, avec concordance des comptes de lignes.

## Ce qui est en place

- **Poste** : Windows, PostgreSQL 18 installé avec le serveur *et* les outils client.
- **Dossier des sauvegardes** : `C:\dokodoko-backups`, **hors du dépôt**, délibérément.
- **Script** : `backup-dokodoko.ps1`, dans ce même dossier. Il contient la chaîne de connexion, donc le mot de passe de la base — raison de plus pour qu'il ne s'approche jamais du dépôt.
- **Base d'essai locale** : `dokodoko_test`, sur le serveur PostgreSQL du poste. Elle n'est pas une copie entretenue : on la détruit et on la recrée à chaque essai de restauration.

## Sauvegarder

Clic droit sur `C:\dokodoko-backups\backup-dokodoko.ps1` → **Exécuter avec PowerShell**.

Le script produit `dokodoko-AAAA-MM-JJ.sql` et **vérifie son propre résultat**. Ses messages sont en anglais, pour que les documents remis aux collègues japonais puissent les citer mot pour mot : taille plausible, et dix tables porteuses de données. Un fichier créé ne prouve rien ; c'est pour ça que le script refuse de déclarer la sauvegarde valide sur le seul fait qu'un fichier existe.

Rythme : **une fois par semaine**, et systématiquement **avant toute absence prolongée**.

Il reste une action manuelle que le script ne fait pas : **déposer une copie ailleurs que sur ce PC**. Un disque perdu emporte le poste et ses sauvegardes du même coup.

## Restaurer — l'essai qui prouve

À refaire au moins une fois par trimestre, et après tout changement de schéma important.

```powershell
$env:PGPASSWORD = "<mot de passe postgres LOCAL, pas celui de Supabase>"

& "C:\Program Files\PostgreSQL\18\bin\dropdb.exe"   -U postgres -h localhost --if-exists dokodoko_test
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h localhost dokodoko_test

& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d dokodoko_test `
  -c "create role anon; create role authenticated; create role service_role;"

& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d dokodoko_test `
  -f "C:\dokodoko-backups\dokodoko-AAAA-MM-JJ.sql"
```

Les rôles `anon`, `authenticated` et `service_role` sont créés à vide parce que les politiques RLS du dump les mentionnent. Sans eux, la restauration se noie dans des erreurs de rôle manquant.

**Des erreurs pendant la restauration sont normales** — extensions et fonctions propres à Supabase qui n'existent pas sur un PostgreSQL ordinaire. Leur absence n'est pas le critère de réussite. Le critère est le suivant.

## Le critère de réussite

La même requête, exécutée dans la base restaurée puis dans l'éditeur SQL de Supabase, doit rendre les mêmes nombres :

```sql
select 'references' as t, count(*) from "references"
union all select 'emplacements',     count(*) from emplacements
union all select 'comptages',         count(*) from comptages
union all select 'comptage_lignes',   count(*) from comptage_lignes
union all select 'conditionnements',  count(*) from conditionnements;
```

Concordance sur les cinq lignes : la sauvegarde est prouvée. Un seul écart : elle ne l'est pas, et il faut comprendre pourquoi avant d'en avoir besoin.

## Ce que la sauvegarde ne couvre pas

- **Les comptes de connexion** (schéma `auth`). Sans conséquence : l'authentification se fait par code envoyé par e-mail, et le droit d'entrer vient de la table `autorises`, qui est dans `public`, donc sauvegardée. Une reconnexion recrée le compte.
- **Les changements de schéma passés à la main** dans l'éditeur SQL sans migration correspondante. Le dump les emporte, mais reconstruire une base neuve depuis les seules migrations du dépôt les oublierait. **Toute modification de schéma doit exister sous forme de migration committée.**

  *Correction du 29 septembre.* Une version antérieure de ce document citait les trois policies `DELETE` du 21 septembre comme exemple. C'était faux : leur migration existait déjà, committée le 19 septembre, et les policies actives en base correspondent exactement à ce fichier. Ce qui a été manuel ce jour-là, c'est l'**application** de la migration, pas sa définition. La leçon est d'ailleurs plus utile ainsi : **un fichier de migration dans le dépôt ne prouve pas qu'il a été appliqué, et une structure présente en base ne prouve pas qu'elle est décrite quelque part.** Les deux se vérifient en comparant la base aux migrations — pour les policies, `select tablename, policyname, cmd from pg_policies where schemaname='public'` en regard des fichiers du dossier `supabase/migrations`.

## Les deux pièges à ne jamais oublier

**Le dépôt est public.** Un dump qui s'y retrouverait exposerait l'intégralité du stock des clients. Le `.gitignore` porte `backups/`, `*.dump` et `*.backup` — mais **pas `*.sql`**, qui ignorerait les migrations. La vraie protection n'est pas le `.gitignore`, c'est que le dossier des sauvegardes est ailleurs sur le disque.

**La mise en pause du plan gratuit.** Un projet sans activité pendant environ sept jours est mis en pause. L'usage hebdomadaire frôle cette limite en permanence, et une absence prolongée la dépasse. Une sauvegarde à jour avant de partir est ce qui rend cette pause sans conséquence.
