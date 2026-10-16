# 🔬 Spike Replicad — Rapport de vérification technique

**Date** : 2026-10-14 (mise à jour : rectificatif en §8)  
**Objet** : valider par l'expérience — et non par la documentation — les capacités réelles de `replicad` + `replicad-opencascadejs` + `@salusoft89/planegcs` avant d'engager le développement de la CAO web « type SolidWorks ».  
**Méthode** : chaque essai est exécuté dans un **processus Node isolé** (`fork`) afin qu'un échec ne perturbe pas les essais suivants. Les constats ci-dessous ont été **rejoués** en fin de spike (voir §8) : trois d'entre eux étaient erronés et sont corrigés.

---

## 1. Versions et empreinte

| Paquet | Version | Rôle | Taille |
|---|---|---|---|
| `replicad` | **1.1.0** | API B-Rep de haut niveau (esquisse, fonctions, maillage, export) | 572 Ko (ESM) → **125 Ko gzip** |
| `replicad-opencascadejs` | **1.1.0** | Build WASM d'OpenCascade (LGPL-2.1-only) | `single` 22,98 Mo → **7,27 Mo gzip** |
| `@salusoft89/planegcs` | **1.3.0** | Solveur de contraintes 2D (portage WASM de PlaneGCS/FreeCAD, LGPL-2.0+) | 484 Ko → **174 Ko gzip** |
| `three` | 0.186.1 | Rendu WebGL | — |
| Node / npm du spike | 22.22.3 / 10.9.8 | — | — |

> **Conséquence produit n°1** : ~7 Mo de WASM à télécharger. Le noyau doit être chargé *paresseusement, progressivement et mis en cache* (voir le plan, § Performances). Dans l'application livrée, les WASM sont émis par le bundler comme *assets* (URLs importées via `?url`), donc servis avec le bon type MIME et hachés pour un cache long.

---

## 2. Chaîne complète pièce mécanique (vérifiée)

```ts
import * as R from "replicad";
import opencascade from "replicad-opencascadejs";

const oc = await opencascade();       // 241 ms dans Node
R.setOC(oc);

let p = R.drawRectangle(80, 50).sketchOnPlane("XY").extrude(20);   // 17 ms
p = p.fillet(6, (e) => e.inPlane("XY"));                           // 82 ms
p = p.shell(-3, (f) => f.inPlane("XY", 20));                       // 38 ms
p = p.cut(R.makeCylinder(6, 60).translate(20, 10, -20));           // 119 ms

// Répétition + perçages : fabriquer le « peigne » d'outils puis UN SEUL booléen
let tools: R.Shape3D | null = null;
for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
  const c = R.makeCylinder(3, 40).translate(-22 + i * 22, -12 + j * 24, -10);
  tools = tools ? tools.fuse(c) : c;
}
const final = p.cut(R.makeCompound([tools!]));                     // 77 ms
// → volume 27 120,5 mm³ · 33 faces · 78 arêtes
```

### Capacités confirmées ✅

| Domaine | API vérifiée |
|---|---|
| Esquisse 2D → solide | `drawRectangle/drawCircle/drawEllipse/drawPolysides/draw…` → `.sketchOnPlane("XY"｜"XZ"｜"YZ"｜plan, offset)` / `.sketchOnFace(face)` |
| Extrusion (dépouille par profil, torsion) | `.extrude(h, { extrusionProfile: { profile, endFactor }, twistAngle, extrusionDirection, origin })` |
| Révolution | `.revolve(axis, { origin, angle })` |
| Lissage | **`sketch.loftWith([s2, s3], { ruled, startPoint, endPoint })`** (≈ 47 ms pour 3 sections) |
| Balayage | `sketch.sweepSketch((plane, origin) => new R.Sketch(wire), { withContact, frenet })` (hélice : 16 ms) |
| Congés / chanfreins | `.fillet(r \| (edge) => r, e => e.inPlane(...) ｜ e.ofLength(x) ｜ e.parallelTo(...))`, `.chamfer(r, …)` |
| Coque | `.shell(-t, f => f.inPlane("XY", z) ｜ f.containsPoint([x,y,z]))` |
| Coupe / scission | `.cutPlane(plane, offset, "above"｜"below")` → 40 000 mm³ sur la moitié d'un 80×50×20 ✔ |
| Booléens | `.fuse()`, `.cut()`, **`.intersect()` ✅ (fonctionne)**, ensembles d'outils via **`R.makeCompound([...])`** ; fusion de corps disjoints → **Compound** valide |
| Primitives | `makeBaseBox`, **`makeBox(corner1, corner2)`**, `makeCylinder`, `makeSphere`, `makeEllipsoid`, `makeHelix`, `makePolygon`, `assembleWire`, `makeFace` |
| Transformations | `.translate/.rotate/.mirror("YZ")/.scale(k)` |
| Textes gravés | `R.loadFont(arrayBuffer, "default")` puis `R.sketchText("CAO3", { fontSize })` → `.extrude(1)` |
| Mesures | `measureVolume`, `measureShapeVolumeProperties` (volume, centre de masse), `measureShapeLinearProperties`, `measureShapeSurfaceProperties`, `measureDistanceBetween`, `measureArea`, `measureLength` |
| Mise en plan | `R.drawProjection(shape, R.lookFromPlane("XZ"))` → `{ visible, hidden }` (Drawings) → `.toSVG()`, `.toSVGPaths()` |
| Tessellation | `shape.mesh({ tolerance, angularTolerance })` → `{ vertices, triangles, normals, faceGroups }` ; `shape.meshEdges()` → `{ lines, edgeGroups }` |
| Export | `.blobSTEP()` (Blob STEP), `.blobSTL({ binary: true })`, `.blobSTL()` (ASCII) |
| Import | `await R.importSTEP(blob)` (asynchrone, prend un **Blob**), `R.importSTL`, `R.importSTLAsMesh` |
| Sélection par propriétés | `FaceFinder` : `ofSurfaceType, inPlane, parallelTo, shouldKeep` · `EdgeFinder` : `inDirection, ofLength, ofCurveType, parallelTo, inPlane` |
| Robustesse | **une exception attrapée ne corrompt pas la session** : les opérations suivantes restent exactes (vérifié, §8) |
| Solveur de contraintes | exact, détection de conflits, 0,03 ms/résolution (§4) |

### À construire (le noyau ne le fournit pas) ❌

* Noyau **paramétrique à historique** : arbre de fonctions, reconstruction, nomenclature topologique, configurations → **à notre charge** (c'est le cœur du plan).
* Solveur d'assemblage (contraintes 3D), mise en plan (cotation, cartouche), tôlerie, surfaces avancées, assistant de perçage → à écrire.
* Exports OBJ / 3MF / DXF / PDF / glTF → à écrire côté client.
* Décalage d'entités 2D (`makeOffset` = offset de **Face 3D**), rognage/prolongation d'esquisse, arcs/ellipses dans le pipeline de notre esquisse → module d'esquisse à compléter.

---

## 3. Pièges vérifiés (12)

| # | Constat | Contournement retenu |
|---|---|---|
| 1 | **`R.makeBox(...)` attend deux coins 3D** : `makeBox([0,0,0],[20,20,20])` ✔. Avec trois nombres, l'erreur levée est une `Exception` WASM **sans message** (piège d'API coûteux). | `boxSafe(w, d, h, centre)` dans `compat.ts` : construit la boîte par ses deux coins, l'API « trois dimensions » n'existe pas. |
| 2 | **`R.loft([s1, s2])` échoue** dans 1.1.0 : `BRepOffsetAPI_ThruSections.AddWire … invalid signature (undefined)` (testé cercle→cercle et rect→rect). | **Toujours `sketch.loftWith([...])`** ✔ (vérifié, y compris `startPoint`/`endPoint`) — encapsulé dans `loftSafe()`. |
| 3 | **`shape.draft(angle, faceFinder)` échoue** dans 1.1.0 (exception WASM). | Dépouille par `extrusionProfile` (linéaire) ou par **lissage** entre profil de base et profil élargi ; `draftScaleFactors()` calcule le facteur par direction (1 + 2·h·tan θ/taille). |
| 4 | **`fillet([r1, r2, …], finder)` échoue** (`filterToDelete?.delete is not a function`). | **Rayon variable par callback** : `fillet(e => r(e), finder)` ✔ (vérifié) ; congé progressif le long d'une arête = accès OC brut (v2). |
| 5 | **`cut(tool)` n'accepte pas de tableau** (`Cannot use 'in' operator … 'wrapped'`). | `cutMany()` : `shape.cut(R.makeCompound(tools))` ✔ (99 ms pour 5 perçages, au lieu de 5 appels). |
| 6 | **Booléens massifs lents** : 200 perçages = **9 543 ms** en coupes séquentielles, **5 989 ms** même en fusionnant les outils dans un compound unique de 200 cylindres. | Regrouper, mettre en cache (checkpoints), prévisualiser en maillage, avertir au-delà d'un seuil d'instances. Le pattern de 200 trous reste un cas à éviter en interactif. |
| 7 | **`hashCode` de faces/arêtes instable** : deux reconstructions identiques donnent des identifiants différents. | **Nomenclature topologique maison obligatoire** (lignage par fonction + signature géométrique : type de surface, aire, centre, normale, longueur, adjacence). |
| 8 | **Pas d'`isValid()`** exposé. Cas observé : une coque après perçage renvoie un **volume négatif (−32 207 mm³)** sans lever d'erreur. | `validate.ts` : contrôle systématique `volume > 0`, boîte englobante, nombre de faces, et remontée d'avertissement au lieu d'un résultat silencieusement faux. |
| 9 | `meshEdges()` renvoie `{ lines, edgeGroups }` (et non un `Float32Array`) ; `mesh()` n'a **pas** d'`edgeGroups`. `start`/`count` des groupes sont exprimés en **flottants**, pas en segments. | `tessellate.ts` déduit l'unité en comparant la somme des groupes à la longueur du tableau. |
| 10 | `FaceFinder` n'expose pas `containsPoint` dans cette version (contrairement à des exemples publics). | Sélection interactive par **raycast three.js** → `faceGroup.faceId` → face OC ; les finders ne servent qu'aux références d'historique. |
| 11 | `importSTEP` est **asynchrone** et prend un **Blob** (un ArrayBuffer échoue). | `const shape = await R.importSTEP(file)`. |
| 12 | `sketchText` exige une police chargée avant (`Cannot read properties of undefined (reading 'getPath')`). | Embarquer un `.ttf` local (aucun CDN) et `loadFont(buffer, "default")` — vérifié fonctionnel. |

---

## 4. Solveur d'esquisse (planegcs) — validé

**Rectangle 4 lignes + 8 contraintes** (2 horizontales, 2 verticales, origine fixée, cotes 40 × 25) :

```
solve = 0 (OK) en 6,7 ms | points = (0,0) (40,00) (40,25) (0,25)      ✅ exact
conflits : false | redondances : false
ajout d'une cote contradictoire (99 mm) → status = 2, conflicting = true, ids = ["c6","c8"]   ✅ exploitable en UI
tangence cercle/cercle (rayons 10 et 20, centres distants de 30) → r₂ = 20,000             ✅
300 résolutions ≈ 9 ms  →  0,03 ms / résolution                                            ✅ temps réel
```

* ~100 types de contraintes : `p2p_coincident`, `horizontal_l`, `vertical_l`, `parallel`, `perpendicular_ll`, `tangent_lc/cc/aa/…`, `equal_length`, `equal_radius_cc`, `p2p_symmetric_ppl/ppp`, `midpoint_on_line_*`, `p2p_distance`, `p2l_distance`, `circle_radius`, `circle_diameter`, `l2l_angle_ll`, `point_on_*`, `snells_law`…
* Chaque contrainte porte un drapeau **`driving`** → cotes **pilotes** ou **de référence** (comme SolidWorks).
* **`gcs.dof()`** donne le **degré de liberté exact** → statut « entièrement contraint » fiable, pas une heuristique.
* Chaque primitive porte un `id` stable → sérialisation directe de l'esquisse.

```ts
const gcs = await GCS.make_gcs_wrapper(wasmUrl);
gcs.push_primitives_and_params([...points, ...lines, ...constraints]);
gcs.solve(GCS.Algorithm.DogLeg);                       // 0 = OK
gcs.apply_solution();                                  // réécrit les primitives résolues
gcs.gcs.dof();                                         // degrés de liberté restants
gcs.get_gcs_conflicting_constraints();                 // à surligner en rouge dans l'UI
```

**Intégré dans l'application** : `src/cad/kernel/solve.ts` + worker dédié ; le premier test d'intégration vérifie qu'un **rectangle par centre de 80×50 atteint dof = 0** (4 lignes, 2 H, 2 V, 2 cotes, 1 symétrie par rapport à l'origine) et que **deux cotes contradictoires sont signalées par leur identifiant**.

---

## 5. Benchmarks (Node, sandbox — ordres de grandeur navigateur)

| Opération | Durée |
|---|---|
| Init WASM OC | **241 ms** |
| Extrusion 80×50×20 | 11 – 18 ms |
| Congé 6 mm (4 arêtes) | 79 – 88 ms |
| Chanfrein 2 mm | 21 ms |
| Coque −3 mm | 35 – 46 ms |
| Perçage ∅12 (coupe cylindre) | 119 – 174 ms |
| Répétition 6 trous (fuse + cut) | 77 – 93 ms |
| Lissage 3 sections (`loftWith`) | 47 ms |
| Balayage hélice | 16 ms |
| Coupe par plan (`cutPlane`) | 15 – 38 ms |
| Intersection native | 79 ms |
| Pièce 5 fonctions (extrude + congé + perçage + coque + chanfrein) | **256 ms** |
| Tessellation fine (5 530 triangles, tol. 0,02) | 107 ms |
| Tessellation 86 868 triangles | 576 ms |
| 200 perçages (coupes séquentielles) | **9 543 ms** ⚠️ |
| 200 perçages (outils fusionnés) | **5 989 ms** ⚠️ |
| Export STEP pièce simple | 15,5 Ko |
| Projection 2D + SVG (vue + arêtes cachées) | < 10 ms |
| Solveur 8×8 | 0,03 ms / résolution |

**Lecture** : une pièce courante (10–30 fonctions) se reconstruit en **< 1 s** → un rebuild paramétrique à chaque validation de commande est réaliste. Les cas pathologiques (centaines de perçages) doivent être regroupés, prévisualisés en maillage et signalés.

---

## 6. Décisions issues du spike

1. **Noyau dans un Web Worker dédié** (thread UI jamais bloqué), avec client RPC typé et RPC annulables ; le redémarrage du worker reste disponible à la demande (bouton de diagnostic) mais **n'est pas nécessaire à chaque erreur** (§8).
2. **Contournements centralisés** dans `kernel/compat.ts` : `loftSafe`, `boxSafe`, `cutMany`, `fuseOrCompound`, `intersectSafe`, `draftScaleFactors`. Aucun appel direct à `R.loft`, `shape.draft`, `fillet(tableau)`, `cut(tableau)` dans le code métier.
3. **Nomenclature topologique maison** (obligatoire, cf. §3.7) : l'utilisateur doit pouvoir modifier une cote et conserver les congés/perçages attachés aux bonnes faces.
4. **Solveur planegcs dans son propre worker** (le glissement d'esquisse ne doit pas attendre une reconstruction lourde) ; `dof()` fournit le statut exact.
5. **Sélection/rendu** : three.js + `faceGroups`/`edgeGroups` comme pont entre le picking et le B-Rep ; le maillage est un cache jetable, jamais une source de vérité.
6. **Export/import** : STEP et STL natifs ; OBJ, 3MF, DXF, PDF, SVG à écrire (module I/O).
7. **Licences** : `replicad-opencascadejs` et `planegcs` sont **LGPL-2.1 / LGPL-2.0+** → WASM conservés en fichiers séparés remplaçables + sources et notices ; `replicad` est MIT. Revue juridique avant diffusion commerciale.

---

## 7. Reproduire le spike

```bash
mkdir spike && cd spike && npm init -y
npm i replicad replicad-opencascadejs @salusoft89/planegcs
node --version          # ≥ 20 recommandé
```

Les essais du spike sont désormais **figés en tests automatisés** dans l'application : `cao_web/tests/kernel.spec.ts` (16 tests) — contournements, chaîne esquisse→extrusion→tessellation, erreurs de fonction, export STEP et solveur de contraintes.

```bash
cd cao_web && npm install && npm test
```

---

## 8. Rectificatif du 2026-10-14 (essais rejoués)

Lors de la mise en œuvre, trois constats du premier passage ont été **rejoués dans des processus propres** et se sont révélés **erronés** :

| Constat initial (faux) | Réalité vérifiée | Origine de l'erreur |
|---|---|---|
| « `makeBox()` est cassé et lève une exception » | `makeBox(corner1, corner2)` fonctionne parfaitement (8000 mm³ pour `[0,0,0]→[20,20,20]`, bornes exactes). C'est l'appel `makeBox(20, 20, 20)` qui échoue : l'API attend **deux points 3D**. | Lecture erronée de la signature ; l'erreur WASM est opaque (aucun message), ce qui a masqué la cause. |
| « `intersect()` est cassé » | `.intersect()` fonctionne : 3375 mm³ pour l'intersection de deux cubes, 16 000 mm³ pour une plaque ∩ bande. | Tous les essais d'intersection utilisaient des boîtes construites avec le mauvais appel `makeBox`. |
| « Une exception WASM corrompt l'instance OpenCascade, il faut redémarrer le worker » | Une exception **attrapée** ne perturbe rien : après `makeBox(20,20,20)` en échec, la découpe suivante donne toujours exactement 78 000 mm³. | Cascade d'échecs due au mauvais appel d'API, interprétée à tort comme une corruption d'état. |

**Conséquences appliquées au code et au plan** :

* `intersectSafe()` utilise l'appel **natif** (avec repli `A − (A − B)` par sécurité) — plus rapide et plus exact ;
* `boxSafe()` / `boxBetween()` construisent les boîtes par **deux coins** ;
* la stratégie de robustesse passe de « redémarrer le worker à chaque exception » à « **capturer et signaler l'erreur, reconstruire proprement** » ; le redémarrage du worker reste un outil de diagnostic ;
* deux tests figent la réalité : l'API `makeBox` à deux coins (+ l'erreur opaque en cas de mauvais appel) et la **récupération après exception** ;
* les pièges restants (loft, draft, fillet(tableau), cut(tableau), hashCode instable, groupes de maillage, absence d'`isValid`) ont été revérifiés **sans** recours à `makeBox` et sont **confirmés**.
