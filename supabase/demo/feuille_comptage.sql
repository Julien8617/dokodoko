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
-- protéger : contrairement au semis, relancer une de ces requêtes dix fois
-- ne change rien à la base.
--
-- Principe d'exhaustivité (§10, relevé par Claude Code en écrivant le
-- semis) : chaque requête liste TOUTE ligne de la vue `stock` pour les
-- références du périmètre — pas seulement « pièces > 0 ». La vue `stock`
-- ne porte une ligne que si au moins un mouvement existe pour ce triplet ;
-- un triplet jamais touché n'y apparaît pas et retombe, à bon droit, sur le
-- zéro implicite (rien à vérifier, rien à planter). Un triplet touché mais
-- dont le solde net est nul (VRN009/C-04-2, fait 4) apparaît quand même,
-- avec 0 — c'est exactement le casier que le visiteur doit aller constater
-- vide. Omettre un triplet non nul de la feuille fabriquerait un écart
-- fantôme ; cette requête ne peut pas le faire par construction, puisqu'elle
-- part de `stock` et non d'une liste écrite à la main.
--
-- Les trois divergences (jeu de démonstration §10) sont appliquées par la
-- table `substitutions` ci-dessous, déclarée une fois : (référence, casier
-- où la base porte le stock, casier annoncé par la feuille, cartons annoncés
-- par la feuille). Un petit nombre de pièces par carton étant garanti exact
-- pour chaque triplet planté ici (voir semis.sql), `cartons` et
-- `total_pieces` dérivent l'un de l'autre sans reste.
--
-- Trois requêtes, une par périmètre de démonstration (jeu de démonstration
-- §6, mode opératoire) : par références, par client, Tout. Même structure,
-- seul le CTE `perimetre` change. Mise en forme (une page par périmètre,
-- cases à cocher en tête de ligne) : au moment où ce résultat devient un
-- document imprimable, pas ici — cette requête donne les chiffres, pas la
-- page.

-- =====================================================================
-- Démonstration 1 — périmètre par références : VRN003, VRN005, MRV002.
-- Révèle les faits 1, 2 et 5.
-- =====================================================================

with substitutions (ref_code, casier_source, casier_feuille, cartons_feuille) as (
  values
    ('MRV002', 'A-07-2', 'AB-01-0', 18),  -- fait 1 : déplacement, écart net nul
    ('VRN003', 'B-03-1', 'B-03-1',  34),  -- fait 2 : manque de 6 cartons
    ('KLS001', 'C-02-1', 'C-02-1',  21)   -- fait 3 : surplus de 9 cartons (hors périmètre de cette démo, gardé pour mémoire — voir démo "Tout")
),
perimetre (ref_code) as (
  values ('VRN003'), ('VRN005'), ('MRV002')
)
select
  coalesce(sub.casier_feuille, s.emplacement_code)                as casier,
  r.code,
  r.libelle,
  c.pieces_par_carton,
  coalesce(sub.cartons_feuille, s.quantite_pieces / c.pieces_par_carton) as cartons,
  coalesce(sub.cartons_feuille * c.pieces_par_carton, s.quantite_pieces) as total_pieces
from stock s
join perimetre p on p.ref_code = s.ref_code
join "references" r on r.code = s.ref_code
join conditionnements c on c.id = s.conditionnement_id
left join substitutions sub on sub.ref_code = s.ref_code and sub.casier_source = s.emplacement_code
order by casier, r.code;

-- =====================================================================
-- Démonstration 2 — périmètre par client : VERNALIS. Toutes les références
-- du client, actives ou non (spec §6.8 : aucun périmètre ne filtre les
-- inactives) — périmètre dérivé de `references.client_code`, pas une liste
-- écrite en dur, pour qu'il reste exact si le catalogue change.
-- Révèle les faits 2 et 4.
-- =====================================================================

with substitutions (ref_code, casier_source, casier_feuille, cartons_feuille) as (
  values
    ('MRV002', 'A-07-2', 'AB-01-0', 18),
    ('VRN003', 'B-03-1', 'B-03-1',  34),
    ('KLS001', 'C-02-1', 'C-02-1',  21)
),
perimetre (ref_code) as (
  select code from "references" where client_code = 'VERNALIS'
)
select
  coalesce(sub.casier_feuille, s.emplacement_code)                as casier,
  r.code,
  r.libelle,
  c.pieces_par_carton,
  coalesce(sub.cartons_feuille, s.quantite_pieces / c.pieces_par_carton) as cartons,
  coalesce(sub.cartons_feuille * c.pieces_par_carton, s.quantite_pieces) as total_pieces
from stock s
join perimetre p on p.ref_code = s.ref_code
join "references" r on r.code = s.ref_code
join conditionnements c on c.id = s.conditionnement_id
left join substitutions sub on sub.ref_code = s.ref_code and sub.casier_source = s.emplacement_code
order by casier, r.code;

-- =====================================================================
-- Démonstration 3 — périmètre Tout : toutes les références, actives ou
-- non. Révèle les faits 1 à 4 (pas le 5 : rien à étendre quand tout est
-- déjà dans le périmètre).
-- =====================================================================

with substitutions (ref_code, casier_source, casier_feuille, cartons_feuille) as (
  values
    ('MRV002', 'A-07-2', 'AB-01-0', 18),
    ('VRN003', 'B-03-1', 'B-03-1',  34),
    ('KLS001', 'C-02-1', 'C-02-1',  21)
),
perimetre (ref_code) as (
  select code from "references"
)
select
  coalesce(sub.casier_feuille, s.emplacement_code)                as casier,
  r.code,
  r.libelle,
  c.pieces_par_carton,
  coalesce(sub.cartons_feuille, s.quantite_pieces / c.pieces_par_carton) as cartons,
  coalesce(sub.cartons_feuille * c.pieces_par_carton, s.quantite_pieces) as total_pieces
from stock s
join perimetre p on p.ref_code = s.ref_code
join "references" r on r.code = s.ref_code
join conditionnements c on c.id = s.conditionnement_id
left join substitutions sub on sub.ref_code = s.ref_code and sub.casier_source = s.emplacement_code
order by casier, r.code;
