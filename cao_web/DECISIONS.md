# 📋 Journal des décisions — CAO3 Web

Format inspiré des ADR (Architecture Decision Record) : **une décision = un contexte, une décision, ses
alternatives, ses conséquences**. Toute décision structurante de l'application `cao_web/` s'ajoute ici.
Les décisions du projet historique (Django/CadQuery) restent dans [`../ARCHITECTURE_DECISIONS.md`](../ARCHITECTURE_DECISIONS.md).

| N° | Décision | Statut | Réversible |
|---|---|---|---|
| 001 | Application neuve (Vue 3 + TS + Vite) plutôt que faire évoluer `cao_frontend` | acceptée | coûteux |
| 002 | Pièces d'abord ; assemblages en dernier | acceptée | facile |
| 003 | Aucun backend de calcul : le noyau tourne dans le navigateur | acceptée | coûteux |
| 004 | Document JSON = source de vérité, géométrie = cache jetable | acceptée | coûteux |
| 005 | Noyau dans un Web Worker, solveur dans un second worker | acceptée | moyen |
| 006 | Contournements du noyau centralisés dans `kernel/compat.ts` | acceptée | facile |
| 007 | Planegcs comme solveur d'esquisse (et non un solveur maison) | acceptée | coûteux |
| 008 | Chargement en flux du WASM + démarrage après la première image | acceptée | facile |
| 009 | **Le worker du noyau est recyclé plutôt que « réparé »** (mémoire WASM non récupérable) | acceptée | moyen |
| 010 | Budget de rendu : LOD aperçu/final + plafond de 400 k triangles | acceptée | facile |
| 011 | Documents conservés dans IndexedDB (et non dans `localStorage` ou sur un serveur) | acceptée | moyen |
| 012 | **Thème clair « liquid glass »** (verre dépoli sur fond pastel) plutôt qu'un thème sombre | acceptée | facile |
| 013 | **Le noyau WebAssembly est mis en cache dans le Cache Storage** du navigateur | acceptée | facile |

---

## ADR-001 — Application neuve plutôt qu'évolution de `cao_frontend`

**Contexte** : deux bases existaient (`cao_frontend` Vue 3.5 + `cao_backend` Django/CadQuery). L'ambition
(SolidWorks dans le navigateur, fonctions par rubans) est incompatible avec une géométrie calculée côté serveur.

**Décision** : créer `cao_web/` (Vue 3 + TypeScript + Vite), application autonome, pages connexion/projets à refaire.

**Alternatives écartées** : faire évoluer `cao_frontend` (couplage à l'API Django, dette technique) ; repartir
sur React (compétence et écosystème Konva/Pinia déjà éprouvés ici).

**Conséquences** : deux bases coexistent temporairement ; `cao_frontend` et `cao_backend` restent intacts, sans
dette croisée. Le jour où un backend est ajouté (comptes, projets, partage), il ne fera **aucun** calcul géométrique.

---

## ADR-002 — Pièces d'abord, assemblages en dernier

**Contexte** : le périmètre visé couvre l'esquisse, les fonctions 3D, la mise en plan et les assemblages.

**Décision** : ordre Lots 0→3 (socle, esquisse, fonctions 3D, robustesse), puis mise en plan (lot 4), puis
assemblages (lot 5). Un utilisateur doit obtenir une pièce utile avant tout le reste.

**Conséquences** : les rubans *Assemblage* et *Mise en plan* restent visibles mais désactivés, avec une
infobulle indiquant le lot — la mesure du périmètre est donnée sans mentir.

---

## ADR-003 — Aucun backend de calcul

**Contexte** : `cao_backend` (Django + CadQuery) existe déjà et pourrait porter la reconstruction.

**Décision** : hors périmètre. Toute la géométrie est calculée dans le navigateur (OpenCascade WASM).

**Alternatives écartées** : reconstruction serveur (latence à chaque cote modifiée, coût d'exploitation,
confidentialité des plans) ; hybride local/serveur (deux chemins de code à maintenir).

**Conséquences** : ~7 Mo à télécharger une fois, puis fonctionnement hors-ligne et confidentiel. Le serveur,
s'il revient, se limitera à la persistance, aux comptes et au partage.

---

## ADR-004 — Le document JSON est la source de vérité, la géométrie un cache

**Contexte** : les identifiants de faces/arêtes d'OpenCascade (`hashCode`) sont **instables d'une
reconstruction à l'autre** (constat vérifié du spike).

**Décision** : l'arbre de fonctions est un JSON versionné (`cao3/document@1`) ; la géométrie n'est jamais
persistée. Toute référence à une face ou une arête passe par une **signature géométrique** (type de surface,
aire, normale, adjacence), pas par un `hashCode`.

**Conséquences** : annuler/rétablir = instantané JSON (60 niveaux) ; le document est lisible, diff-able et
exportable ; une reconstruction est toujours possible depuis zéro. La nomenclature topologique persistante
reste à écrire (lot 3).

---

## ADR-005 — Noyau et solveur dans des workers distincts

**Contexte** : une reconstruction lourde ne doit jamais figer l'interface, et un glissement d'esquisse
(des dizaines de résolutions par seconde) ne doit pas attendre le noyau.

**Décision** : deux workers — `kernel/worker.ts` (OpenCascade) et `kernel/solver.worker.ts` (planegcs) — avec
un client RPC typé chacun, transfert des tampons sans copie, et **rejet des réponses obsolètes** côté client.

**Alternatives écartées** : fil principal (interface gelée) ; worker unique (le solveur attendrait les
reconstructions) ; lot de travail piloté par `SharedArrayBuffer` (exige COOP/COEP partout, complexité inutile
tant que le profiling ne le réclame pas).

**Conséquences** : la communication est asynchrone (donc annulable), et un plantage du noyau n'emporte pas
l'interface.

---

## ADR-006 — Contournements centralisés dans `kernel/compat.ts`

**Contexte** : le spike a mesuré une douzaine de pièges (lissage via `loftWith`, dépouille par profil, congés
par rappel, `cut` sans tableau, `makeBox` à deux coins…). Dispersés dans le code métier, ils deviennent
impossibles à corriger le jour où une version du noyau les répare.

**Décision** : un seul module expose `boxSafe`, `boxBetween`, `loftSafe`, `cutMany`, `fuseOrCompound`,
`intersectSafe`, `draftScaleFactors`. Aucun appel direct aux API piégeuses ailleurs.

**Conséquences** : le reste du code s'écrit comme si le noyau était propre ; les tests du noyau documentent
chaque contournement et sa raison d'être.

---

## ADR-007 — Planegcs comme solveur d'esquisse

**Contexte** : les contraintes d'esquisse (coïncidence, horizontal/vertical, tangence, symétrie…) demandent un
solveur numérique robuste avec degrés de liberté et détection de conflits.

**Décision** : `@salusoft89/planegcs` 1.3.0 (portage WASM de PlaneGCS/FreeCAD), dans un worker dédié.
Mesures : résolution exacte, ~0,03 ms par résolution, `dof()` exact, conflits identifiés par contrainte.

**Alternatives écartées** : solveur maison par projection (fragile, pas de `dof` fiable) ; Cassowary (décrit
dans les documents historiques : insuffisant pour la géométrie non linéaire — tangences, rayons).

**Conséquences** : licence LGPL-2.0+ → WASM gardé en fichier séparé et remplaçable ; le statut « entièrement
contraint » est exact et non heuristique.

---

## ADR-008 — Chargement en flux du WASM et démarrage après la première image

**Contexte** : 22,98 Mo de WebAssembly à télécharger ; un écran figé sans explication est perçu comme un
plantage.

**Décision** : le worker récupère le WASM en flux (`ReadableStream`), remonte la progression réelle (une
notification par 256 Ko), l'interface affiche « x Mo / y Mo (z %) » et la fenêtre s'affiche **avant** que le
téléchargement ne commence. Repli automatique sur l'URL directe si le flux échoue.

**Conséquences** : la progression est un confort, jamais une condition de démarrage ; le WASM est présenté à
Emscripten par une URL `blob:` révoquée aussitôt (pas de copie persistante en mémoire).

---

## ADR-009 — Recycler le worker du noyau plutôt que tenter de « réparer »

**Contexte** : mesure du 2026-10-14 (voir [`../PERFORMANCES_NAVIGATEUR.md`](../PERFORMANCES_NAVIGATEUR.md) §4) —
le tas WebAssembly d'OpenCascade **ne rétrécit jamais** : 250 pièces lourdes le font passer de 100 Mo à 413 Mo,
**que l'on appelle `delete()` ou non** (résultat identique). `replicad` 1.1.0 ne contient aucun
`FinalizationRegistry` : rien n'est libéré automatiquement. Pour une pièce courante, le tas reste à 100 Mo.
En revanche, un calcul pathologique peut consommer plusieurs centaines de mégaoctets **définitivement**
jusqu'à ce que le navigateur tue l'onglet.

**Décision** :
1. un **chien de garde** : une reconstruction de plus de 20 s est abandonnée, le worker est tué et relancé
   (toute la mémoire est rendue d'un coup), avec un message qui précise que le document est intact ;
2. une **action « Libérer la mémoire »** à un clic (bandeau d'alerte et diagnostic) ;
3. une **alerte à 900 Mo** (tas WASM ou tas JS) affichée dans la barre d'état en permanence.

`delete()` est appelé systématiquement (`freeShape`) pour ne pas accumuler de poignées, mais le code documente
explicitement que **cela ne fait pas baisser le tas** — pour qu'aucun développeur ne s'appuie dessus.

**Alternatives écartées** : redémarrer le worker à chaque exception (mesuré : une exception attrapée ne
corrompt pas la session) ; prévenir l'utilisateur sans agir (le navigateur décide à sa place, mal) ;
poursuivre le calcul en espérant que ça passe (c'est exactement ce qui fait « crasher » l'onglet).

**Conséquences** : la robustesse est visible et actionnable ; le coût d'un redémarrage est de ~0,3 s
(réinitialisation du noyau) plus la reconstruction — acceptable face à la perte de l'onglet.

---

## ADR-010 — Budget de rendu : LOD aperçu/final et plafond de triangles

**Contexte** : le maillage est un cache de rendu, mais il peut devenir énorme (pièces très détaillées,
répétitions de perçages) et saturer la mémoire du navigateur comme la carte graphique.

**Décision** : deux niveaux de tessellation (`aperçu {0,25 ; 0,6}` pendant l'interaction, `final {0,05 ; 0,3}`
au repos) et **rétrogradation automatique** de toute demande de qualité finale au-delà de **400 000 triangles**.
La barre d'état affiche en permanence le nombre de triangles et la mémoire.

**Alternatives écartées** : une seule qualité fine (interaction saccadée, mémoire gaspillée) ; qualité
réglable par l'utilisateur uniquement (personne ne le fait avant que ça casse) ; tessellation à la volée côté
GPU (hors de portée, OpenCascade produit le maillage sur CPU).

**Conséquences** : l'interaction reste fluide ; la géométrie exacte n'est jamais affectée (elle reste dans le
B-Rep) ; un utilisateur qui veut une capture haute qualité exporte en STL/STEP, ou relance une reconstruction
explicite.

---

## ADR-011 — Les documents vivent dans IndexedDB

**Contexte** : le document CAO est petit (quelques kilooctets) mais c'est **le** travail de l'utilisateur. Un
onglet rechargé ou un navigateur qui plante ne doit pas coûter la pièce. Le `localStorage` (≈ 5 Mo, synchrone,
bloquant) est inadapté ; le serveur est hors périmètre (ADR-003).

**Décision** : stockage dans IndexedDB (base `cao3`, magasin `documents`) : sauvegarde automatique différée
de 1,5 s après chaque reconstruction réussie, reprise de session au démarrage, écran « Documents locaux »
(lister, ouvrir, supprimer), plus export/import de fichiers `.cao3.json` pour le partage.
La liste ne remonte que des métadonnées (nom, fonctions, taille, volume, date).
**Dégradation propre** : sans IndexedDB (navigation privée, quota refusé), l'application fonctionne avec les
fichiers seuls et l'explique.

**Alternatives écartées** : `localStorage` (quota et blocage du fil principal) ; File System Access API
(excellente mais non disponible partout, et l'utilisateur doit choisir un dossier) ; renvoyer le document à
chaque modification vers un serveur (hors périmètre, et une panne réseau ne doit pas perdre du travail).

**Conséquences** : les pièces survivent aux plantages et à la fermeture de l'onglet ; aucun octet ne quitte
la machine ; les gros artefacts (maillages, STEP) restent explicitement hors de la base car reconstructibles.

---

## ADR-012 — Thème clair « liquid glass »

**Contexte** : la première version reprenait le thème sombre des logiciels de CAO industriels. La demande
explicite est un **frontend clair** : blanc, couleurs pâles, « liquid glass ».

**Décision** : surfaces **translucides** (verre dépoli) posées sur un fond pastel très diffus, texte ardoise,
accents pâles. Techniquement : des jetons de design dans `styles/main.css` (fond, verre, texte, accents,
couleurs de scène et d'esquisse), plus une classe globale `.glass`
(`backdrop-filter: blur(22px) saturate(180%)` + bordure claire + ombre douce + liseré lumineux).

* **Scène 3D** : fond blanc bleuté (`#f6f8fc`), grille pâle, pièce gris aluminium (`#ccd6e5`), arêtes
  `#5c6979`, sélection vert doux, pré-sélection orange doux. Éclairage rééquilibré (ambiance 0,95 +
  contre-jour) parce que sur fond clair les contrastes doivent venir des arêtes, pas des ombres.
* **Esquisse 2D** : fond blanc, grille grise à repère (une ligne sur cinq renforcée), entités bleues tant
  que l'esquisse n'est pas contrainte, ardoise une fois contrainte (convention SolidWorks conservée).
* **Aucune couleur en dur dans les composants** : tout passe par les jetons, pour qu'un futur thème sombre
  (ou un réglage utilisateur) soit un simple remplacement de `:root`.

**Alternatives écartées** : garder le thème sombre (rejeté par l'utilisateur) ; « verre » sans fond coloré
(sans nappe pastel à flouter, le verre devient du blanc terne et l'effet est invisible) ; thème clair plat
sans transparence (moins lisible en surimpression des panneaux, et contraire à la demande).

**Conséquences** : la lisibilité de la géométrie dépend désormais d'arêtes plus marquées et d'un gris franc
pour la pièce ; l'effet de verre coûte un `backdrop-filter` par panneau (négligeable : 4 panneaux fixes),
mais peut être désactivé sans conséquence (`--glass-blur: 0`) sur un appareil modeste.

---

## ADR-013 — Le noyau WebAssembly est mis en cache dans le Cache Storage

**Contexte** : symptôme signalé — « le noyau WebAssembly bouge et recharge à chaque fois ». Diagnostic :
en développement, Vite sert les fichiers de `node_modules` en `no-cache`, donc **les 22,98 Mo étaient
retéléchargés et OpenCascade réinitialisé à chaque rechargement de page** ; s'y ajoutait un rechargement
complet déclenché par la découverte tardive de dépendances à pré-optimiser (replicad, planegcs) — chaque
rechargement tue le worker, donc le noyau.

**Décision** :
1. les octets du WASM sont rangés dans le **Cache Storage** du navigateur (API utilisable sans Service
   Worker) puis donnés à Emscripten par `wasmBinary` : **zéro requête réseau** aux chargements suivants ;
2. en développement, un en-tête `Cache-Control: public, max-age=31536000, immutable` est appliqué **aux
   seuls fichiers `.wasm`** (le noyau ne change pas sans changement de version) ;
3. les dépendances utilisées sont **déclarées** dans `optimizeDeps.include` pour que Vite ne déclenche
   plus de rechargement en cours de session ;
4. l'écran de chargement n'apparaît **qu'au-delà de 350 ms** : un noyau servi depuis le cache (~300 ms) ne
   produit plus aucun clignotement ;
5. le nombre de démarrages du noyau est **affiché** (Outils → Diagnostic) avec l'origine des octets
   (cache local ou réseau) et un bouton « Forcer le retéléchargement ».

**Alternatives écartées** : Service Worker (reporté au lot 3 : à valider dans un navigateur réel) ;
laisser le navigateur gérer seul (insuffisant : `no-cache` en développement, et rien ne survit à une
fermeture d'onglet en production) ; stocker le binaire dans IndexedDB (possible, mais le Cache Storage est
exactement conçu pour des réponses HTTP et gère l'éviction pour nous).

**Conséquences** : le redémarrage du noyau (mémoire, erreur fatale) redevient quasi instantané ; le premier
chargement reste le seul coûteux ; le symptôme est désormais **mesurable** (compteur de démarrages) au lieu
d'être une impression.

---

## ADR-014 — Le client déplie l'enveloppe du protocole (les pièces s'affichent enfin)

**Contexte** : après la mise en cache du noyau, un défaut restait visible : **les pièces créées n'apparaissaient
pas dans le viewer 3D** — ni la pièce de démonstration, ni une esquisse suivie d'un bossage. Le noyau travaillait
(mesures de volume correctes côté tests), le maillage était produit, transféré et valide (voir
`tests/workerProtocol.spec.ts`), et pourtant l'écran restait vide.

**Cause** : le worker répond **toujours** par une enveloppe typée — `{ id, ok, kind, result }` — tandis que
`KernelClient.rebuild()` renvoyait cette enveloppe **sans la déplier**, en la déclarant `RebuildResult`. Le store
lisait donc `build.mesh`, c'est-à-dire `undefined` : le watcher d'`App.vue` appelait `viewer.setMesh(null)` à chaque
reconstruction. Effets de bord du même défaut : le volume et la mémoire du noyau n'arrivaient jamais à l'interface,
le LOD (rétrogradation en qualité « aperçu » au-delà de 400 000 triangles) ne se déclenchait jamais, et l'export
STEP/STL échouait sur `result.data.buffer` (`undefined`) — donc, côté utilisateur, **tout se comportait comme si la
pièce n'existait pas**, ce qui poussait à recharger la page : d'où l'impression que le noyau « rechargeait à
l'affichage ».

**Décision** :
1. `KernelClient` **déplie l'enveloppe** dans un seul endroit (`unwrap()`), comme le faisait déjà `SolverClient` ;
2. deux garde-fous vérifient la forme du résultat (`states` pour une reconstruction, `byteLength` pour un export)
   et lèvent une erreur **lisible dans l'interface** plutôt que de laisser un viewer vide en silence ;
3. un test d'intégration `tests/kernelRpc.spec.ts` fait dialoguer le **vrai client** avec le **vrai module du
   worker** à travers un faux `Worker` (transfert compris) : il échouait avant le correctif, il passe après ;
4. le même test vérifie qu'enchaîner les reconstructions ne démarre le noyau **qu'une seule fois** (`starts === 1`)
   — la garantie « le noyau ne recharge pas à chaque affichage » est désormais **testée**, pas seulement affirmée.

**Conséquences** : la pièce s'affiche dès la première reconstruction ; l'export STEP/STL fonctionne par le même
chemin ; un décalage entre le protocole du worker et son client devient un test rouge au lieu d'un écran vide.
