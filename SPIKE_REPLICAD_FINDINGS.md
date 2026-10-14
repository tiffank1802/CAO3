# 🔬 Spike Replicad — Rapport de vérification technique

**Date** : 2026-10-14  
**Objectif** : valider par l'expérience (et non par la documentation) les capacités réelles de la pile `replicad` + `replicad-opencascadejs` + `@salusoft89/planegcs` avant d'engager le plan de développement de la CAO web « type SolidWorks ».  
**Méthode** : chaque essai a été exécuté dans un **processus Node isolé** (`fork`), car une exception WebAssembly peut laisser l'instance OpenCascade (OC) dans un état incohérent et fausser les essais suivants. Scripts : `/tmp/kprobe/*.mjs` (jetables, hors dépôt).

---

## 1. Versions et empreinte

| Paquet | Version | Rôle | Taille |
|---|---|---|---|
| `replicad` | **1.1.0** | API B-Rep de haut niveau (sketch, features, mesh, export) | 572 Ko (ESM) → **125 Ko gzip** |
| `replicad-opencascadejs` | **1.1.0** | Build WASM d'OpenCascade (LGPL-2.1-only) | `single` 22,98 Mo → **6,9 Mo gzip** (`multi` 22,48 Mo) |
| `@salusoft89/planegcs` | **1.3.0** | Solveur de contraintes 2D (portage WASM de PlaneGCS/FreeCAD, LGPL-2.0+) | 484 Ko wasm → **169 Ko gzip** |
| `three` | 0.186.1 | Rendu WebGL (déjà présent dans `cao_frontend`) | — |
| Node / npm utilisés pour le spike | 22.22.3 / 10.9.8 | — | — |

> ⚠️ **Conséquence produit n°1** : 6,9 Mo de WASM à télécharger (≈ 5 Mo en Brotli). Le chargement du noyau doit être *paresseux, mis en cache et progressif* (voir plan § Performances).

---

## 2. Résultats vérifiés — chaîne complète pièce mécanique

Chaîne exécutée avec succès : esquisse rectangle → extrusion 20 mm → congé 6 mm → coque −3 mm → perçage → **répétition de 6 trous** → fusion/coupe booléenne → mesures → tessellation → export.

```ts
import * as R from "replicad";
import opencascade from "replicad-opencascadejs";

const oc = await opencascade();      // 241 ms dans Node
R.setOC(oc);

let p = R.drawRectangle(80, 50).sketchOnPlane("XY").extrude(20);      // 17 ms
p = p.fillet(6, (e) => e.inPlane("XY"));                              // 82 ms
p = p.shell(-3, (f) => f.inPlane("XY", 20));                          // 38 ms
p = p.cut(R.makeCylinder(6, 60).translate(20, 10, -20));              // 119 ms

// répétition + perçages : on fabrique le « peigne » d'outils puis un seul booléen
let tools = null;
for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
  const c = R.makeCylinder(3, 40).translate(-22 + i * 22, -12 + j * 24, -10);
  tools = tools ? tools.fuse(c) : c;
}
const final = p.cut(R.makeCompound([tools]));                          // 77 ms
// => volume 27 120,5 mm³, 33 faces, 78 arêtes
```

### Capacités confirmées ✅

| Domaine | Vérifié | API exacte |
|---|---|---|
| Esquisse 2D → solide | ✅ | `drawRectangle/drawCircle/drawEllipse/drawPolysides/draw…` → `.sketchOnPlane("XY"|"XZ"|"YZ"|plan custom, offset)` / `.sketchOnFace(face)` |
| Extrusion (avec profil de dépouille / torsion) | ✅ | `.extrude(h, { extrusionProfile: { profile: "linear"|"s-curve", endFactor }, twistAngle, extrusionDirection, origin })` |
| Révolution | ✅ | `.revolve(axis, { origin, angle })` |
| Lissage (loft) | ✅ **via `loftWith`** | `sketch.loftWith([s2, s3], { ruled, startPoint, endPoint })` |
| Balayage (sweep) | ✅ | `sketch.sweepSketch((plane, origin) => new R.Sketch(wireSpine), { withContact: true, frenet })` — spine = hélice, polyligne, `assembleWire` |
| Congés / chanfreins | ✅ | `.fillet(r \| (edge) => r, e => e.inPlane(...) \| e.ofLength(x) \| e.parallelTo(...))`, `.chamfer(r, …)` |
| Coque (shell) | ✅ | `.shell(-3, f => f.inPlane("XY", 20))` ou `f.containsPoint([x,y,z])` |
| Dépouille | ✅ (contournement) | `.draft()` casse (voir pièges) → utiliser `extrusionProfile` ou `loftWith` entre deux profils mis à l'échelle |
| Coupe / scission | ✅ | `.cutPlane(plane, offset, "above"|"below")` → 40 000 mm³ sur la moitié d'un 80×50×20 ✔ |
| Booléens | ✅ (avec précautions) | `.fuse()`, `.cut()`, `.intersect()` ⚠️ (voir pièges) ; ensembles d'outils via **`R.makeCompound([...])`** |
| Transformations | ✅ | `.translate/.rotate/.mirror("YZ")/.scale(k)` |
| Perçage/taraudage/etc. | ✅ | pas d'API dédiée → composition d'outils (cylindre, cône pour fraisure, `makeHelix` + `genericSweep` pour filet réel) |
| Textes gravés | ✅ | `R.loadFont(arrayBuffer, "default")` puis `R.sketchText("CAO3", { fontSize })` → `.extrude(1)` |
| Mesures / propriétés | ✅ | `measureVolume`, `measureShapeVolumeProperties` (volume, centre de masse), `measureShapeLinearProperties`, `measureDistanceBetween`, `measureArea`, `measureLength` |
| Mise en plan (vues 2D) | ✅ | `R.drawProjection(shape, R.lookFromPlane("XZ"))` → `{ visible, hidden }` (Drawings) → `.toSVG()`, `.toSVGPaths()` (vues + arêtes cachées, parfait pour une « Mise en plan web ») |
| Tessellation | ✅ | `shape.mesh({ tolerance, angularTolerance })` → `{ vertices, triangles, normals, faceGroups }` ; `shape.meshEdges()` → `{ lines: Float32Array, edgeGroups }` |
| Export | ✅ | `.blobSTEP()` (Blob), `.blobSTL({ binary: true })`, `.blobSTL()` (ascii) ; pas de `blobOBJ`/`blobSTP` (noms erronés vus dans des exemples) |
| Import | ✅ | `await R.importSTEP(blob)` (asynchrone, **Blob** et non ArrayBuffer), `R.importSTL`, `R.importSTLAsMesh` |
| Sélection par propriétés | ✅ | `FaceFinder` : `ofSurfaceType, inPlane, parallelTo, shouldKeep` · `EdgeFinder` : `inDirection, ofLength, ofCurveType, parallelTo, inPlane` |
| Solveur de contraintes | ✅ | voir §4 — exact, détection de conflits, temps réel |

### Capacités absentes (à construire) ❌

* Pas de noyau *paramétrique à historique* : **l'arbre de fonctions, le rebuild, la nomenclature topologique, les configurations sont à notre charge**.
* Pas de solveur d'assemblage (contraintes 3D), pas de mise en plan (cotation/cartouche), pas de tôlerie, pas de surfaces avancées, pas de perçage « assistant ».
* Pas d'export OBJ / 3MF / DXF / PDF / glTF → **à écrire** (100 % faisable côté client : OBJ/3MF depuis la tessellation, DXF depuis les `Curve2D`/`Drawing`, PDF depuis une mise en plan SVG).
* Pas de décalage d'entités 2D exposé (`makeOffset` = offset de **Face 3D**), pas de rognage/prolongation d'esquisse → à implémenter dans notre module d'esquisse.

---

## 3. Pièges vérifiés (⚠️ critique pour le plan)

| # | Piège observé | Preuve | Contournement retenu |
|---|---|---|---|
| 1 | **`R.makeBox(w,d,h)` lève une `WebAssembly.Exception`** | `R.makeBox(20,20,20)` → exception ; `R.makeBaseBox(20,20,20)` → volume 8 000 ✔ | Bannir `makeBox` ; utiliser `makeBaseBox` (centré) ou nos propres primitives |
| 2 | **`R.loft([s1, s2])` lève `BRepOffsetAPI_ThruSections.AddWire … invalid signature`** | testé en cercle→cercle et rect→rect | **Toujours passer par `sketch.loftWith([...])`** (vérifié OK, y compris `startPoint`/`endPoint`) |
| 3 | **`shape.intersect()` lève une `WebAssembly.Exception`** (2 boîtes, pièce∩boîte, plan) | 3 essais isolés | Intersection = `A.cut(A.cut(B))` → vérifié (16 000 mm³ attendus ✔) ; à encapsuler dans `boolOps.intersect()` |
| 4 | **`shape.draft(angle, faceFinder)` lève une exception** | rectangle extrudé + 5° | Dépouille via `extrusionProfile` (linéaire) ou `loftWith` entre profil de base et profil mis à l'échelle ; dépouille par face = v2 via `getOC()` brut |
| 5 | **`fillet([r1,r2,…], finder)` casse** (`filterToDelete?.delete is not a function`) | tableau de rayons | Rayon variable via **callback par arête** : `fillet(e => r[e.hashCode % n], finder)` ✔ ; vrai congé progressif = accès OC brut (`BRepFilletAPI_MakeFillet.Add`), v2 |
| 6 | **`cut(array)` non supporté** (`Cannot use 'in' operator … 'wrapped'`) | tableau de 5 cylindres | `shape.cut(R.makeCompound(tools))` ✔ (99 ms pour 5 perçages) |
| 7 | **Une exception WASM corrompt l'instance OC** | après un `intersect()` raté, des appels anodins échouent | **1 worker = 1 instance OC** ; sur erreur : marquer le worker *dirty*, le redémarrer, rejouer l'arbre de fonctions |
| 8 | **Coque + perçage → volume négatif (−32 207 mm³) sans erreur levée** | chaîne extrude→fillet→cut→shell | Pas d'`isValid()` exposé : valider systématiquement `volume > 0`, bbox plausible, delta de faces ; sinon documenter un avertissement de fonction |
| 9 | **`hashCode` de faces/arêtes instable entre deux reconstructions identiques** | 2 builds identiques → `facesSame = false` | **Nomenclature topologique maison obligatoire** (références géométriques : type de surface, aire, centre, normale, longueur, adjacence) |
| 10 | `meshEdges()` renvoie `{ lines, edgeGroups }` (et non un `Float32Array`) ; `mesh()` n'a **pas** d'`edgeGroups` | inspection des clés | Le rendu utilise `mesh().faceGroups[].faceId` ↔ `face.hashCode`, et `meshEdges().edgeGroups[].edgeId` ↔ `edge.hashCode` |
| 11 | `FaceFinder` **n'a pas** `containsPoint` dans cette version (contrairement à des exemples publics) | `getOwnPropertyNames` | Sélection interactive **par notre moteur** : raycast three.js → `faceGroup.faceId` → face OC ; prédicats Finder pour les références d'historique |
| 12 | `importSTEP` est **asynchrone** et prend un **Blob** | `importSTEP(blob)` → OK ; `importSTEP(arrayBuffer)` → TypeError | `const shape = await R.importSTEP(file)` |
| 13 | `sketchText` exige une police chargée avant | sans police : `Cannot read properties of undefined (reading 'getPath')` | Embarquer un `.ttf` local (ex. `@expo-google-fonts/inter`, TTF réel) et `loadFont(buffer, "default")` — **aucun CDN** |
| 14 | Booléens massifs très lents | 200 perçages : **9 543 ms** en coupes séquentielles, **5 989 ms** en fusion d'outils | Voir stratégie de performance du plan : *checkpoints*, prévisualisation maillée, plafonds d'avertissement, workers parallèles |

---

## 4. Solveur d'esquisse (planegcs) — validé

**Rectangle 4 lignes + 8 contraintes** (2 horizontales, 2 verticales, origine fixée, 40 × 25) :

```
solve=0 (OK) en 6,7 ms | points = (0,0) (40,00) (40,25) (0,25)     ✅ exact
conflits: false | redondances: false
ajout d'une cote contradictoire (99 mm) → status=2, conflicting=true, ids=["c6","c8"]   ✅ diagnostic exploitable en UI
tangence cercle/cercle (rayons 10 et 20, centres distants de 30) → r₂ = 20,000        ✅
performance : 300 résolutions ≈ 9 ms  →  0,03 ms / solve                               ✅ temps réel
```

* ~100 types de contraintes disponibles : `p2p_coincident`, `horizontal_l`, `vertical_l`, `parallel`, `perpendicular_ll`, `tangent_*` (droite/cercle/arc/ellipse), `equal_length`, `equal_radius_cc`, `p2p_symmetric_ppl`, `midpoint_on_line_ll`, `p2p_distance`, `p2l_distance`, `circle_radius`, `circle_diameter`, `l2l_angle_ll`, `point_on_*`, `snells_law`…
* Les contraintes ont un drapeau **`driving`** → cotes **pilotes** vs **de référence** (comme SolidWorks).
* Chaque objet (point, ligne, cercle, arc, ellipse, bspline, contrainte) porte un `id` stable → parfait pour sérialiser une esquisse et l'afficher en couleur « entièrement contrainte » (statut `SolveStatus`).

**Implémentation type** (`types: point|line|circle|arc|ellipse|bspline|param`, puis contraintes à plat, `id` obligatoire partout) :

```ts
const gcs = await GCS.make_gcs_wrapper();
gcs.push_primitives_and_params([...points, ...lines, ...constraints]);
gcs.solve(GCS.Algorithm.DogLeg);  // 0 = OK
gcs.apply_solution();             // réécrit les primitives résolues
gcs.get_gcs_conflicting_constraints(); // → à surligner en rouge dans l'UI
```

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
| Intersection (contournement) | 79 ms |
| Pièce 5 fonctions (extrude+congé+perçage+coque+chanfrein) | **256 ms** |
| Tessellation fine (5 530 triangles, tol. 0,02) | 107 ms |
| Tessellation 86 868 triangles (30 faces) | 576 ms |
| 200 perçages (coupes séquentielles) | **9 543 ms** ⚠️ |
| 200 perçages (outils fusionnés) | **5 989 ms** ⚠️ |
| Export STEP pièce simple | 15,5 Ko |
| Projection 2D + SVG (vue + cachées) | < 10 ms |
| Solveur 8×8 | 0,03 ms / solve |

**Lecture** : une pièce « normale » (10–30 fonctions) se reconstruit en **< 1 s**, ce qui autorise un *rebuild* paramétrique à chaque validation de commande. Les cas pathologiques (centaines de perçages individuels) doivent être **regroupés** (un seul booléen), prévisualisés en maillage, et signalés.

---

## 6. Décisions issues du spike (entrées du plan)

1. **Architecture noyau dans un Worker dédié**, pool de 1..N, jamais dans le thread UI ; redémarrage automatique du worker après toute exception WASM.
2. **Bannissement documenté** de `makeBox`, `loft()`, `intersect()`, `draft()` au profit des contournements vérifiés (§3) — encapsulés dans une couche `kernel/compat.ts`.
3. **Nomenclature topologique maison** (obligatoire, cf. §3.9) : l'utilisateur doit pouvoir modifier une cote d'esquisse et conserver les congés/perçages attachés aux bonnes faces.
4. **Solveur planegcs intégré au worker** (ou worker séparé) : contraintes temps réel, détection de conflits exploitable en UI.
5. **Sélection/rendu** : three.js + `faceGroups`/`edgeGroups` comme pont entre le picking et le B-Rep ; le mesh est un *cache* jetable, jamais une source de vérité.
6. **Export/import** : STEP et STL natifs ; OBJ, 3MF, DXF, PDF, SVG à écrire (module I/O).
7. **Textes** : police TTF embarquée localement (pas de CDN, offline-first).
8. **Licences** : `replicad-opencascadejs` et `planegcs` sont **LGPL** → garder les WASM en fichiers séparés remplaçables (relink) + conserver sources/notices ; `replicad` est MIT. À valider juridiquement avant diffusion commerciale.

---

## 7. Reproduire le spike

```bash
mkdir spike && cd spike && npm init -y
npm i replicad replicad-opencascadejs @salusoft89/planegcs
node --version   # ≥ 20 recommandé
```

Les scripts de vérification utilisés (chaîne complète, matrice de pièges, benchmarks, solveur) sont reproduits dans les annexes des documents de plan ; ils seront convertis en **tests automatisés** (`tests/kernel/*.spec.ts`) au lot 0 du plan.
