-- Abandon d'inventaire (spec 2.46 §6.5, échéance ferme le 25 septembre).
--
-- Phase 1 (comptage sans stock d'ouverture, cf. spec §2) : tout écart est
-- positif par construction, donc une clôture qui écrirait des
-- `ajustement_inventaire` polluerait l'indicateur du pilote. Chaque
-- comptage se termine par un abandon, pas une clôture, jusqu'à
-- l'amorçage du stock d'ouverture (phase 2).
--
-- Sans cette migration, l'inventaire du 18 septembre reste `en_cours` et
-- bloque le suivant : l'index partiel `one_inventaire_en_cours` n'admet
-- qu'un seul inventaire actif à la fois.
--
-- L'abandon ferme sans écrire aucun mouvement : `statut = 'abandonne'`,
-- motif libre saisi, lignes de comptage conservées telles quelles.
-- L'index partiel ne change pas — un inventaire abandonné n'est plus
-- `en_cours` et libère la place de lui-même.

alter table inventaires add column abandon_motif text;

alter table inventaires drop constraint inventaires_statut_check;
alter table inventaires add constraint inventaires_statut_check
  check (statut in ('en_cours', 'clos', 'abandonne'));

alter table inventaires add constraint abandon_motif_requis
  check (statut <> 'abandonne' or abandon_motif is not null);
