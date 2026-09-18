-- Catalogue (spec 2.46 §6.8, §4) : une référence sans mouvement ni ligne de
-- comptage ne porte aucune histoire et doit pouvoir être supprimée et
-- recréée sous le bon code — plus simple et plus sûr qu'un renommage en
-- cascade, impossible puisque le code est la clé de tout l'historique.
--
-- Aucune de ces trois tables n'avait de policy DELETE jusqu'ici :
-- `references`/`conditionnements` n'en avaient jamais eu besoin (rien ne
-- les supprimait), `inventaire_references` n'est qu'une liste de périmètre
-- (pas un fait d'audit) et peut être nettoyée librement. Le contrôle
-- « aucun mouvement ni aucune ligne de comptage » reste appliqué côté
-- application (db.ts, `deleteReference`), pas en base : c'est une règle
-- administrative, pas une immuabilité d'audit comme celle qui protège déjà
-- `mouvements` et le taux de `conditionnements` par trigger.

create policy inventaire_references_delete on inventaire_references for delete to authenticated
  using (is_email_allowed());

create policy conditionnements_delete on conditionnements for delete to authenticated
  using (is_email_allowed());

create policy references_delete on "references" for delete to authenticated
  using (is_email_allowed());
