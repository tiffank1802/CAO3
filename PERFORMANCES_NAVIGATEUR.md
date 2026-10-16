# 🚀 Performances navigateur — comment CAO3 Web évite de faire « crasher » le navigateur

**Date** : 2026-10-14 · **Périmètre** : application `cao_web/` (CAO paramétrique, OpenCascade WASM + three.js)
**Statut** : techniques 1, 2 (IndexedDB), 3, 4, 5 **implémentées et mesurées** — le Service Worker reste au lot 3.

> Ce document répond point par point à la question « comment intégrer les techniques des jeux en ligne
> pour ne pas saturer le navigateur ? ». Chaque affirmation est **mesurée** (scripts de mesure reproductibles
> décrits en §6), pas supposée. Les chiffres correspondent à la machine de développement (Node 22 / sandboxe) ;
> ils donnent l'ordre de grandeur, pas une garantie absolue.

---

## 0. En une phrase

Un jeu en ligne et une CAO web ont le **même ennemi** : une ressource unique et grosse qu'on charge ou
qu'on alloue entièrement. Pour un jeu c'est le monde/les textures ; ici c'est **le noyau OpenCascade
(22,98 Mo de WebAssembly) et son tas mémoire de 100 Mo**, plus **le maillage** de la pièce. La parade est la
même : découper, charger à la demande, plafonner ce qu'on affiche, **recycler** ce qu'on ne peut pas libérer,
et **stocker localement** plutôt qu'en mémoire vive.

---

## 1. Streaming d'actifs et chargement à la demande

### Ce qui est fait

| Mesure | Où | Détail |
|---|---|---|
| **Téléchargement en flux avec progression réelle** | `kernel/wasmCache.ts` | Le worker récupère le WASM avec `fetch` + `ReadableStream`, recompte les octets (une notification tous les 256 Ko) et alimente une barre de progression « 4,7 Mo / 22,9 Mo (21 %) ». |
| **Cache Storage : le WASM n'est téléchargé qu'une fois** | `kernel/wasmCache.ts` | Les octets sont rangés dans le cache du navigateur (cache `cao3-noyau-v1`) puis fournis à Emscripten par `wasmBinary`. Aux chargements suivants : **aucune requête réseau**, noyau prêt en ~300 ms. Indispensable parce que Vite sert `node_modules` en `no-cache` en développement. |
| **Repli systématique** | idem | Si le cache est indisponible (navigation privée, contexte non sécurisé, quota) ou si la relecture échoue, on retombe sur le téléchargement : *le noyau doit toujours démarrer ; le cache est une optimisation, pas une condition*. |
| **Le noyau démarre après la première image** | `App.vue` → `onMounted` | Le shell (rubans, arbre, panneaux) s'affiche **avant** que les 22,9 Mo ne commencent à descendre : la fenêtre ne reste jamais blanche. |
| **Aucun clignotement quand le noyau vient du cache** | `App.vue` (`slowLoad`, 350 ms) | L'écran de chargement n'apparaît qu'au-delà de 350 ms d'attente : un démarrage depuis le cache (~300 ms) est totalement invisible. |
| **Fin des rechargements de page intempestifs en développement** | `vite.config.ts` | Les dépendances sont déclarées (`optimizeDeps.include`) au lieu d'être découvertes en cours de session — chaque découverte déclenchait un rechargement complet, donc un redémarrage du noyau. Les `.wasm` reçoivent par ailleurs un cache long. |
| **Solveur chargé à la demande** | `kernel/solverClient.ts` | Le worker du solveur (et ses 484 Ko de WASM) n'est créé qu'à la **première esquisse**. Un utilisateur qui ne fait que regarder une pièce ne les télécharge jamais. |
| **Assets hachés → cache HTTP « immuable »** | `vite build` | Le WASM et les bundles sortent avec une empreinte dans le nom (`replicad_single-B_1cTsn_.wasm`) : le navigateur les garde indéfiniment, aucune revalidation réseau aux visites suivantes. |
| **Aucun calcul serveur** | tout le projet | Il n'y a pas d'API à interroger : après le premier chargement, l'application fonctionne hors-ligne à l'exception des assets. |

### Ce qui viendra (lot 3)

* **Service Worker** : pré-cache des assets hachés pour un vrai démarrage hors-ligne et une intégrité
  vérifiable (`integrity` sur le WASM). Volontairement reporté : cette brique doit être validée **dans un
  navigateur réel** (elle ne peut pas l'être ici, aucun navigateur *headless* n'est disponible dans
  l'environnement d'exécution).
* **Import STEP en flux** : `importSTEP` accepte un `Blob` et s'exécute déjà dans le worker (aucun gel de
  l'interface) ; pour les fichiers de plusieurs centaines de Mo, l'objectif est de lire par tranches et
  d'afficher la progression comme pour le noyau.

---

## 2. Stockage avancé : IndexedDB (et pas le cache HTTP)

Le **document CAO est petit** (JSON de quelques kilooctets) et c'est **la source de vérité** : il n'a rien à
faire dans la mémoire vive longue durée, et le `localStorage` (≈ 5 Mo, synchrone, bloquant) n'est pas à la
hauteur. Il va donc dans **IndexedDB**, dont le quota se compte en centaines de mégaoctets à plusieurs
gigaoctets.

| Fonction | Où | Comportement |
|---|---|---|
| Base locale | `cad/io/storage.ts` | Base `cao3`, magasin `documents`, clé = identifiant du document. |
| **Sauvegarde automatique** | `documentStore.scheduleAutosave()` | Différée de 1,5 s après chaque reconstruction réussie : ni à chaque frappe, ni seulement à la fermeture. |
| **Reprise de session** | `documentStore.initStorage()` | Au démarrage, si un document local existe et que la pièce courante est vide, elle est reprise automatiquement. Un onglet qui plante ou se recharge ne coûte plus le travail. |
| « Documents locaux » | ruban *Fichier* | Liste des pièces stockées (nom, nombre de fonctions, taille, volume, date) avec ouverture et suppression — sans dialogue de fichier. |
| Métadonnées seulement pour la liste | `listDocuments()` | La liste ne remonte pas les JSON : afficher N documents ne coûte pas N lectures complètes. |
| **Dégradation propre** | partout | Sans IndexedDB (navigation privée, quota refusé), toutes les fonctions répondent « indisponible » : l'application continue avec les fichiers `.cao3.json`. Aucune exception, jamais. |

> Pourquoi pas IndexedDB pour **tout** ? Les maillages et les STEP exportés sont volumineux et
> **reconstructibles** : on ne les stocke pas, on les recalcule (le maillage) ou on les écrit sur le disque
> de l'utilisateur (`Blob` → téléchargement). C'est le principe « la géométrie est un cache ».

---

## 3. Compression et formats adaptés au web

| Élément | Poids brut | Poids compressé | Traitement |
|---|---|---|---|
| `replicad_single.wasm` (OpenCascade) | 22,98 Mo | **7,27 Mo** gzip | Fichier séparé, haché, mis en cache ; servi par le CDN/hébergeur avec `Content-Encoding` (Brotli/Gzip). *Le WASM reste un fichier distinct et remplaçable — aussi une exigence de licence LGPL.* |
| `planegcs.wasm` (solveur) | 484 Ko | 174 Ko | Chargé **seulement** à la première esquisse (§1). |
| Bundle applicatif JS | 877 Ko | **244 Ko** gzip | `three`, `konva`, `vue`, `pinia` ; les morceaux lourds sont isolés (worker noyau = 325 Ko brut). |
| Document `.cao3.json` | quelques Ko | — | JSON lisible, diff-able, versionné (`cao3/document@1`) ; conservé dans IndexedDB ou exporté. |

À quoi correspondent, en CAO, les « textures KTX / audio WebM » des jeux : **aux maillages et aux exports**.
La réponse retenue est plus radicale que la compression — **on ne les transporte pas** :
le maillage est recalculé à la volée par le noyau (il n'est jamais stocké, jamais envoyé), et les exports
STEP/STL sont écrits directement dans un `Blob` puis sur le disque, sans passer par du JSON/base64.

---

## 4. Mémoire : le point dur, et ce que la mesure a révélé ⚠️

**Mesures** (script §6, machine de développement) :

| Expérience | Résultat |
|---|---|
| Tas WASM d'OpenCascade à l'initialisation | **100 Mo** (réservation fixe d'Emscripten) |
| 30 reconstructions d'une pièce 80 × 50 × 20 percée | 100,0 Mo → **100,0 Mo** (Δ 0,0 Mo) en 711 ms |
| 13 fonctions (1 bossage + 12 perçages) reconstruites | 2 076 triangles, 258 ms, tas **100 Mo** |
| 250 pièces lourdes (cylindre + 6 perçages + congé ≈ 8 booléens), dernière référence conservée | 100 Mo → **413 Mo** (≈ 1,25 Mo par pièce) |
| **Les mêmes 250 pièces en appelant `delete()` sur chaque forme intermédiaire** | 100 Mo → **413 Mo** — *identique* |
| `FinalizationRegistry` dans `replicad` 1.1.0 | **0 occurrence** → aucune libération automatique côté WASM |

**Conclusion, contre-intuitive et décisive** : le ramasse-miettes de JavaScript ne libère **que** les
objets JS. Le tas WebAssembly, lui, **ne rétrécit jamais**, et `delete()` ne le fait pas rétrécir non plus.
Pour une pièce courante (10–30 fonctions) le tas reste à 100 Mo — c'est le cas normal et il n'y a rien à
faire. Mais un calcul exceptionnellement lourd (des centaines d'arêtes) peut faire grimper le tas de
plusieurs centaines de mégaoctets, **définitivement**, jusqu'à ce que le navigateur tue l'onglet.

### Les trois parades implémentées

| Parade | Où | Détail |
|---|---|---|
| **① Chien de garde sur la reconstruction** | `kernel/client.ts` (`watchdogMs = 20 s`) | Une reconstruction qui dépasse 20 s est abandonnée **et le worker fautif est tué** : toute la mémoire d'OpenCascade est rendue d'un coup, un noyau neuf prend sa place. Message clair à l'utilisateur : *« Calcul interrompu après 20 s : mémoire du noyau libérée et redémarrage en cours. Le document est intact — relancez la reconstruction. »* Rien n'est perdu : le document est en JSON. |
| **② Recyclage à la demande** | `documentStore.releaseMemory()` | Bouton « Libérer la mémoire » (bandeau d'alerte + *Outils → Diagnostic du noyau*) : tue le worker, le relance, reconstruit. C'est la **seule** façon de récupérer le tas — donc on la met à un clic. |
| **③ Alerte avant la casse** | `documentStore.memoryPressure` | La barre d'état affiche en permanence `noyau 100 Mo · interface 42 Mo`. Au-delà de 900 Mo (tas WASM **ou** tas JS), un bandeau orange apparaît avec le bouton de libération — on prévient **avant** que le navigateur ne se bloque, au lieu de le subir. |

Accessoirement, `delete()` est appelé systématiquement (`rebuild.ts` → `freeShape`) : il ne fait pas baisser
le tas, mais il évite d'accumuler des poignées côté JavaScript — et le code le documente explicitement pour
que personne ne réintroduise plus tard une libération « qui ne marche pas ».

**Ce qui suit, en plus** : le maillage n'est jamais conservé (mémoire GPU/JS recalculée), le solveur vit dans
un worker distinct (un calcul de contraintes ne touche pas le tas du noyau), et le **glissement d'esquisse
reconstruit en qualité d'aperçu** (voir §5) — soit beaucoup moins d'allocations pendant l'interaction.

---

## 5. GPU (WebGL) et budget de rendu

Le noyau tourne sur le **CPU** (c'est OpenCascade, une bibliothèque de B-Rep exact, pas un moteur de jeu) ;
le GPU ne s'occupe que de **l'affichage**, et c'est ce qui permet de garder l'interface fluide : le thread
principal ne fait jamais de calcul géométrique (principe P2 du plan).

| Technique | Où | Détail |
|---|---|---|
| **Un seul appel de dessin par corps** | `view/viewer.ts` | Un `THREE.BufferGeometry` indexé pour le corps, un seul `LineSegments` pour **toutes** les arêtes, et des géométries de surbrillance reconstruites à partir des mêmes tampons. Pas un objet par face : c'est l'équivalent WebGL du « batching ». |
| **Plafond de pixels** | `viewer.ts` | `setPixelRatio(Math.min(devicePixelRatio, 2))` : sur un écran 4K/Retina, on ne paie pas 3× le remplissage pour un gain invisible. |
| **LOD — deux niveaux de tessellation** | `kernel/tessellate.ts` | `aperçu {0,25 ; 0,6}` pendant l'interaction, `final {0,05 ; 0,3}` au repos. Mesures : pièce percée 100 → 184 triangles, 14 ms → 21 ms ; plaque 200 × 120 avec 60 trous 5 292 → 10 332 triangles, 73 ms → 123 ms. |
| **Budget de triangles adaptatif** | `documentStore.runRebuild()` | Au-delà de **400 000 triangles**, une demande de qualité « finale » est automatiquement rétrogradée en « aperçu » : le navigateur garde un maillage gérable, la géométrie exacte reste intacte (le maillage est un cache). La barre d'état affiche le compte de triangles et passe en orange au-delà d'un million. |
| **Culling matériel gratuit** | three.js | Rejet des faces arrière + culling par frustum : ce qui n'est pas à l'écran n'est pas dessiné. |
| **Libération des ressources GPU** | `viewer.disposeBody()` | Chaque reconstruction libère les géométries précédentes (`geometry.dispose()`) — sinon la mémoire GPU fuit à chaque reconstruction. |

**WebGPU ?** Pas nécessaire aujourd'hui : la charge de rendu est faible (un corps, quelques milliers de
triangles) et le goulot d'étranglement est le noyau CPU. À reconsidérer pour l'affichage de gros
assemblages (lot 5), avec un rendu par lots et des maillages partagés.

---

## 5 bis. « Le noyau recharge à chaque fois » — diagnostic et réponse

Symptôme signalé par l'utilisateur. Cause identifiée : **chaque rechargement de page réinitialisait
OpenCascade**, pour deux raisons cumulées — Vite sert les fichiers de `node_modules` avec `no-cache`
(22,98 Mo retéléchargés) et la découverte tardive de dépendances à pré-optimiser provoquait un
rechargement complet supplémentaire.

Réponse (ADR-013) : Cache Storage + `wasmBinary` (aucun réseau au second chargement), dépendances
pré-déclarées (plus de rechargement en session), écran de chargement différé de 350 ms, et surtout un
**compteur de démarrages visible** dans *Outils → Diagnostic du noyau* :

```
Démarrages du noyau : 3 démarrage(s) · dernier à 20:31:07 depuis le cache local (21.9 Mo, initialisé en 286 ms)
```

Un seul démarrage par session est la normale. Un compteur qui augmente à chaque action signale un
rechargement de page ; après un redémarrage provoqué (mémoire ou erreur fatale), le noyau repart du cache
local, sans réseau. Le bouton **« Forcer le retéléchargement »** récupère les octets depuis le serveur
(utile après une mise à jour de l'application).

## 5 ter. « Les pièces n'apparaissent pas dans le viewer » — la cause était le protocole

Second symptôme signalé le même jour, et il avait la même racine apparente : **la pièce créée ne s'affichait
jamais**, ce qui poussait à recharger la page — d'où l'impression que « le noyau recharge au moment de
l'affichage » (diagnostic mesuré : le compteur de démarrages n'augmente pas tout seul pendant une session).

La production de géométrie était hors de cause : les tests du noyau mesuraient des volumes justes, et le
maillage transféré par le worker était valide (tampons non vides, `structuredClone` avec la liste de
transfert du worker → `tests/workerProtocol.spec.ts`).

Le défaut était dans le **dépliage de l'enveloppe du protocole** : `KernelClient.rebuild()` renvoyait
`{ id, ok, kind, result }` au lieu de `result`. Conséquences en cascade, toutes invisibles dans les tests
précédents (qui appelaient le noyau en direct ou remplaçaient le client par une doublure) :

| Ce que l'interface croyait | Ce qui se passait réellement |
|---|---|
| `build.mesh === undefined` | `viewer.setMesh(null)` à chaque reconstruction → viewer vide |
| `build.volume === undefined` | volume jamais affiché dans l'arbre et le statut |
| `heapBytes === undefined` | bannière de mémoire jamais déclenchée, LOD jamais rétrogradé |
| `result.data === undefined` | export STEP/STL en échec sur `data.buffer` |

Correctif (ADR-014) : un seul point de dépliage dans le client, deux garde-fous de forme, et un **test
d'intégration qui exerce le vrai client avec le vrai module du worker** (`tests/kernelRpc.spec.ts`) — il
échoue sans le correctif, il passe avec. Le même test verrouille la garantie de performance :

```
initialise le noyau, reconstruit une pièce et livre un maillage exploitable   ✓  triangleCount > 0, starts === 1
exporte STEP et STL par le même chemin RPC                                    ✓  ISO-10303, 684 octets de STL
enchaîne les reconstructions sans redémarrer le noyau                         ✓  6 reconstructions, starts === 1
```

Leçon générale, ajoutée aux règles : **toute frontière (worker, stockage, API) doit être testée par un test
qui traverse la frontière réelle**, pas par une doublure qui imite une convention supposée.

---

## 6. Reproduire les mesures

```bash
cd cao_web && npm test            # 48 tests : noyau (19), stockage (3), interface (14),
                                  # cache du noyau (5), protocole de maillage (4), chaîne client ↔ worker (3)

# Chiffres affichés pendant les tests :
#   Tas WASM : départ 100.0 Mo → après 30 reconstructions 100.0 Mo (Δ 0.0 Mo) en 7xx ms
#   Aperçu : 100 triangles en 14 ms · Final : 184 triangles en 21 ms
#   13 fonctions (1 bossage + 12 perçages) : 2076 triangles, 258 ms, tas WASM 100 Mo
```

Les expériences « hors application » (tas WASM avec/sans `delete()`, 250 pièces lourdes, tessellation d'une
plaque à 60 trous) sont des scripts Node ponctuels ; elles suivent la même API que le worker et leurs
conclusions sont citées ci-dessus. Le principe reste : **mesurer avant d'affirmer** (cf.
`SPIKE_REPLICAD_FINDINGS.md`).

---

## 7. Récapitulatif : technique par technique

| Technique des jeux | Équivalent CAO3 Web | État |
|---|---|---|
| Streaming / decoupage / zones | Téléchargement en flux du WASM avec progression, démarrage après la première image, solveur chargé à la demande, assets hachés mis en cache | ✅ |
| Gestion des zones non visibles | LOD de tessellation (aperçu/final), budget de 400 k triangles, culling matériel | ✅ |
| IndexedDB | Documents locaux (`cao3`), sauvegarde automatique, reprise de session, liste/ouverture/suppression — avec dégradation propre | ✅ |
| Cache Storage (API de stockage) | Noyau WebAssembly (22,98 Mo) mis en cache une fois pour toutes, instancié depuis les octets locaux ; compteur de démarrages et retéléchargement forcé dans le diagnostic | ✅ |
| Service Workers | Pré-cache hors-ligne et intégrité du WASM | 🕒 lot 3 (à valider dans un navigateur) |
| Textures compressées / audio léger | Maillages **non transportés** (recalculés), export STEP/STL en `Blob` direct, WASM 22,98 → 7,27 Mo gzip | ✅ |
| Garbage collection | **Constat mesuré : le tas WASM ne se libère jamais.** Parades : chien de garde 20 s, recyclage du worker à un clic, alerte mémoire à 900 Mo, `delete()` systématique + purge des géométries GPU | ✅ |
| GPU / WebGL | Un appel de dessin par corps, plafond de pixels, libération des géométries, aucun calcul géométrique sur le thread principal | ✅ |
| WebGPU | Non requis pour l'instant (noyau CPU = goulot) ; à réévaluer pour les assemblages | 🕒 lot 5 |

---

## 8. Règles à respecter par tout nouveau code

1. **Aucun calcul géométrique sur le thread principal** — noyau et solveur dans des workers.
2. **Aucun maillage persisté** (ni en mémoire longue durée, ni dans IndexedDB, ni dans le document) :
   il est recalculé.
3. **Toute fonction 3D passe par `compat.ts`** et retourne un état ; une fonction qui échoue ne doit jamais
   faire échouer la reconstruction ni laisser une forme non libérée.
4. **Toute nouvelle boucle de géométrie est mesurée** : si un cas dépasse quelques secondes, il doit être
   regroupé (un seul booléen sur un `Compound`) et signalé dans l'interface.
5. **Toute allocation lourde entre dans un budget affiché** (triangles, mémoire) plutôt que d'être silencieuse.
6. **Aucun appel réseau pour des données utilisateur** : le document vit dans IndexedDB, les exports sur le disque.
7. **Toute frontière est testée en la traversant réellement** : le client noyau dialoguait avec un worker
   simulé qui imitait une convention *supposée*, et l'application affichait un viewer vide sans qu'aucun test
   ne devienne rouge (ADR-014). Les tests `kernelRpc.spec.ts` (faux `Worker` + vrai module du worker) et
   `workerProtocol.spec.ts` (transfert réel des tampons) sont la référence pour ce genre de frontière.
