-- どこどこ — schéma initial (spec v2 §3, §4, §5)
--
-- Principes non négociables traduits ici :
--   * le stock n'est jamais une colonne, seulement la vue `stock` ;
--   * `mouvements` est un journal append-only : ni UPDATE ni DELETE,
--     y compris émis directement (critère d'acceptation 23) — appliqué
--     par trigger, pas seulement par policy, pour tenir même avec une
--     clé service_role utilisée par erreur ;
--   * `conditionnements` est immuable sur (ref_code, pieces_par_carton) —
--     un nouveau taux crée une nouvelle ligne (§4) ;
--   * RLS activé partout, aucune policy ouverte à `anon` (critère 1).

-- `references` est un mot réservé Postgres : quoté partout ci-dessous.
-- Attention si vous écrivez du SQL à la main ailleurs dans le projet.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table "references" (
  code    text primary key,
  libelle text
);

create table emplacements (
  code    text primary key,
  zone    text not null,
  baie    int  not null,
  niveau  int  not null,
  ordre   int,
  constraint code_format check (code ~ '^[A-Z]{1,2}-\d{2}-\d$'),
  -- une inter-allée (zone à deux lettres) n'existe qu'au niveau 0 (§8,
  -- critère d'acceptation 4 : AB-03-1 rejeté, AB-03-0 accepté)
  constraint inter_allee_niveau_zero check (length(zone) = 1 or niveau = 0)
);

create table conditionnements (
  id                uuid primary key default gen_random_uuid(),
  ref_code          text not null references "references"(code),
  pieces_par_carton int  not null check (pieces_par_carton > 0),
  libelle_court     text,
  a_ecouler         boolean not null default false
);

-- Immuable sur le taux : on ne corrige jamais pieces_par_carton sur une
-- ligne existante, on en crée une nouvelle (§4). a_ecouler et
-- libelle_court restent modifiables (écoulement de l'ancien conditionnement,
-- §4.1).
create or replace function prevent_conditionnement_rate_change()
returns trigger language plpgsql as $$
begin
  if new.ref_code is distinct from old.ref_code
     or new.pieces_par_carton is distinct from old.pieces_par_carton then
    raise exception 'conditionnements is immutable on ref_code/pieces_par_carton — create a new row instead';
  end if;
  return new;
end;
$$;

create trigger conditionnements_immutable_rate
before update on conditionnements
for each row execute function prevent_conditionnement_rate_change();

create type motif_mouvement as enum (
  'reception',
  'retour_client',
  'stock_initial',
  'ajustement_inventaire',
  'annulation',
  'transfert_entree',
  'commande_client',
  'produit_defaillant',
  'destruction',
  'transfert_sortie'
);

create table comptages (
  id               uuid primary key default gen_random_uuid(),
  emplacement_code text not null references emplacements(code),
  ts               timestamptz not null,
  statut           text not null check (statut in ('en_cours', 'clos'))
);

create table mouvements (
  id                  uuid primary key, -- généré côté client, jamais de default (§3 : idempotence du rejeu)
  ts                  timestamptz not null,
  ref_code            text not null references "references"(code),
  emplacement_code    text not null references emplacements(code),
  quantite_pieces     int  not null check (quantite_pieces <> 0),
  motif               motif_mouvement not null,
  commentaire         text,
  transfert_id        uuid,
  comptage_id         uuid references comptages(id),
  annule_mouvement_id uuid references mouvements(id),
  conditionnement_id  uuid not null references conditionnements(id),
  auteur              text not null,
  -- Garde-fou dérivé du tableau Entrées/Sorties (§5) — n'est pas une règle
  -- explicite de la spec, mais s'en déduit directement pour les motifs à
  -- sens unique. `ajustement_inventaire` et `annulation` apparaissent dans
  -- les deux colonnes du tableau et restent donc libres de signe.
  constraint quantite_signe_coherent check (
    case motif
      when 'reception'         then quantite_pieces > 0
      when 'retour_client'     then quantite_pieces > 0
      when 'stock_initial'     then quantite_pieces > 0
      when 'transfert_entree'  then quantite_pieces > 0
      when 'commande_client'    then quantite_pieces < 0
      when 'produit_defaillant' then quantite_pieces < 0
      when 'destruction'        then quantite_pieces < 0
      when 'transfert_sortie'   then quantite_pieces < 0
      else true -- ajustement_inventaire, annulation : signe libre
    end
  )
);

-- Append-only, y compris pour une requête directe (critère d'acceptation
-- 23). Une erreur se corrige par un mouvement inverse (motif `annulation`),
-- jamais par une modification.
create or replace function prevent_mouvements_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'mouvements is append-only: % not allowed', tg_op;
end;
$$;

create trigger mouvements_no_update
before update on mouvements
for each row execute function prevent_mouvements_mutation();

create trigger mouvements_no_delete
before delete on mouvements
for each row execute function prevent_mouvements_mutation();

-- Le rejeu hors ligne (id UUID généré côté client) doit donc utiliser
-- `on conflict (id) do nothing` côté client — jamais `do update`, puisque
-- le trigger ci-dessus refuse toute UPDATE. Un conflit sur un id déjà
-- présent doit être traité comme un succès (déjà enregistré), pas comme
-- une erreur (critères d'acceptation 21 et 22).

-- ---------------------------------------------------------------------
-- Stock = vue, jamais une colonne (§4)
-- ---------------------------------------------------------------------

create view stock
with (security_invoker = true) -- sans ça la vue s'exécute avec les droits
                                -- du créateur et contourne le RLS de
                                -- mouvements (critère d'acceptation 1)
as
select emplacement_code, ref_code, conditionnement_id, sum(quantite_pieces) as quantite_pieces
from mouvements
group by emplacement_code, ref_code, conditionnement_id;

-- ---------------------------------------------------------------------
-- Authentification — liste blanche d'e-mails (§3)
-- ---------------------------------------------------------------------

create table autorises (
  email text primary key
);

-- À compléter avec les adresses réellement autorisées avant la mise en
-- service, par ex. :
-- insert into autorises (email) values ('prenom.nom@exemple.com');

-- Fonction security definer : contourne volontairement le RLS d'`autorises`
-- pour que les policies des autres tables puissent la consulter sans avoir
-- à leur accorder un accès direct à la table (moindre privilège).
create or replace function is_email_allowed()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from autorises where email = (auth.jwt() ->> 'email')
  );
$$;

-- ---------------------------------------------------------------------
-- RLS — activé partout, aucune policy pour `anon` (§3, critère 1)
-- ---------------------------------------------------------------------

alter table "references"    enable row level security;
alter table conditionnements enable row level security;
alter table emplacements     enable row level security;
alter table mouvements       enable row level security;
alter table comptages        enable row level security;
alter table autorises        enable row level security;
-- (autorises : aucune policy — accessible uniquement via is_email_allowed())

-- references : lecture, création, mise à jour du libellé. Pas de DELETE.
create policy references_select on "references" for select to authenticated
  using (is_email_allowed());
create policy references_insert on "references" for insert to authenticated
  with check (is_email_allowed());
create policy references_update on "references" for update to authenticated
  using (is_email_allowed()) with check (is_email_allowed());

-- conditionnements : lecture, création, mise à jour (a_ecouler/libelle_court
-- seulement — le trigger ci-dessus bloque le reste). Pas de DELETE.
create policy conditionnements_select on conditionnements for select to authenticated
  using (is_email_allowed());
create policy conditionnements_insert on conditionnements for insert to authenticated
  with check (is_email_allowed());
create policy conditionnements_update on conditionnements for update to authenticated
  using (is_email_allowed()) with check (is_email_allowed());

-- emplacements : lecture, création, mise à jour (ordre). Pas de DELETE.
create policy emplacements_select on emplacements for select to authenticated
  using (is_email_allowed());
create policy emplacements_insert on emplacements for insert to authenticated
  with check (is_email_allowed());
create policy emplacements_update on emplacements for update to authenticated
  using (is_email_allowed()) with check (is_email_allowed());

-- mouvements : lecture et création seulement. `auteur` est vérifié dans le
-- with check, pas seulement pré-rempli par défaut — un DEFAULT ne joue que
-- si le client omet la colonne, un client malveillant pourrait sinon écrire
-- l'auteur de son choix.
create policy mouvements_select on mouvements for select to authenticated
  using (is_email_allowed());
create policy mouvements_insert on mouvements for insert to authenticated
  with check (is_email_allowed() and auteur = (auth.jwt() ->> 'email'));
-- Pas de policy update/delete : refusé par défaut, et de toute façon bloqué
-- par trigger même pour une clé qui contournerait le RLS.

-- comptages : lecture, création, mise à jour du statut (pause/reprise/clôture).
create policy comptages_select on comptages for select to authenticated
  using (is_email_allowed());
create policy comptages_insert on comptages for insert to authenticated
  with check (is_email_allowed());
create policy comptages_update on comptages for update to authenticated
  using (is_email_allowed()) with check (is_email_allowed());
