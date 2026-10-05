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
-- Principe d'exhaustivité (§10, relevé par Claude Code en écrivant le
-- semis) : chaque périmètre liste TOUTE ligne de la vue `stock` pour ses
-- références — pas seulement « pièces > 0 ». La vue `stock` ne porte une
-- ligne que si au moins un mouvement existe pour ce triplet ; un triplet
-- jamais touché n'y apparaît pas et retombe, à bon droit, sur le zéro
-- implicite (rien à vérifier, rien à planter). Un triplet touché mais dont
-- le solde net est nul (VRN009/C-04-2, fait 4) apparaît quand même, avec 0
-- — c'est exactement le casier que le visiteur doit aller constater vide.
-- Omettre un triplet non nul de la feuille fabriquerait un écart fantôme ;
-- cette requête ne peut pas le faire par construction, puisqu'elle part de
-- `stock` et non d'une liste écrite à la main.
--
-- Les trois divergences (jeu de démonstration §10) sont appliquées par la
-- table `substitutions` ci-dessous, déclarée une seule fois : (référence,
-- casier où la base porte le stock, casier annoncé par la feuille, cartons
-- annoncés par la feuille).
--
-- Déficit connu, signalé à l'agent d'architecture et non corrigé ici (la
-- requête ne doit pas trancher seule) : le fait 5 (VRN006 en C-03-1) exige
-- que le visiteur découvre physiquement VRN006 pour taper son code — sans
-- entrepôt réel, cette feuille est le seul « rayon » qu'il voit, et §10 dit
-- qu'elle ne porte que les références du périmètre. Tel quel, rien ne dit
-- au visiteur que VRN006 est là. Voir le rapport de fin d'épisode.
--
-- Mise en forme (une page par périmètre, cases à cocher en tête de ligne) :
-- au moment où ce résultat devient un document imprimable, pas ici — cette
-- requête donne les chiffres, pas la page.

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
)
select
  p.demonstration,
  coalesce(sub.casier_feuille, s.emplacement_code)                      as casier,
  r.code,
  r.libelle,
  c.pieces_par_carton,
  coalesce(sub.cartons_feuille, s.quantite_pieces / c.pieces_par_carton) as cartons,
  coalesce(sub.cartons_feuille * c.pieces_par_carton, s.quantite_pieces) as total_pieces
from perimetre p
join stock s on s.ref_code = p.ref_code
join "references" r on r.code = p.ref_code
join conditionnements c on c.id = s.conditionnement_id
left join substitutions sub on sub.ref_code = s.ref_code and sub.casier_source = s.emplacement_code
order by p.demonstration, casier, r.code;
