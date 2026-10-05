-- Semis du jeu de démonstration — どこどこ
--
-- Destination : éditeur SQL Supabase, sur une base neuve, APRÈS toutes les
-- migrations (docs/base-neuve.md étape 5) et APRÈS la liste blanche
-- (étape 4). Conçu par docs/jeu-de-demonstration.md ; en cas de divergence
-- entre ce document et ce script, c'est le document qui dit ce qui était
-- voulu — le corriger plutôt que corriger ce script en silence.
--
-- Ce script n'est PAS un fichier de migration (jeu de démonstration §9) :
-- il ne décrit pas un schéma valable pour n'importe quelle base, il peuple
-- une vitrine. Il ne doit jamais entrer dans supabase/migrations/.
--
-- Une seule transaction. Un seul bloc DO, pour que l'atomicité ne dépende
-- d'aucune hypothèse sur la façon dont l'éditeur SQL découpe un script en
-- instructions : un DO est une instruction unique, donc une transaction
-- unique de la part de Postgres, quel que soit le client qui l'envoie. Si
-- un contrôle échoue, RAISE EXCEPTION annule tout ce que ce bloc a écrit —
-- rien n'est laissé à moitié posé.
--
-- Rejeu idempotent : chaque ligne porte un id dérivé de ce qu'elle
-- représente (clients/références par leur code, conditionnements par
-- (ref, pièces/carton), emplacements par leur code, mouvements par une clé
-- stable) et chaque écriture se termine par ON CONFLICT ... DO NOTHING. Une
-- seconde exécution ne pose rien de plus, et les contrôles de fin
-- continuent de passer puisqu'ils portent sur l'état final, pas sur le
-- nombre de lignes posées à cet instant.
--
-- Déviation volontaire, signalée à l'agent d'architecture plutôt que
-- tranchée en silence : la ligne d'annulation plantée au §7 du jeu de
-- démonstration NE porte PAS `annule_mouvement_id`. L'écran Mouvement ne
-- pose jamais cette colonne aujourd'hui (dette assumée, spec v2 §14,
-- toujours vraie au 6 octobre 2026) — le commentaire obligatoire est la
-- seule trace que l'app sait produire pour une annulation. Y renseigner
-- `annule_mouvement_id` ici aurait posé en base un état que l'app elle-même
-- ne sait pas écrire, exactement ce que docs/base-neuve.md refuse pour la
-- clôture d'inventaire — le même principe, appliqué ici.
--
-- Les identifiants de mouvement du lot d'ouverture reproduisent EXACTEMENT
-- `deriveMouvementId` (src/lib/csvImport.ts) : préfixe
-- 'dokodoko:stock-ouverture:', clé `lot|référence|emplacement|conditionnement_id`,
-- SHA-1, octets 6 et 8 repositionnés (version 5 / variante RFC 4122),
-- tronqué à 16 octets. Un futur réimport du même lot ('ouverture-demo')
-- par l'écran d'import le reconnaîtrait donc comme déjà posé. Les
-- mouvements postérieurs à l'ouverture n'ont pas cette contrainte — l'app
-- leur donne un id aléatoire à chaque saisie réelle, jamais dérivé — donc
-- ce script leur donne un id dérivé d'une étiquette propre à ce script
-- (préfixe 'dokodoko:demo-seed:'), uniquement pour que CE script soit
-- rejouable ; cette dérivation-là n'a pas d'équivalent dans l'app et n'a
-- pas besoin d'en avoir.

do $$
declare
  n int;
begin

-- `digest()` (pgcrypto) vit en général dans le schéma `extensions` sur
-- Supabase. Un nom de schéma absent de search_path ne lève aucune erreur
-- (il est simplement ignoré à la résolution), donc cet ajout est sans
-- risque même si l'installation diffère.
set local search_path = public, extensions;

-- =====================================================================
-- 1. Clients
-- =====================================================================

insert into clients (code, nom) values
  ('VERNALIS', 'Vernalis'),
  ('MIRAVEL',  'Miravel'),
  ('KALISTE',  'Kaliste')
on conflict (code) do nothing;

-- =====================================================================
-- 2. Références (24 : 2 inactives, actif par défaut = true sinon)
-- =====================================================================

insert into "references" (code, libelle, client_code, actif) values
  ('VRN001', 'Shampooing argile douce 250 ml',     'VERNALIS', true),
  ('VRN002', 'Après-shampooing karité 200 ml',      'VERNALIS', true),
  ('VRN003', 'Savon de Marseille 300 g',            'VERNALIS', true),
  ('VRN004', 'Huile capillaire 100 ml',             'VERNALIS', true),
  ('VRN005', 'Crème mains lavande 75 ml',           'VERNALIS', true),
  ('VRN006', 'Baume à lèvres 15 ml',                'VERNALIS', true),
  ('VRN007', 'Eau florale de rose 200 ml',          'VERNALIS', true),
  ('VRN008', 'Gel douche agrumes 500 ml',           'VERNALIS', true),
  ('VRN009', 'Masque argile verte 150 ml',          'VERNALIS', false),
  ('VRN010', 'Coffret découverte 4 pièces',         'VERNALIS', true),
  ('MRV001', 'Matelas bébé 60x120',                 'MIRAVEL',  true),
  ('MRV002', 'Matelas bébé 70x140',                 'MIRAVEL',  true),
  ('MRV003', 'Surmatelas coton 60x120',             'MIRAVEL',  true),
  ('MRV004', 'Parc pliant hexagonal',               'MIRAVEL',  true),
  ('MRV005', 'Tapis d''éveil matelassé',            'MIRAVEL',  true),
  ('MRV006', 'Gigoteuse 6-18 mois',                 'MIRAVEL',  true),
  ('MRV007', 'Tour de lit tressé',                  'MIRAVEL',  true),
  ('MRV008', 'Drap-housse 60x120, lot de 2',        'MIRAVEL',  false),
  ('KLS001', 'Confiture d''abricot 370 g',          'KALISTE',  true),
  ('KLS002', 'Miel de châtaignier 500 g',           'KALISTE',  true),
  ('KLS003', 'Huile d''olive vierge extra 750 ml',  'KALISTE',  true),
  ('KLS004', 'Terrine de campagne 180 g',           'KALISTE',  true),
  ('KLS005', 'Sel de Guérande 1 kg',                'KALISTE',  true),
  ('KLS006', 'Biscuits sablés 150 g',                'KALISTE',  true)
on conflict (code) do nothing;

-- =====================================================================
-- 3. Conditionnements (26 : 24 références simples + 2 doubles)
-- Id déterministe sur (ref, pièces/carton) — propre à ce script, la
-- colonne n'a pas d'équivalent app à reproduire.
-- =====================================================================

insert into conditionnements (id, ref_code, pieces_par_carton, a_ecouler)
select md5('dokodoko:demo-seed:conditionnement:' || v.ref || '|' || v.ppc)::uuid,
       v.ref, v.ppc, v.a_ecouler
from (values
  ('VRN001', 12, false),
  ('VRN002', 12, false),
  ('VRN003', 24, false),
  ('VRN004', 24, true),   -- à écouler
  ('VRN004', 12, false),  -- actuel
  ('VRN005', 36, false),
  ('VRN006', 60, false),
  ('VRN007', 12, false),
  ('VRN008',  6, false),
  ('VRN009', 12, false),
  ('VRN010',  8, false),
  ('MRV001',  1, false),
  ('MRV002',  1, false),
  ('MRV003',  2, false),
  ('MRV004',  1, false),
  ('MRV005',  4, false),
  ('MRV006', 10, false),
  ('MRV007',  6, false),
  ('MRV008', 12, false),
  ('KLS001', 12, false),
  ('KLS002',  6, false),
  ('KLS003',  6, false),
  ('KLS004', 24, true),   -- à écouler
  ('KLS004', 12, false),  -- actuel
  ('KLS005', 10, false),
  ('KLS006', 20, false)
) as v(ref, ppc, a_ecouler)
on conflict (id) do nothing;

-- =====================================================================
-- 4. Emplacements (75), générés comme le générateur en lot des Réglages :
-- baie en boucle extérieure, niveau en boucle intérieure, ordre séquentiel.
-- =====================================================================

insert into emplacements (code, zone, baie, niveau, ordre)
select z.zone || '-' || lpad(z.baie::text, 2, '0') || '-' || z.niveau::text,
       z.zone, z.baie, z.niveau,
       row_number() over (order by z.zone_rang, z.baie, z.niveau)
from (
  select 'A'::text as zone, 1 as zone_rang, baie, niveau
    from generate_series(1, 12) baie, generate_series(1, 3) niveau
  union all
  select 'B', 2, baie, niveau
    from generate_series(1, 8) baie, generate_series(1, 3) niveau
  union all
  select 'C', 3, baie, niveau
    from generate_series(1, 6) baie, generate_series(1, 2) niveau
  union all
  select 'AB', 4, baie, 0
    from generate_series(1, 2) baie
  union all
  select 'BC', 5, baie, 0
    from generate_series(1, 1) baie
) z
on conflict (code) do nothing;

-- =====================================================================
-- 5. Lot d'ouverture (motif stock_initial, étiquette 'ouverture-demo',
-- un seul ts pour tout le lot — comme un seul appel de
-- commitStockOuvertureImport). 22 lignes ; pose la majeure partie du
-- stock. KLS001 est volontairement absent d'ici : son stock entier vient
-- de la réception erronée plantée plus bas (fait 3).
-- =====================================================================

insert into mouvements (id, ts, ref_code, emplacement_code, quantite_pieces, motif, conditionnement_id, auteur)
select
  (encode(
     set_byte(
       set_byte(h.b, 6, (get_byte(h.b, 6) & 15) | 80),
       8, (get_byte(h.b, 8) & 63) | 128
     ),
     'hex'
   ))::uuid,
  now() - interval '90 days',
  v.ref, v.empl, v.cartons * c.pieces_par_carton,
  'stock_initial'::motif_mouvement,
  c.id,
  'semis-demo@dokodoko.invalid'
from (values
  ('VRN001', 'C-05-1', 12, 10),
  ('VRN002', 'C-06-1', 12, 15),
  ('VRN003', 'B-03-1', 24, 40),
  ('VRN004', 'A-01-1', 24,  7),
  ('VRN004', 'A-01-2', 12, 11),
  ('VRN005', 'C-01-1', 36, 14),
  ('VRN005', 'C-03-1', 36,  4),
  ('VRN006', 'C-03-1', 60,  5),
  ('VRN009', 'C-04-2', 12,  5),
  ('VRN010', 'C-05-2',  8,  6),
  ('MRV001', 'A-02-1',  1, 20),
  ('MRV002', 'A-07-2',  1, 18),
  ('MRV004', 'A-10-1',  1, 12),
  ('MRV004', 'A-10-2',  1,  9),
  ('MRV005', 'A-03-1',  4,  8),
  ('MRV006', 'A-04-1', 10, 10),
  ('MRV007', 'A-05-1',  6,  5),
  ('KLS002', 'B-05-1',  6,  8),
  ('KLS003', 'B-05-1',  6, 10),
  ('KLS004', 'B-06-1', 24,  6),
  ('KLS004', 'B-06-2', 12,  9),
  ('KLS006', 'B-07-1', 20, 15)
) as v(ref, empl, ppc, cartons)
join conditionnements c on c.ref_code = v.ref and c.pieces_par_carton = v.ppc
cross join lateral (
  select substring(
           digest('dokodoko:stock-ouverture:ouverture-demo|' || v.ref || '|' || v.empl || '|' || c.id::text, 'sha1')
           from 1 for 16
         ) as b
) h
on conflict (id) do nothing;

-- =====================================================================
-- 6. Mouvements postérieurs à l'ouverture, répartis sur les 12 semaines
-- suivantes : réapprovisionnements, sorties de commande, trois transferts
-- (dont un vers une inter-allée), une annulation commentée, et les deux
-- sorties qui épuisent VRN009 (fait 4). Les quatre plus récents (jours_avant
-- 4, 4, 2, 1) tombent dans les cinq derniers jours. Id dérivé d'une
-- étiquette propre à ce script (voir en-tête) ; transfert_id dérivé d'une
-- étiquette de transfert partagée par les deux jambes.
-- =====================================================================

insert into mouvements (id, ts, ref_code, emplacement_code, quantite_pieces, motif, conditionnement_id, auteur, transfert_id, commentaire)
select
  md5('dokodoko:demo-seed:mouvement:' || v.label)::uuid,
  now() - (v.jours_avant || ' days')::interval + (v.decalage_s || ' seconds')::interval,
  v.ref, v.empl, v.cartons * c.pieces_par_carton * v.signe,
  v.motif::motif_mouvement,
  c.id,
  'semis-demo@dokodoko.invalid',
  case when v.transfert_label is null then null
       else md5('dokodoko:demo-seed:transfert:' || v.transfert_label)::uuid end,
  v.commentaire
from (values
  -- VRN009 : cycle complet (fait 4) — reçue, vendue, épuisée, retirée.
  ('vrn009-sortie1',           'VRN009', 'C-04-2', 12,  3, -1, 'commande_client',   45, 0, null::text, null::text),
  ('vrn009-sortie2',           'VRN009', 'C-04-2', 12,  2, -1, 'destruction',       30, 0, null,       null),
  -- Transfert 1 (vers une inter-allée) : VRN005, C-01-1 -> AB-02-0.
  ('vrn005-transfert-sortie',  'VRN005', 'C-01-1', 36,  3, -1, 'transfert_sortie',  60, 0, 'T1-vrn005-ab02', null),
  ('vrn005-transfert-entree',  'VRN005', 'AB-02-0',36,  3,  1, 'transfert_entree',  60, 0, 'T1-vrn005-ab02', null),
  ('vrn006-reception1',        'VRN006', 'C-03-1', 60,  2,  1, 'reception',         35, 0, null,       null),
  ('vrn006-sortie-defaillant', 'VRN006', 'C-03-1', 60,  1, -1, 'produit_defaillant',20, 0, null,       null),
  -- KLS001 (fait 3) : toute la ligne vient de cette unique réception.
  ('kls001-reception-erreur',  'KLS001', 'C-02-1', 12, 21,  1, 'reception',         21, 0, null,       null),
  -- Annulation (§7) : commentaire obligatoire, PAS de annule_mouvement_id
  -- (voir en-tête).
  ('mrv001-sortie-erreur',     'MRV001', 'A-02-1',  1,  5, -1, 'commande_client',   15, 0,  null, null),
  ('mrv001-annulation',        'MRV001', 'A-02-1',  1,  5,  1, 'annulation',        15, 60, null,
     'Annulée : sortie saisie par erreur, la commande n''a jamais eu lieu.'),
  -- Transfert 2 : MRV006, A-04-1 -> A-04-2.
  ('mrv006-transfert-sortie',  'MRV006', 'A-04-1', 10,  4, -1, 'transfert_sortie',  55, 0, 'T2-mrv006-a04', null),
  ('mrv006-transfert-entree',  'MRV006', 'A-04-2', 10,  4,  1, 'transfert_entree',  55, 0, 'T2-mrv006-a04', null),
  ('mrv007-reception1',        'MRV007', 'A-05-1',  6,  3,  1, 'reception',         40, 0, null,       null),
  ('kls003-sortie1',           'KLS003', 'B-05-1',  6,  3, -1, 'commande_client',   25, 0, null,       null),
  -- Transfert 3 : VRN002, C-06-1 -> C-06-2. Dans les cinq derniers jours.
  ('vrn002-transfert-sortie',  'VRN002', 'C-06-1', 12,  6, -1, 'transfert_sortie',   4, 0, 'T3-vrn002-c06', null),
  ('vrn002-transfert-entree',  'VRN002', 'C-06-2', 12,  6,  1, 'transfert_entree',   4, 0, 'T3-vrn002-c06', null),
  ('kls002-reception1',        'KLS002', 'B-05-1',  6,  4,  1, 'reception',          2, 0, null,       null),
  ('vrn001-sortie1',           'VRN001', 'C-05-1', 12,  2, -1, 'commande_client',    1, 0, null,       null),
  ('vrn001-reception1',        'VRN001', 'C-05-1', 12,  3,  1, 'reception',         70, 0, null,       null),
  ('vrn005-reception-c03',     'VRN005', 'C-03-1', 36,  1,  1, 'reception',         50, 0, null,       null),
  ('vrn010-reception1',        'VRN010', 'C-05-2',  8,  2,  1, 'reception',         25, 0, null,       null),
  ('mrv004-reception-a10-1',   'MRV004', 'A-10-1',  1,  3,  1, 'reception',         45, 0, null,       null),
  ('mrv004-sortie-a10-2',      'MRV004', 'A-10-2',  1,  2, -1, 'commande_client',   30, 0, null,       null),
  ('mrv005-reception1',        'MRV005', 'A-03-1',  4,  2,  1, 'reception',         50, 0, null,       null),
  ('kls004-reception-b06-1',   'KLS004', 'B-06-1', 24,  2,  1, 'reception',         50, 0, null,       null),
  ('kls004-sortie-b06-2',      'KLS004', 'B-06-2', 12,  3, -1, 'commande_client',   35, 0, null,       null)
) as v(label, ref, empl, ppc, cartons, signe, motif, jours_avant, decalage_s, transfert_label, commentaire)
join conditionnements c on c.ref_code = v.ref and c.pieces_par_carton = v.ppc
on conflict (id) do nothing;

-- =====================================================================
-- 7. Contrôles — §8 du jeu de démonstration. Tout échec annule le bloc
-- entier (RAISE EXCEPTION), rien n'est laissé à moitié posé.
-- =====================================================================

-- 7.1 Comptes par table.
select count(*) into n from clients;
if n <> 3 then raise exception 'Contrôle comptes : attendu 3 clients, trouvé %', n; end if;

select count(*) into n from "references";
if n <> 24 then raise exception 'Contrôle comptes : attendu 24 références, trouvé %', n; end if;

select count(*) into n from conditionnements;
if n <> 26 then raise exception 'Contrôle comptes : attendu 26 conditionnements, trouvé %', n; end if;

select count(*) into n from emplacements;
if n <> 75 then raise exception 'Contrôle comptes : attendu 75 emplacements, trouvé %', n; end if;

select count(distinct ref_code) into n from stock where quantite_pieces <> 0;
if n <> 18 then raise exception 'Contrôle comptes : attendu 18 références portant du stock, trouvé %', n; end if;

-- 7.2 Chaque référence inactive est à stock nul (invariant du drapeau vrai
-- dès la naissance de la base).
if exists (
  select 1
  from mouvements m
  join "references" r on r.code = m.ref_code
  where r.actif = false
  group by m.ref_code
  having sum(m.quantite_pieces) <> 0
) then
  raise exception 'Contrôle drapeau actif : une référence inactive porte un stock non nul';
end if;

-- 7.3 Aucune position négative à aucun instant, triplet par triplet — pas
-- seulement au solde final : les policies de l'app refusent une sortie
-- supérieure au stock AU MOMENT où elle est saisie, donc un solde qui
-- descendrait sous zéro en cours de route serait un état impossible.
if exists (
  select 1 from (
    select sum(quantite_pieces) over (
             partition by ref_code, emplacement_code, conditionnement_id
             order by ts, id
           ) as solde_courant
    from mouvements
  ) t
  where t.solde_courant < 0
) then
  raise exception 'Contrôle position négative : un solde intermédiaire descend sous zéro';
end if;

-- 7.4 Stock attendu == stock réel, dans les deux sens (un triplet réel
-- absent de la table attendue est une erreur autant qu'un triplet attendu
-- absent de la base). Table écrite à la main, dans l'unité du document
-- (référence, casier, pièces/carton, cartons) — jamais recalculée depuis
-- les lignes posées ci-dessus.
create temporary table _stock_attendu (
  ref_code text, emplacement_code text, pieces_par_carton int, cartons int
) on commit drop;

insert into _stock_attendu (ref_code, emplacement_code, pieces_par_carton, cartons) values
  ('VRN001', 'C-05-1',  12, 11),
  ('VRN002', 'C-06-1',  12,  9),
  ('VRN002', 'C-06-2',  12,  6),
  ('VRN003', 'B-03-1',  24, 40),
  ('VRN004', 'A-01-1',  24,  7),
  ('VRN004', 'A-01-2',  12, 11),
  ('VRN005', 'C-01-1',  36, 11),
  ('VRN005', 'C-03-1',  36,  5),
  ('VRN005', 'AB-02-0', 36,  3),
  ('VRN006', 'C-03-1',  60,  6),
  ('VRN009', 'C-04-2',  12,  0),
  ('VRN010', 'C-05-2',   8,  8),
  ('MRV001', 'A-02-1',   1, 20),
  ('MRV002', 'A-07-2',   1, 18),
  ('MRV004', 'A-10-1',   1, 15),
  ('MRV004', 'A-10-2',   1,  7),
  ('MRV005', 'A-03-1',   4, 10),
  ('MRV006', 'A-04-1',  10,  6),
  ('MRV006', 'A-04-2',  10,  4),
  ('MRV007', 'A-05-1',   6,  8),
  ('KLS001', 'C-02-1',  12, 21),
  ('KLS002', 'B-05-1',   6, 12),
  ('KLS003', 'B-05-1',   6,  7),
  ('KLS004', 'B-06-1',  24,  8),
  ('KLS004', 'B-06-2',  12,  6),
  ('KLS006', 'B-07-1',  20, 15);

if exists (
  select *
  from (
    select ref_code, emplacement_code, pieces_par_carton, cartons * pieces_par_carton as pieces
    from _stock_attendu
  ) exp
  full outer join (
    select s.ref_code, s.emplacement_code, c.pieces_par_carton, s.quantite_pieces as pieces
    from stock s
    join conditionnements c on c.id = s.conditionnement_id
  ) act
    on exp.ref_code = act.ref_code
   and exp.emplacement_code = act.emplacement_code
   and exp.pieces_par_carton = act.pieces_par_carton
  where exp.pieces is distinct from act.pieces
) then
  raise exception 'Contrôle stock attendu : au moins un triplet diverge entre la table attendue et le stock réel';
end if;

-- 7.5 Les cinq faits plantés, nommément.

-- Fait 1 — MRV002 : 18 cartons (18 pièces, conditionnement à 1) en A-07-2,
-- et rien du tout en AB-01-0 (l'inter-allée de la feuille n'existe que sur
-- le papier).
if (select coalesce(sum(quantite_pieces), 0) from mouvements where ref_code = 'MRV002' and emplacement_code = 'A-07-2') <> 18 then
  raise exception 'Fait 1 (MRV002) : stock en A-07-2 différent de 18 pièces';
end if;
if exists (select 1 from mouvements where emplacement_code = 'AB-01-0') then
  raise exception 'Fait 1 (MRV002) : AB-01-0 ne doit porter aucun mouvement';
end if;

-- Fait 2 — VRN003 : 40 cartons à 24 pièces = 960 pièces en B-03-1.
if (select coalesce(sum(quantite_pieces), 0) from mouvements where ref_code = 'VRN003' and emplacement_code = 'B-03-1') <> 960 then
  raise exception 'Fait 2 (VRN003) : stock en B-03-1 différent de 960 pièces';
end if;

-- Fait 3 — KLS001 : 21 cartons à 12 pièces = 252 pièces en C-02-1.
if (select coalesce(sum(quantite_pieces), 0) from mouvements where ref_code = 'KLS001' and emplacement_code = 'C-02-1') <> 252 then
  raise exception 'Fait 3 (KLS001) : stock en C-02-1 différent de 252 pièces';
end if;

-- Fait 4 — VRN009 : inactive, au moins un mouvement en C-04-2, stock nul là.
if (select actif from "references" where code = 'VRN009') is distinct from false then
  raise exception 'Fait 4 (VRN009) : la référence doit être inactive';
end if;
if not exists (select 1 from mouvements where ref_code = 'VRN009' and emplacement_code = 'C-04-2') then
  raise exception 'Fait 4 (VRN009) : aucun mouvement en C-04-2';
end if;
if (select coalesce(sum(quantite_pieces), 0) from mouvements where ref_code = 'VRN009' and emplacement_code = 'C-04-2') <> 0 then
  raise exception 'Fait 4 (VRN009) : stock en C-04-2 différent de 0';
end if;

-- Fait 5 — KLS006 : 15 cartons à 20 pièces = 300 pièces en B-07-1,
-- rattachée à KALISTE (le périmètre que l'inventaire par références
-- contourne).
if (select coalesce(sum(quantite_pieces), 0) from mouvements where ref_code = 'KLS006' and emplacement_code = 'B-07-1') <> 300 then
  raise exception 'Fait 5 (KLS006) : stock en B-07-1 différent de 300 pièces';
end if;
if (select client_code from "references" where code = 'KLS006') is distinct from 'KALISTE' then
  raise exception 'Fait 5 (KLS006) : la référence doit appartenir à KALISTE';
end if;

raise notice 'Semis du jeu de démonstration : tous les contrôles ont passé.';

end $$;
