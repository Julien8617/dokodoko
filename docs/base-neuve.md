# Monter une base neuve

> **Destination : `docs/base-neuve.md`.** Procédure de création d'une base
> depuis zéro, jusqu'à une app qui fonctionne dessus. Écrite le 5 octobre 2026
> pour le passage à la base de démonstration ; elle vaut telle quelle le jour
> où un vrai client arrive, en remplaçant le script de semis par l'import du
> stock d'ouverture.
>
> **Deux étapes peuvent vous verrouiller hors de l'app** — la 3 et la 4. Elles
> passent avant tout le reste côté application, et pour cette raison.
>
> **Aucune étape n'est irréversible avant la 10**, qui est la seule à détruire
> quelque chose. Elle peut attendre des jours.

## Avant de commencer

Il faut en main : le script de semis committé, l'accès au tableau de bord
Supabase, les secrets GitHub du dépôt, et les deux machines qui portent un
`.env` local (le PC et le Pi).

Comptez la séquence 1 → 8 d'un seul trait. Entre la 7 et la 8, l'app pointe
sur une base neuve sans avoir été vérifiée dessus : c'est le seul moment
inconfortable de la procédure, et il ne doit pas durer une nuit.

## 0. Sauvegarder l'ancienne base, et vérifier la sauvegarde

Clic droit sur `backup-dokodoko.ps1` → Exécuter avec PowerShell. Le script
contrôle lui-même la taille et le nombre de tables porteuses de données ; s'il
ne se déclare pas valide, **ne continuez pas**.

C'est le moment où tout le travail de sauvegarde se paie. Ce dump est la seule
chose qui restera de l'ancienne base après l'étape 10, et il contient des
données réelles de client : il reste dans `C:\dokodoko-backups`, hors du
dépôt, et il n'en sort pas.

## 1. Créer le nouveau projet Supabase

Notez immédiatement, hors du dépôt : l'URL du projet, la région, et le **mot
de passe de la base**. Le mot de passe ne s'affiche qu'une fois.

## 2. Appliquer toutes les migrations du dépôt, dans l'ordre

Sans exception et sans en sauter une, même celles qui semblent redondantes.

**Un échec à cette étape est une bonne nouvelle.** Il nomme ce qui avait été
appliqué à la main sur l'ancienne base sans jamais devenir un fichier — et il
le dit au seul moment où ça ne coûte rien. Corrigez en ajoutant la migration
manquante au dépôt, puis reprenez depuis le début de l'étape 2 sur une base
remise à zéro. Ne corrigez jamais à la main pour « débloquer » : ce serait
reproduire exactement le défaut que cette étape vient de révéler.

## 3. Configurer l'envoi des codes par e-mail

SMTP personnalisé et modèles de message, comme sur l'ancien projet
(`supabase/README.md` §3).

**Sans cette étape, personne ne peut se connecter**, et le défaut ne se voit
qu'au moment où vous essayez. L'authentification se fait par code reçu par
e-mail, pas par lien : il n'y a pas de repli.

## 4. Peupler la liste blanche

Votre adresse dans `autorises`, à la main, dans l'éditeur SQL.

**C'est l'étape qui verrouille.** La liste blanche garde tous les écrans ;
vide, elle refuse tout le monde, vous compris. Elle ne fait pas partie du jeu
de démonstration et n'y entrera jamais : elle contient des adresses réelles,
et le dépôt est public.

## 5. Lancer le script de semis

Dans l'éditeur SQL : **`supabase/demo/semis.sql`**, tel quel.

Il s'exécute **en une seule transaction** et contrôle son propre résultat à la
fin. S'il échoue, il ne laisse rien derrière lui : la base revient à l'état de
l'étape 4, et c'est voulu. Un semis à moitié appliqué serait pire qu'un semis
raté, parce qu'il faudrait deviner où il s'est arrêté.

**Ne retouchez rien à la main.** Une correction dans l'éditeur SQL est
invisible au dépôt, donc perdue au prochain remontage — et elle casse les
contrôles sans rien dire. Si le jeu est faux, on corrige le script et on
recommence.

### Pas d'essai à blanc, et c'est raisonné

**Ce script n'a jamais tourné**, et sa première exécution sera celle-ci. La
version du 5 octobre de cette procédure proposait une répétition sur le
PostgreSQL installé en local en septembre ; elle est retirée le 6, sur le
chiffrage de Claude Code.

Un PostgreSQL ordinaire n'a ni les rôles `anon` / `authenticated` /
`service_role`, ni le schéma `auth`, ni `auth.jwt()` : l'étape 2 y échoue dès
la première policy. Il faudrait un prélude qui simule tout ça — et ce fichier
devrait ensuite suivre les internes de Supabase à chaque migration, pour un
usage unique. Une pièce qui ne sert qu'à rendre une répétition possible
pourrit en silence.

**Et l'essai aurait porté sur la mauvaise étape.** Ce que le semis peut rater,
ses propres contrôles l'attrapent, sur la vraie base, dans une transaction qui
ne laisse rien derrière elle : l'échec coûte une correction et un
relancement, pas une soirée. L'étape réellement incertaine est la **2**, les
migrations — et c'est précisément celle qu'un PostgreSQL local ne peut pas
éprouver, pour les raisons ci-dessus.

Un second projet Supabase jetable ne vaut pas mieux : toutes les étapes avant
la 10 sont réversibles, et un semis qui échoue laisse la base exactement à
l'état de l'étape 4, prête à être resemée. **La vraie exécution est la
répétition.**

## 6. Vérifier les comptes

Les cinq contrôles du script ont déjà tourné. Celui-ci est le vôtre, à l'œil :
3 clients, 24 références, 26 conditionnements, 75 emplacements, 18 références
portant du stock.

## 7. Basculer l'application sur la nouvelle base

La clé publique change avec le projet, donc **trois endroits**, et en oublier
un donne une panne déroutante :

- les secrets GitHub du dépôt (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) ;
- le `.env` local du PC ;
- le `.env` local du Pi.

Puis un déploiement, qui part tout seul sur `main`.

## 8. Vérifier sur l'iPhone

Dans cet ordre, parce que chaque étape dépend de la précédente :

1. **Forcer la mise à jour de la PWA** — l'app propose une invite explicite. Le
   cache de l'ancienne version pointe encore sur l'ancienne base.
2. **Se déconnecter, puis se reconnecter par code.** La session de l'ancien
   projet est encore en mémoire locale et ne vaut plus rien. Si le code
   n'arrive pas, le problème est à l'étape 3.
3. **Dérouler les trois inventaires de la démonstration**
   (`docs/jeu-de-demonstration.md` §6) : par références, par client, puis
   `Tout`. C'est la vérification la plus complète disponible, et c'est aussi
   la première répétition de la démonstration.

   **Il faut les feuilles de comptage pour cette étape** — une par périmètre,
   générées depuis la base semée (`jeu-de-demonstration.md` §10). Sans elles,
   il n'y a rien à compter, et une feuille incomplète fabriquerait des écarts
   fantômes sur tout ce qu'elle n'énumère pas. Ne comptez que les lignes du
   bloc « feuille à cocher » ; l'annexe est là pour être vue, pas comptée.

   **Un seul geste à ne pas faire : saisir autre chose que zéro sur
   `VRN009`.** Elle est inactive, et lui donner du stock la réactive — c'est
   la règle, et c'est même ce que le fait 4 vérifie en creux. Abandonner
   l'inventaire ne défait pas la réactivation.

   **Si ça arrive, c'est réparable, et il faut savoir comment** : abandonnez
   l'inventaire, puis redésactivez `VRN009` au Catalogue. Sa désactivation
   sera acceptée parce que son stock est resté nul — **une ligne de comptage
   ne déplace aucun stock**, seule une clôture en écrirait. La porte paraît à
   sens unique, elle ne l'est pas ; mais sans le savoir on croit le jeu de
   démonstration perdu.

   **Chaque inventaire s'abandonne avant de lancer le suivant** (un seul
   `en_cours` à la fois, motif libre demandé). Les trois inventaires
   abandonnés restent en base ensuite, avec leurs lignes de comptage, et c'est
   sans conséquence : rien ne les affiche, et le théorique se recalcule à
   chaque lancement. Le détail est au §1 du jeu de démonstration.

## 9. Remettre la sauvegarde en service

Le script pointe encore sur l'ancien projet. Remplacez la chaîne de connexion
dans `backup-dokodoko.ps1` — qui reste dans `C:\dokodoko-backups`, jamais dans
le dépôt — et mettez à jour `docs/sauvegarde.md` si la procédure a changé.

Puis **lancez une sauvegarde et vérifiez-la**. Une sauvegarde qu'on n'a pas
relancée après un changement de base est un fichier qui parle d'une base qui
n'existe plus.

Même chose pour le minuteur systemd du Pi, s'il porte la chaîne de connexion.

## 10. Détruire l'ancien projet

Seulement maintenant, et sans se presser : un projet gratuit inactif se met en
pause tout seul sans perdre ses données, donc rien n'oblige à trancher le jour
même. Attendez d'avoir utilisé la nouvelle base une fois ou deux.

Ce qui part avec le projet : le dernier référentiel réel de client. Le dump de
l'étape 0 est ce qui en reste, et il vit hors du dépôt, sur une machine.

## Ce que cette procédure prouve, au-delà de son résultat

Si l'étape 2 passe sans accroc, alors **toute la base est reconstructible
depuis le dépôt**, et c'est la propriété qui permettra d'en monter une pour un
client sans rien improviser. Si elle accroche, la procédure a trouvé une dette
que personne ne cherchait.

C'est la raison pour laquelle le jeu de démonstration n'est **pas** dans la
chaîne de migrations : les migrations décrivent un schéma valable pour
n'importe quelle base, le semis ne décrit qu'une vitrine. Les mélanger
donnerait à un vrai client une base qui démarre avec trois faux clients
dedans.
