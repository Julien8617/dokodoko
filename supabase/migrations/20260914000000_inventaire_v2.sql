-- Inventaire v2 (brief du 2026-09-14) — refonte du module Inventaire.
--
-- Changements de fond par rapport au schéma initial :
--   * dimension client : `clients` + `references.client_code`, requise pour
--     le périmètre "un client" d'un inventaire ;
--   * `inventaires` porte la campagne (tout / un client / des références),
--     avec le stock théorique figé à l'instant du lancement (`frozen_ts`) —
--     jamais recalculé en cours de route, jamais une copie de données :
--     `stock as of frozen_ts` se dérive de `mouvements` (append-only) via
--     `ts < frozen_ts` ;
--   * `comptages` (un par casier) rattaché à un `inventaires` ;
--   * `comptage_lignes` : journal append-only des saisies (compté), pour
--     que la reprise après coupure lise simplement la dernière ligne par
--     (comptage_id, ref_code, conditionnement_id) — jamais de valeur
--     mutée en place.
--
-- Le traitement des écarts (recompter/corriger/justifier, clôture avec
-- écriture des mouvements d'ajustement) n'est PAS dans cette migration :
-- phase 1 s'arrête à la synthèse en lecture seule (décision du 2026-09-14).
-- L'écran Mouvement existant, qui écrit encore des ajustements directs,
-- n'est pas touché.

create table clients (
  code text primary key,
  nom  text not null
);

alter table clients enable row level security;

create policy clients_select on clients for select to authenticated
  using (is_email_allowed());
create policy clients_insert on clients for insert to authenticated
  with check (is_email_allowed());
create policy clients_update on clients for update to authenticated
  using (is_email_allowed()) with check (is_email_allowed());

-- Backfill : les réfs de démo existantes sont rattachées à REUZEL (le seul
-- client du pilote) avant de rendre la colonne obligatoire.
insert into clients (code, nom) values ('REUZEL', 'REUZEL');

alter table "references" add column client_code text references clients(code);
update "references" set client_code = 'REUZEL' where client_code is null;
alter table "references" alter column client_code set not null;

create table inventaires (
  id               uuid primary key default gen_random_uuid(),
  scope_kind       text not null check (scope_kind in ('tout', 'client', 'references')),
  scope_client_code text references clients(code),
  frozen_ts        timestamptz not null default now(),
  statut           text not null default 'en_cours' check (statut in ('en_cours', 'clos')),
  auteur           text not null,
  created_at       timestamptz not null default now(),
  constraint scope_client_coherent check (
    (scope_kind = 'client' and scope_client_code is not null) or
    (scope_kind <> 'client' and scope_client_code is null)
  )
);

alter table inventaires enable row level security;

create policy inventaires_select on inventaires for select to authenticated
  using (is_email_allowed());
create policy inventaires_insert on inventaires for insert to authenticated
  with check (is_email_allowed() and auteur = (auth.jwt() ->> 'email'));
create policy inventaires_update on inventaires for update to authenticated
  using (is_email_allowed()) with check (is_email_allowed());

-- Un seul inventaire en_cours à la fois (§ "Règles non négociables" 2 :
-- jamais deux en parallèle par accident) — appliqué en base, pas seulement
-- côté écran.
create unique index one_inventaire_en_cours
  on inventaires ((true))
  where statut = 'en_cours';

-- Périmètre "des références" : liste explicite (many-to-many).
create table inventaire_references (
  inventaire_id uuid not null references inventaires(id),
  ref_code      text not null references "references"(code),
  primary key (inventaire_id, ref_code)
);

alter table inventaire_references enable row level security;

create policy inventaire_references_select on inventaire_references for select to authenticated
  using (is_email_allowed());
create policy inventaire_references_insert on inventaire_references for insert to authenticated
  with check (is_email_allowed());

alter table comptages add column inventaire_id uuid references inventaires(id);

-- Journal append-only des saisies de comptage. La valeur "actuelle" d'une
-- ligne est la plus récente par (comptage_id, ref_code, conditionnement_id)
-- — jamais une mise à jour en place, pour que la reprise et l'historique
-- (compté au premier passage vs au second, phase 2) soient le même
-- mécanisme dès le départ.
create table comptage_lignes (
  id                 uuid primary key default gen_random_uuid(),
  comptage_id        uuid not null references comptages(id),
  ref_code           text not null references "references"(code),
  conditionnement_id uuid not null references conditionnements(id),
  cartons            int not null check (cartons >= 0),
  pieces             int not null check (pieces >= 0),
  ts                 timestamptz not null default now(),
  auteur             text not null
);

alter table comptage_lignes enable row level security;

create policy comptage_lignes_select on comptage_lignes for select to authenticated
  using (is_email_allowed());
create policy comptage_lignes_insert on comptage_lignes for insert to authenticated
  with check (is_email_allowed() and auteur = (auth.jwt() ->> 'email'));
-- DELETE autorisé : "retirer une référence ajoutée par erreur de saisie"
-- (2026-09-14) est une correction d'UI, pas un événement métier à tracer —
-- contrairement à `mouvements`, cette table n'est pas un journal immuable.
create policy comptage_lignes_delete on comptage_lignes for delete to authenticated
  using (is_email_allowed());
