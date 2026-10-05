# Note de reprise — le rôle d'architecte

> **Destination : `docs/architecte.md`.** Écrite le 5 octobre 2026, au moment
> de changer de session de travail. Elle dit comment le projet se conduit, pas
> ce qu'il contient. `docs/spec.md` dit ce qui est dans le périmètre,
> `CLAUDE.md` dit comment coder, `README.md` dit où on en est.
>
> À lire d'abord si vous reprenez le rôle d'architecte sans l'historique des
> conversations. Tout ce qui compte est dans les fichiers du dépôt ; cette
> note dit lesquels, dans quel ordre, et quels pièges ont déjà coûté cher.

## Qui fait quoi

**Julien** décide. Il n'est pas développeur : il vérifie en testant sur son
iPhone, en conditions réelles, jamais en lisant le code. Il travaille sur ce
projet hors de ses heures de travail. Un script de test concret lui est donc
plus utile qu'une explication de ce qui a changé.

**L'architecte** — ce rôle — arbitre les décisions de conception, tient
`docs/spec.md` à jour en version, et rédige les messages que Julien transmet à
Claude Code. Il n'écrit pas le code applicatif.

**Claude Code** implémente dans le dépôt, et rend compte en fin d'épisode :
commits poussés, décisions prises en séance, défauts trouvés et non corrigés,
points que la spec ne tranche pas, script de test. Ces rapports sont la
matière première de l'architecte.

Le circuit : Julien relaie le rapport de Code → l'architecte arbitre et met la
spec à jour → Julien relaie le message au suivant. L'architecte et Code ne se
parlent jamais directement, et c'est sans importance : **la spec est le canal.**

## Propriété des fichiers — une adresse par règle

C'est la règle qui a coûté le plus cher à apprendre, trois fois dans la même
journée.

| Fichier | Auteur | Comment il change |
|---|---|---|
| `docs/spec.md` | l'architecte | livré entier, committé tel quel |
| `docs/jeu-de-demonstration.md` | l'architecte | idem |
| `docs/architecte.md` | l'architecte | idem |
| `README.md` | l'architecte | idem ; Code signale les erreurs de fait |
| `CLAUDE.md` | **le dépôt** | l'architecte demande des modifications point par point, **jamais** en envoyant le fichier |
| code, migrations, `src/changelog.ts` | Code | l'architecte spécifie, n'édite pas |

L'architecte ne garde **aucune copie locale** de `CLAUDE.md`. S'il doit le
lire, il le lit dans le dépôt.

## Les rituels qui tiennent le projet

**La spec se version à chaque changement**, avec la raison en une phrase dans
l'en-tête. Un écart assumé s'inscrit dans la spec **au même commit** que le
code qui l'introduit.

**Chaque règle porte une date et une raison.** La plupart viennent d'un défaut
constaté sur appareil, pas d'une anticipation. C'est ce qui permet à une
session neuve de reprendre sans l'historique — et c'est la raison pour
laquelle ce document est court : la spec fait le travail.

**Une règle n'a qu'une adresse.** Si elle est écrite à deux endroits, l'un des
deux finira par mentir. Quand une règle change, chercher partout où elle est
énoncée.

**Un script de test après chaque livraison visible**, en points cochables, qui
dit pour chaque point *pourquoi* on le vérifie. Les points qui n'ont jamais
tourné sont signalés comme tels.

**`advisor()` avant toute modification du module Inventaire.** C'est un
réglage de Claude Code, pas un hook du dépôt.

## Les pièges déjà payés

Ils reviennent tous, et ils sont tous de la même famille : une vérité écrite à
un endroit et pas à l'autre.

- **Corriger à la seconde adresse au lieu de supprimer la duplication.**
  Diagnostiquer « deux copies maîtresses » puis rafistoler la copie. Le défaut
  revient au tour suivant.
- **Justifier une règle par un proxy mesurable** au lieu de la raison réelle —
  un seuil de cinquante références là où la vraie règle était « toujours ». Le
  proxy se révèle faux sur le premier cas qui sort de l'échantillon observé.
- **Nommer un fichier quand on veut désigner un module.** Dire
  `inventaireDb.ts` en pensant « le module Inventaire » envoie la correction au
  mauvais endroit.
- **Écrire un exemple avec un emplacement factice** — Code le recopie, Julien
  le colle littéralement. Donner des commandes et des exemples autonomes.
- **Concevoir une démonstration autour d'une fonction qu'on vient de
  reporter.** Vérifier qu'une vitrine ne montre que ce que le code sait faire.
- **Laisser des traces d'un cadre disparu.** Une spec qui garde les règles d'un
  monde révolu finit par les faire appliquer.

Dans tous les cas : quand Code signale une incohérence, il a presque toujours
raison, et l'arbitrage consiste à trouver *laquelle* des deux versions était
la bonne — pas à défendre la dernière écrite.

## Ce qui est déjà tranché et ne se rediscute pas sans raison nouvelle

Tout est dans la spec avec sa raison. Les quatre qu'on tente le plus souvent
de rouvrir :

- **Le dépôt reste public**, par décision et non par contrainte (§2). Les deux
  sorties, avec leur coût, sont écrites pour le jour où un vrai client arrive.
- **Pas de séparation multi-société** avant qu'un second client existe (§2).
- **Le stock n'est jamais une colonne** (§4). Append-only, triggers
  d'immutabilité, correction par mouvement inverse.
- **L'app ne refuse jamais un fait physique** (§4). Le corollaire — fin du
  blocage sur stock négatif — est un chantier, pas une question.

## Où en est le projet, au 5 octobre 2026

Code en `0.9.5x`, déployé. Deux chantiers livrés ce jour : une écriture ne pose
qu'une question, et les suggestions suivent le périmètre. **Le script de test
correspondant n'a pas encore tourné sur l'appareil** — c'est la première chose
à réclamer.

Ensuite, dans cet ordre : le script de semis du jeu de démonstration, la base
neuve, puis la clôture d'inventaire. Le §12 de la spec porte la file complète
et, surtout, **« En attente, avec leur déclencheur »** — les chantiers qui
n'entrent qu'à une condition nommée. S'y référer avant de proposer quoi que ce
soit : la question « est-ce que ce chantier rend l'app compréhensible ou
utilisable par quelqu'un qui ne l'a pas écrite ? » tranche presque tout.
