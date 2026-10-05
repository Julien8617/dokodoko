-- Feuille de comptage — どこどこ, jeu de démonstration
--
-- Destination : éditeur SQL Supabase, APRÈS `semis.sql` (docs/base-neuve.md
-- étape 8.3). Conçue par docs/jeu-de-demonstration.md §10 : générée, jamais
-- rédigée à la main — une feuille écrite serait une quatrième adresse
-- portant les mêmes chiffres après le document, le script et la base, et la
-- première retouche du semis la rendrait fausse sans que rien ne le signale.
-- On la régénère après chaque changement de `semis.sql`.
--
-- Lecture seule. Aucune écriture, aucun bloc DO, pas de transaction à
-- protéger : contrairement au semis, relancer cette requête dix fois ne
-- change rien à la base.
--
-- Un seul SELECT pour les trois périmètres de démonstration (jeu de
-- démonstration §6, mode opératoire), discriminés par la colonne
-- `demonstration` — pas trois requêtes séparées. L'éditeur SQL Supabase
-- n'affiche que le résultat de la dernière instruction d'un script à
-- plusieurs instructions : trois SELECT y auraient caché les deux
-- premiers, et la table `substitutions` s'y serait déclarée trois fois là
-- où le document dit « une fois ».
--
-- Deux blocs par périmètre (§10, seconde passe du 6 octobre) — une feuille
-- de comptage ne porte que le périmètre, mais une démonstration sur papier
-- n'a pas d'entrepôt physique en dehors du papier : sans un second bloc,
-- une référence hors périmètre qui partage un casier de la tournée (`VRN006`
-- en `C-03-1`, fait 5) n'existerait nulle part, et personne ne taperait
-- jamais son code. Les deux blocs viennent de la même requête, sur les
-- mêmes données, discriminés par la colonne `bloc` :
--   - « feuille à cocher » : le périmètre, casier par casier — la seule
--     partie qui se compte, celle qui a des cases à cocher sur la page
--     imprimée ;
--   - « vous voyez aussi, dans les mêmes casiers » : les références HORS
--     périmètre qui ont du stock dans un casier que la tournée du
--     périmètre visite déjà. Calculée, jamais écrite — les casiers visités
--     se déduisent de la feuille à cocher elle-même (après substitutions),
--     pas d'une liste à part qui pourrait diverger d'elle.
--
-- Principe d'exhaustivité du bloc « feuille à cocher » (§10, relevé par
-- Claude Code en écrivant le semis) : chaque périmètre liste TOUTE ligne de
-- la vue `stock` pour ses références — pas seulement « pièces > 0 ». La vue
-- `stock` ne porte une ligne que si au moins un mouvement existe pour ce
-- triplet ; un triplet jamais touché n'y apparaît pas et retombe, à bon
-- droit, sur le zéro implicite (rien à vérifier, rien à planter). Un
-- triplet touché mais dont le solde net est nul (VRN009/C-04-2, fait 4)
-- apparaît quand même, avec 0 — c'est exactement le casier que le visiteur
-- doit aller constater vide. Omettre un triplet non nul de ce bloc
-- fabriquerait un écart fantôme ; cette requête ne peut pas le faire par
-- construction, puisqu'elle part de `stock` et non d'une liste écrite à la
-- main.
--
-- Les trois divergences (jeu de démonstration §10) sont appliquées par la
-- table `substitutions` ci-dessous, déclarée une seule fois : (référence,
-- casier où la base porte le stock, casier annoncé par la feuille, cartons
-- annoncés par la feuille) — et la même transformation s'applique à toute
-- ligne, qu'elle tombe dans le premier bloc ou dans le second, pour que
-- « ce que le visiteur verrait d'écrit » reste cohérent partout.
--
-- Mise en forme (une page par périmètre, cases à cocher en tête de ligne
-- sur le premier bloc seulement, trié par casier puis par référence) : au
-- moment où ce résultat devient un document imprimable, pas ici — cette
-- requête donne les chiffres des deux blocs, pas la page.

with substitutions (ref_code, casier_source, casier_feuille, cartons_feuille) as (
  values
    ('MRV002', 'A-07-2', 'AB-01-0', 18),  -- fait 1 : déplacement, écart net nul
    ('VRN003', 'B-03-1', 'B-03-1',  34),  -- fait 2 : manque de 6 cartons
    ('KLS001', 'C-02-1', 'C-02-1',  21)   -- fait 3 : surplus de 9 cartons que la base ignorait
),
perimetre (demonstration, ref_code) as (
  select '1 - par références (VRN003, VRN005, MRV002)', v.ref_code
  from (values ('VRN003'), ('VRN005'), ('MRV002')) as v(ref_code)
  union all
  select '2 - par client VERNALIS', r.code
  from "references" r
  where r.client_code = 'VERNALIS'
  union all
  select '3 - Tout', r.code
  from "references" r
),
-- Toute ligne de stock, casier et cartons déjà résolus par les
-- substitutions — la même transformation pour une référence du périmètre
-- ou pour une référence qui n'y est pas.
feuille_rows as (
  select
    s.ref_code,
    coalesce(sub.casier_feuille, s.emplacement_code)                      as casier,
    r.libelle,
    c.pieces_par_carton,
    coalesce(sub.cartons_feuille, s.quantite_pieces / c.pieces_par_carton) as cartons,
    coalesce(sub.cartons_feuille * c.pieces_par_carton, s.quantite_pieces) as total_pieces
  from stock s
  join "references" r on r.code = s.ref_code
  join conditionnements c on c.id = s.conditionnement_id
  left join substitutions sub on sub.ref_code = s.ref_code and sub.casier_source = s.emplacement_code
),
-- Casiers que la tournée de chaque périmètre visite réellement, tels
-- qu'annoncés sur la feuille (après substitutions) — pas les casiers réels
-- de la base, puisque c'est la feuille que le visiteur suit à pied.
casiers_touches (demonstration, casier) as (
  select distinct p.demonstration, fr.casier
  from perimetre p
  join feuille_rows fr on fr.ref_code = p.ref_code
)
select p.demonstration, 'feuille à cocher' as bloc,
       fr.casier, fr.ref_code as code, fr.libelle, fr.pieces_par_carton, fr.cartons, fr.total_pieces
from perimetre p
join feuille_rows fr on fr.ref_code = p.ref_code

union all

select ct.demonstration, 'vous voyez aussi, dans les mêmes casiers' as bloc,
       fr.casier, fr.ref_code as code, fr.libelle, fr.pieces_par_carton, fr.cartons, fr.total_pieces
from casiers_touches ct
join feuille_rows fr on fr.casier = ct.casier
where not exists (
  select 1 from perimetre p2
  where p2.demonstration = ct.demonstration and p2.ref_code = fr.ref_code
)

order by demonstration, bloc, casier, code;
