-- Inventaire (§6.5) : le théorique reste masqué tant que l'utilisateur n'a
-- pas explicitement demandé à le voir ("voir l'attendu"), et cette
-- consultation doit être enregistrée. Un comptage = un casier
-- (emplacement_code not null), donc un booléen sur comptages suffit.
alter table comptages
  add column attendu_consulte boolean not null default false;
