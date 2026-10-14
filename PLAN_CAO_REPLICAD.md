# 🧭 Plan de construction — CAO web « type SolidWorks » sur Replicad

**Version** : 1.0 · **Date** : 2026-10-14 · **Statut** : proposition à valider  
**Base technique vérifiée** : `replicad 1.1.0` + `replicad-opencascadejs 1.1.0` + `@salusoft89/planegcs 1.3.0` + `three 0.186.1` → voir **[SPIKE_REPLICAD_FINDINGS.md](SPIKE_REPLICAD_FINDINGS.md)** (toutes les capacités et limites citées ici ont été mesurées, pas supposées).  
**Spécification détaillée des rubans** : **[SPEC_RUBANS_FONCTIONS.md](SPEC_RUBANS_FONCTIONS.md)**

---

## 1. Vision et périmètre

> **Faire de la CAO paramétrique mécanique dans le navigateur, avec la densité fonctionnelle et les réflexes de SolidWorks : rubans, arbre de construction, esquisses contraintes, fonctions 3D avancées, assemblages, mise en plan, export STEP/STL — sans installation, sans serveur de calcul, avec les fichiers de l'utilisateur comme source de vérité.**

### 1.1 Dans le périmètre (v1 → v1.5)

| Pilier | Contenu |
|---|---|
| **Esquisse 2D** | Ligne, rectangle (centre / à partir des bords / 3 points), cercle (centre-rayon, périmètre, 2 points, 3 points), arc (centre, 3 points, tangent), ellipse (+ arc d'ellipse), spline, polyligne, polygone, rainure (oblong), point, texte ; congé/chanfrein d'esquisse, rognage/prolongation, décalage, symétrie, répétition, *convertir des entités* ; **contraintes et cotes complètes** (solveur temps réel, statut « entièrement contraint », détection de conflits) |
| **Fonctions 3D** | Bossage/extrusion base ▾ (aveugle, jusqu'au sommet, jusqu'à la face, à travers tout, milieu, symétrique, 2 directions, **dépouille**), enlèvement de matière, révolution, lissage, balayage, nervure, coque, congés ▾ (constante, variable, face à face, sommet), chanfreins ▾, dépouille, symétrie, répétitions ▾ (linéaire, circulaire, esquisse, tableau), perçages ▾ (simple, taraudé, alésé, lamé, fraisé, sur plusieurs faces), fusionner, soustraire, intersecter, scission, déplacer/copier le corps |
| **Modélisation** | Arbre de construction (**FeatureManager**), édition/reconstruction paramétrique, suppression/compression, **nomenclature topologique persistante**, configurations, équations/paramètres globaux |
| **Assemblage** | Insertion de pièces, contraintes (coïncidence, parallélisme, perpendicularité, concentrique, tangente, distance, angle, verrou), solveur d'assemblage, détection d'interférences, nomenclature (BOM) |
| **Mise en plan** | Vues projetées (face/dessus/côté/iso), coupes, vues auxiliaires, cotation, annotations, cartouche, export **PDF / DXF / SVG** |
| **Évaluation** | Mesures (distance, angle, rayon, épaisseur), propriétés de masse (volume, aire, masse, centre de gravité, inertie), analyse de dépouille, section dynamique, comparaison de pièces (v1.5) |
| **Échange de données** | **Import** STEP, STL ; **Export** STEP, STL, OBJ, 3MF, DXF, PDF, PNG |
| **Apparence** | Styles d'affichage ombré/arêtes/filaire/transparence, matériaux, arêtes de silhouette, ombres, environnement, coupes visuelles |

### 1.2 Hors périmètre v1 (assumé et documenté)

Tôlerie (dépliage), surfaces NURBS avancées, simulation/FEA, CAM/usinage, rendu photoréaliste avancé, GD&T normalisé, collaborations temps réel (v2), reconnaissance d'import STEP en arbre de fonctions (v2 — import = corps « mort » avec possibilité d'appliquer des fonctions).

> Chaque fonction refusée doit être **grégée dans l'interface** (icône désactivée + infobulle « prévu en v2 ») plutôt qu'absente : c'est ce qui donne la sensation de complétude d'un « SolidWorks ».

---

## 2. Principes d'architecture (directives non négociables)

| # | Principe | Raison (issue du spike) |
|---|---|---|
| P1 | **Le document est la vérité, la géométrie est un cache.** Un document = JSON sérialisable (arbre de fonctions, esquisses, contraintes, configurations) ; la B-Rep se reconstruit. | `hashCode` instable, B-Rep non sérialisable ; permet undo/redo, versions, partage, import. |
| P2 | **Le noyau vit dans un Web Worker.** Thread UI jamais bloqué ; OC WASM instancié une fois par worker. | Init 241 ms, opérations 10–250 ms, exceptions qui corrompent l'instance. |
| P3 | **Panier de contournements centralisé** (`kernel/compat.ts`) pour `makeBox`, `loft`, `intersect`, `draft`, `cut(array)`. | 5 pièges vérifiés — aucun appel direct dans le code métier. |
| P4 | **Nomenclature topologique maison** : toute sélection persistée est une *référence géométrique* (jamais un `hashCode`). | Faces/arêtes changent d'identifiant à chaque rebuild. |
| P5 | **Aucun échec silencieux** : chaque fonction produit un `FeatureResult { shape, warnings[], timings, refs }`, validé (volume > 0, bbox, faces). | Coque invalide renvoyée sans erreur (volume négatif). |
| P6 | **Fail-fast contrôlé** : toute exception WASM ⇒ worker *dirty*, redémarrage + rejeu de l'arbre jusqu'à la fonction fautive. | État OC corrompu après exception. |
| P7 | **Le rendu est un cache jetable** : maillage tessellé, jamais une donnée persistée ; niveaux de détail adaptatifs. | Coût tessellation 4–576 ms selon tolérance. |
| P8 | **Tout est adressable** : chaque fonction, esquisse, contrainte, cote, vue, contrainte d'assemblage a un identifiant stable, utilisé pour l'UI, l'URL d'état, les tests et le partage. | Condition d'un produit maintenable. |
| P9 | **Offline-first** : sauvegarde locale (IndexedDB), fichiers locaux, aucune dépendance CDN (police TTF embarquée). | Textes, export, reprise de session. |
| P10 | **Budget de performance affiché** : chaque action montre sa durée dans la barre d'état (comme SolidWorks « Reconstruire »). | Culture de la performance dès le lot 0. |

---

## 3. Architecture applicative

### 3.1 Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  THREAD UI  (Vue 3 + TypeScript)                                             │
│                                                                              │
│  Rubans ▸ PropertyManager ▸ FeatureManager ▸ Barre d'état ▸ Recherche (S)    │
│                                                                              │
│  ┌───────────────────────┐   ┌──────────────────────┐   ┌─────────────────┐  │
│  │ SketchCanvas (Konva)  │   │ Viewer3D (three.js)  │   │ Mise en plan    │  │
│  │  esquisse 2D + cotes  │   │  meshes, arêtes,     │   │ (SVG/Canvas)    │  │
│  │  inférence, snapping  │   │  sélection, coupes   │   │  vues + cotes   │  │
│  └──────────┬────────────┘   └─────────┬────────────┘   └────────┬────────┘  │
│             │  store Pinia (document, sélection, UI)             │           │
└─────────────┼──────────────────────────┼─────────────────────────┼───────────┘
              │       KernelClient (RPC typé, postMessage, Transferable)
      ┌───────▼──────────────────────────▼─────────────────────────▼────────┐
      │  WEB WORKERS                                                         │
      │  ┌────────────────────────┐  ┌───────────────────┐  ┌─────────────┐  │
      │  │ Worker Noyau (OC)      │  │ Worker Solveur    │  │ Worker I/O  │  │
      │  │  compat.ts             │  │  planegcs (wasm)  │  │  STEP/STL   │  │
      │  │  builders/<feature>.ts │  │  contraintes 2D   │  │  exports    │  │
      │  │  topoRef.ts            │  │  solve < 0,1 ms   │  │  PDF/DXF    │  │
      │  │  cache.ts (checkpoints)│  │                   │  │             │  │
      │  │  tessellate.ts         │  │                   │  │             │  │
      │  └────────────────────────┘  └───────────────────┘  └─────────────┘  │
      └──────────────────────────────────────────────────────────────────────┘
                     │                                      │
             IndexedDB (documents, caches)           Backend optionnel
             Fichiers locaux (.cao3.json, STEP…)     (comptes, sync, partage)
```

### 3.2 Stack retenue

| Couche | Choix | Justification / alternative écartée |
|---|---|---|
| UI | **Vue 3 + TypeScript + Vite** | Déjà en place dans `cao_frontend` (Vue 3.5, Pinia, Vite 7) — on capitalise ; React serait à réécrire. |
| État | **Pinia** (déjà présent) | Stores découpés : `document`, `selection`, `ui`, `kernelStatus`, `history`. |
| Esquisse 2D | **Konva** (déjà présent, `vue-konva`) | Bon compromis pour des dizaines de milliers d'objets, hit-testing intégré. |
| 3D | **three.js** (déjà présent) | `faceGroups`/`edgeGroups` de replicad s'y branchent directement ; VTK.js écarté (lourd, orienté visualisation scientifique). |
| Noyau | **replicad + OpenCascade WASM** | Vérifié : B-Rep sérieux, STEP natif, booléens, congés. |
| Contraintes | **@salusoft89/planegcs** | Vérifié : exact, conflits, 0,03 ms/solve. |
| Formulaires/PropertyManager | **notre composant** `PropertyPanel` piloté par schéma (`FeatureTypeRegistry`) | Évite d'écrire 60 formulaires à la main ; chaque fonction déclare ses paramètres + UI hints. |
| Valeurs/expressions | moteur d'expressions maison (parser ~300 lignes) | Équations globales, cotes pilotées par formule (« = "D1"*2 »). |
| Schéma/validation | **zod** | Validation du document, migrations de version. |
| Tests | **Vitest** (unitaires/noyau) + **Playwright** (parcours UI) | Corpus de non-régression géométrique. |
| Backend | **Django existant, optionnel et réduit** au rôle « comptes + projets + versions + partage » | Toute la géométrie est locale ; le backend ne calcule jamais de B-Rep. |

### 3.3 Arborescence cible du code

```
cao_frontend/
├─ src/
│  ├─ cad/
│  │  ├─ core/                     # modèle documentaire — pur TS, testable, sans UI ni wasm
│  │  │  ├─ document.ts            # Document, Part, Feature, Sketch, Configuration, Material
│  │  │  ├─ schema.ts              # schémas zod + migrations de version
│  │  │  ├─ registry.ts            # FeatureTypeRegistry : type → params, validation, UI hints, icône
│  │  │  ├─ selection.ts           # SelectionRef (topologique) + filtres (faces/arêtes/sommets)
│  │  │  ├─ expressions.ts         # moteur d'équations / paramètres globaux
│  │  │  ├─ history.ts             # pile undo/redo par commandes (transactionnel)
│  │  │  ├─ units.ts               # unités, tolérances d'affichage
│  │  │  └─ types.ts
│  │  ├─ kernel/                   # tout ce qui parle à OpenCascade
│  │  │  ├─ worker.ts              # entrée worker : init OC + planegcs + boucle RPC
│  │  │  ├─ client.ts              # KernelClient typé (Promise, annulation, progression)
│  │  │  ├─ pool.ts                # pool de workers (1 par document ouvert / parallélisme)
│  │  │  ├─ compat.ts              # P3 : makeBoxSafe, loftSafe, intersectSafe, draftSafe, cutMany
│  │  │  ├─ rebuild.ts             # moteur de reconstruction (arbre → forme), checkpoints
│  │  │  ├─ topoRef.ts             # génération + résolution des références persistantes
│  │  │  ├─ validate.ts            # P5 : volume, bbox, comptage, heuristiques d'invalidité
│  │  │  ├─ tessellate.ts          # mesh + meshEdges → buffers transferables
│  │  │  └─ builders/              # 1 fichier = 1 fonction (voir §6)
│  │  │     ├─ sketchEntity.ts     # esquisse → Blueprint/Sketch (avec solveur déjà appliqué)
│  │  │     ├─ extrude.ts revolve.ts loft.ts sweep.ts rib.ts shell.ts
│  │  │     ├─ fillet.ts chamfer.ts draft.ts hole.ts
│  │  │     ├─ pattern.ts mirror.ts boolean.ts split.ts body.ts
│  │  │     └─ external.ts         # import STEP/STL → corps
│  │  ├─ sketch/                   # esquisse 2D interactive
│  │  │  ├─ store.ts               # entités, contraintes, cotes, statut solveur
│  │  │  ├─ solverClient.ts        # pont vers le worker planegcs
│  │  │  ├─ inference.ts           # contraintes automatiques (H/V, coïncidence, tangence, alignement)
│  │  │  ├─ snap.ts                # accrochages grille/entités/cotes/origine
│  │  │  ├─ tools/                 # line.ts, rectangle.ts (centre|bords|3pts), circle.ts (4 modes),
│  │  │  │                         # arc.ts (centre|3pts|tangent), ellipse.ts, spline.ts, slot.ts,
│  │  │  │                         # polyline.ts, polygon.ts, text.ts, trim.ts, extend.ts, offset.ts,
│  │  │  │                         # mirror.ts, pattern.ts, convert.ts, filletCorner.ts
│  │  │  ├─ render.ts              # calques Konva : géométrie, cotes, contraintes, surbrillances
│  │  │  └─ dims.ts                # cotation intelligente (5 clics SolidWorks / cotes multiples)
│  │  ├─ view/                     # 3D three.js
│  │  │  ├─ viewer.ts              # scène, caméra orbitale, lumières, environnement
│  │  │  ├─ meshStore.ts           # buffers par corps, mise à jour incrémentale, LOD
│  │  │  ├─ picking.ts             # raycast → faceId/edgeId → SelectionRef ; pré-sélection
│  │  │  ├─ gizmo.ts               # triade de manipulation, poignées de cote
│  │  │  ├─ section.ts             # plans de coupe (clipping + modèle sectionné réel)
│  │  │  ├─ measure.ts             # mesures 3D (magnétisme sommets/arêtes), cotes à l'écran
│  │  │  └─ styles.ts              # ombré/arêtes/filaire/transparence, matériaux
│  │  ├─ ui/                       # composants Vue
│  │  │  ├─ ribbon/                # Ribbon.vue + RibbonTab.vue + définitions d'onglets (§ SPEC)
│  │  │  ├─ FeatureManager.vue     # arbre, glisser-déposer, menu contextuel, états (erreur/avert.)
│  │  │  ├─ PropertyManager.vue    # panneau contextuel de commande (gauche, comme SW)
│  │  │  ├─ SelectionFilter.vue · ContextBar.vue · SearchBar.vue (touche S)
│  │  │  ├─ StatusBar.vue          # unités, statut solveur, durée de rebuild, mémoire
│  │  │  ├─ CommandPalette.vue     # recherche de commande multi-langue
│  │  │  └─ dialogs/               # Propriétés, Équations, Configurations, Unités, Préférences
│  │  ├─ io/
│  │  │  ├─ step.ts (import/export) · stl.ts · obj.ts · three-mf.ts · dxf.ts · pdf.ts · png.ts
│  │  │  └─ documentFile.ts        # .cao3.json (lecture/écriture, migration, vérification)
│  │  ├─ drawing/                  # mise en plan
│  │  │  ├─ projection.ts          # R.drawProjection → vues (visible/caché)
│  │  │  ├─ views.ts · section.ts · dims.ts · titleBlock.ts · sheet.ts
│  │  ├─ assembly/                 # assemblage
│  │  │  ├─ model.ts · mates.ts · solver.ts · interference.ts · bom.ts
│  │  ├─ persist/
│  │  │  ├─ indexeddb.ts · autosave.ts · sessions.ts
│  │  └─ assets/fonts/Inter-Regular.ttf  # textes d'esquisse (offline)
│  ├─ workers/                     # points d'entrée workers (new Worker(new URL(...), {type:'module'}))
│  ├─ pages/                       # pages existantes (Login, Dashboard, Projet…) conservées
│  └─ stores/                      # stores existants (app, auth) — à réutiliser
└─ tests/
   ├─ kernel/   # corpus doré : volume/bbox/faces/arêtes par fonction
   ├─ toporef/  # stabilité de sélection (modification de cote → mêmes faces)
   ├─ sketch/   # solveur, inférence, conflits
   └─ e2e/      # Playwright : parcours « nouvelle pièce → cube → perçage → export STEP »
```

---

## 4. Modèle de document (source de vérité)

```jsonc
{
  "schema": "cao3/document@1",
  "id": "doc_9f2…",
  "name": "Support moteur",
  "units": { "length": "mm", "angle": "deg", "decimals": 2 },
  "parameters": {                       // équations / paramètres globaux
    "epaisseur": { "value": 6, "unit": "mm", "comment": "épaisseur tôle fonctionnelle" },
    "entraxe":   { "expression": "epaisseur * 4" }
  },
  "configurations": [                    // comme SW : jeux de valeurs + compression de fonctions
    { "id": "defaut", "name": "Défaut", "overrides": {} },
    { "id": "cfg_v2", "name": "Variante 2", "suppressedFeatures": ["f5"], "overrides": { "f2.depth": 30 } }
  ],
  "features": [
    {
      "id": "f1", "type": "sketch", "name": "Esquisse1", "suppressed": false,
      "plane": { "kind": "base", "name": "XY", "offset": 0 },     // ou {kind:"face", ref: TopoRef}
      "entities": [
        { "id": "e1", "type": "rectangle", "mode": "center", "center": "origin",
          "width": 80, "height": 50 }
      ],
      "constraints": [
        { "id": "c1", "type": "horizontal_l", "refs": ["l1"], "driving": true }
      ],
      "dimensions": [ { "id": "d1", "type": "p2p_distance", "refs": ["p1","p2"], "value": 80 } ]
    },
    {
      "id": "f2", "type": "extrude", "name": "Bossage-Extrusion1",
      "profile": { "kind": "feature", "id": "f1" },
      "end": { "type": "blind", "depth": 20, "draftAngle": 0, "draftOutward": false },
      "operation": "newBody",                       // newBody | fuse | cut | intersect
      "direction": { "reverse": false, "both": false, "upTo": null }
    },
    {
      "id": "f3", "type": "fillet", "name": "Congé1", "radius": 6,
      "edges": [ { "model": "f2", "kind": "face", "selector": { "surfaceType": "plane", "normal": "Z",
                   "signature": { "area": 4000, "center": [0,0,20] } } } ]
    }
  ],
  "materials": { "body1": { "name": "Acier doux", "density": 7.85e-6 } },

  "views": [], "drawings": [], "assemblies": [],

  "tree": { "order": ["f1","f2","f3"], "groups": [{ "name": "Corps principal", "features": ["f1","f2","f3"] }] }
}
```

**Règles**

* Tout identifiant est **stable et généré côté client** (`nanoid` court, jamais recyclé).
* Les sélections persistées (`edges`, `faces`, `vertices`) sont des **`TopoRef`** (§5.3), jamais des indices ni des `hashCode`.
* Le document est **versionné** (`schema`) avec migrations automatiques à l'ouverture.
* Sauvegarde : IndexedDB en continu (autosave 1 s après inactivité) + export fichier `.cao3.json` ; l'import STEP/STL crée une fonction `external` (corps non paramétrique, marqué comme tel dans l'arbre).

---

## 5. Moteur de reconstruction paramétrique

### 5.1 Pipeline

```
                       ┌──────────────────────────────────────────────┐
   Document (JSON) ───▶│  Planificateur : quoi reconstruire ?         │
                       │  (dirty flags : fonction modifiée + aval)    │
                       └───────────────┬──────────────────────────────┘
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │  Pour chaque fonction depuis le dernier checkpoint valide :   │
       │   1. résoudre les TopoRef (faces/arêtes/plans référencés)     │
       │   2. builder → nouvelle forme B-Rep        (compat.ts)        │
       │   3. valider (volume>0, bbox, Δfaces, durée)                  │
       │   4. indexer les nouvelles faces/arêtes (lineage de fonction) │
       │   5. checkpoint (forme + métadonnées)                         │
       └───────────────┬───────────────────────────────────────────────┘
                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │  Tessellation incrémentale → buffers (transferable)           │
       │  → thread UI : three.js (faces, arêtes, groupes de sélection) │
       └───────────────────────────────────────────────────────────────┘
```

* **Checkpoints** : après chaque fonction, on mémorise la forme OC + la table des références. Modifier la fonction *k* ne rejoue que *k…n* (mesuré : 5 fonctions ≈ 256 ms ; 30 faces ≈ 0,5 s → acceptable en interactif).
* **Debounce intelligent** : pendant le glissement d'une cote, on ne reconstruit qu'à cadence fixe (≈ 15 fps max) sur des formes *simplifiées* (esquisse seule, pas de congés aval) ; reconstruction complète au relâchement.
* **Prévisualisation** : les commandes affichent l'aperçu via une reconstruction « fantôme » sur un clone du contexte (jamais destructif).
* **Annulation/progression** : chaque RPC est annulable ; un rebuild obsolète est ignoré (numéro de révision).

### 5.2 API interne (extrait)

```ts
// kernel/rebuild.ts
export interface RebuildRequest {
  document: Document; revision: number;
  from?: FeatureId;              // checkpoint de départ
  quality: "preview" | "final";
  tessellation: { tolerance: number; angularTolerance: number };
}
export interface RebuildResponse {
  revision: number;
  bodies: BodyMesh[];            // { bodyId, positions, normals, indices, faceGroups, edgeLines, edgeGroups }
  featureStates: FeatureState[];  // ok | warning(warnings[]) | error(message, featureId)
  timings: { [featureId: string]: number };
  refs: TopoRefIndex;            // table des références courantes (pour l'UI)
}
```

### 5.3 Nomenclature topologique (`topoRef.ts`) — le cœur de la robustesse

**Problème** : OpenCascade ne fournit pas d'identifiant stable de face/arête entre deux reconstructions (vérifié : `hashCode` change même à entrée identique). Or « congé sur ces 4 arêtes » ou « perçage sur cette face » doivent survivre au changement d'une cote.

**Solution en 3 étages** :

1. **Lignage de fonction (déterministe)** — chaque builder sait *quelles* faces/arêtes il vient de créer : `builder:extrude` produit `endCapTop`, `endCapBottom`, `side[i]` ; `builder:fillet` produit `filletSurface[i]` ; `builder:cut` produit `holeWall[i]`, `holeBottom[i]`. On indexe ces noms logiques au moment du build (`FaceId = { featureId, role, ordinal }`).
2. **Signature géométrique** — si le rôle disparaît (topologie modifiée), on apparie par signature pondérée :
   `score = w1·|Δaire|/aire + w2·‖Δcentre‖/diagonale + w3·angle(Δnormale) + w4·(même type de surface) + w5·(adjacence commune)`.
   Appariement glouton type hongrois sur les candidats du même type de surface.
3. **Dégradation contrôlée** — si le meilleur score est sous le seuil, la fonction est marquée **avertissement** (« référence topologique perdue ») comme SolidWorks, la géométrie reste valide, et l'utilisateur re-sélectionne.

**Tests dédiés** : corpus `tests/toporef/` — 20 scénarios (changer une cote d'esquisse, réordonner deux fonctions, compresser une fonction intermédiaire, congé sur arête issue d'un perçage…) avec mesure du **taux de conservation des sélections** (objectif ≥ 95 % des scénarios).

---

## 6. Catalogue des fonctions 3D ↔ implémentation

> Détail commande par commande, avec libellés SolidWorks FR/EN : **[SPEC_RUBANS_FONCTIONS.md](SPEC_RUBANS_FONCTIONS.md)**.

| Fonction (FR) | API replicad vérifiée | Effort | Notes |
|---|---|---|---|
| Bossage/Extrusion (base, cut, avec dépouille, 2 directions, jusqu'à…) | `sketch.extrude(h, {extrusionProfile, twistAngle, origin, extrusionDirection})` + `cutPlane` pour « jusqu'à la face » | S | « Jusqu'à la face/sommet » = calcul analytique de la distance avant extrusion |
| Révolution | `sketch.revolve(axis, {origin, angle})` | S | Axe = arête/axe d'esquisse |
| Lissage | `sketch.loftWith([...], {ruled, startPoint, endPoint})` | M | ⚠️ ne jamais utiliser `R.loft()` |
| Balayage | `sketch.sweepSketch(cb, {withContact, frenet})` | M | Chemin = arêtes, spline, hélice ; sections multiples (v1.5) |
| Nervure | composition (extrusion mince + booléens) | M | Bouchon de nervure par extension du profil jusqu'aux faces voisines |
| Coque | `.shell(-t, faceFinder)` | S | Vérifier volume>0 ensuite |
| Congés | `.fillet(r \| e => r, edgeFinder)` | M | Constante ✅, variable ✅ (callback), face-à-face/sommet = composition + OC brut (v2) |
| Chanfreins | `.chamfer(r, edgeFinder)` | S | Idem |
| Dépouille | `extrusionProfile` / `loftWith` (⚠️ `draft()` casse) | M | Dépouille par face = accès OC brut (v2) |
| Perçage / taraudage / lamage / fraisure | outils (`makeCylinder`, cône, `genericSweep` filet) + booléens groupés | M | Assistant « Perçage » : sélection de faces + positionnement par esquisse de points |
| Symétrie (corps/fonction/faces) | `.mirror("YZ")` + booléens ; symétrie de *fonction* = rejeu inverse dans l'arbre | S | |
| Répétitions (linéaire, circulaire, esquisse, tableau) | transformations + **un seul booléen sur un `makeCompound`** | M | ⚠️ ne jamais boucler des booléens (5,9 s / 200 perçages) |
| Fusionner / Soustraire / Intersecter | `.fuse()`, `.cut()`, `.cut(A.cut(B))` pour `intersect` | S | ⚠️ `intersect()` casse |
| Scission (coupe par plan/face) | `.cutPlane(plane, offset, keep)` | S | Vérifié |
| Déplacer/Copier le corps | `.translate/.rotate/.mirror/.scale` | S | |
| Corps externes (import) | `await importSTEP(blob)`, `importSTL` | S | Marqué « non paramétrique » dans l'arbre |
| Vérifier / Propriétés de masse | `measure*` | S | |
| Décaler/Épaissir une surface | — | L | v1.5 (OC brut) |

**Efforts** : S ≤ 1 j · M ≈ 2–4 j · L > 1 sem. (par fonction, hors UI de commande).

---

## 7. Feuille de route par lots (livrables + critères d'acceptation)

> Hypothèse : 1 développeur à plein temps équivaut à ~1 lot de 1 semaine ; la colonne « Estim. » est en jours-homme et suppose 1 dev senior + 0,3 designer/QA. Les lots 0–2 forment le **MVP démontrable**.

### Lot 0 — Socle technique (5 j) 🎯 *rien ne se construit sans ça*

| Tâches | Livrable | Critères d'acceptation |
|---|---|---|
| Projet Vite+TS+Vue, ESLint/Prettier, Vitest, CI | `npm run dev/build/test` verts | CI < 3 min |
| Worker noyau + RPC typé + `compat.ts` + `validate.ts` | `KernelClient.rebuild()` | Cube 80×50×20 reconstruit en < 100 ms ; redémarrage worker automatique après erreur provoquée (test) |
| Viewer three.js + mesh/edgeGroups + picking | cube sélectionnable (face/arête/sommet) | 60 fps sur 100 k triangles ; surbrillance correcte |
| Tessellation adaptative + budget | qualité preview/final | tolérance par défaut 0,05/0,3 ; mesure des durées |
| Conversion des 14 pièges du spike en tests | `tests/kernel/pièges.spec.ts` | 14/14 passent et documentent les contournements |

### Lot 1 — Esquisse 2D complète (12 j) 🎯

| Tâches | Critères d'acceptation |
|---|---|
| Canvas Konva : grille, origine, zoom/pan, aimantation, sélection multiple, prévisualisation de création | 10 000 entités à 60 fps |
| Outils : ligne, polyligne, rectangle (3 modes), cercle (4 modes), arc (3 modes), ellipse + arc d'ellipse, spline, polygone, rainure, point, texte | chaque outil conforme au comportement SolidWorks (clic-clic, clic-glissé, Échap, double-clic) |
| Contraintes : coïncidence, H/V, parallèle, perpendiculaire, tangente, concentrique, égalité, symétrie, milieu, colinéaire, fixe + **cotes** (distance, longueur, rayon, diamètre, angle, distance point-ligne) pilotées et de référence | solveur < 5 ms ; couleurs : bleu = sous-contraint, noir = entièrement contraint ; conflits surlignés en rouge |
| Inférence automatique + accrochages + cotation intelligente (D) | 0 contrainte involontaire non annulable (Ctrl+Z) |
| Outils d'édition : déplacer, copier, rotation, échelle, symétrie, répétition, décalage, rognage, prolongation, congé/chanfrein d'esquisse, convertir des entités | cycle de travail sans quitter l'esquisse |
| Esquisse sur plan de base, plan décalé/angulaire, **face de solide** | esquisse sur face → extrusion → coque fonctionnels |

### Lot 2 — Fonctions 3D cœur + arbre (18 j) 🎯

| Tâches | Critères d'acceptation |
|---|---|
| Builders : extrusion (tous modes d'aboutissement), révolution, coque, congés, chanfreins, perçage, symétrie, répétitions, booléens, scission | volume/bbox conformes au corpus doré ; < 300 ms par fonction simple |
| `topoRef.ts` v1 + lignage par builder | modification de cote → 100 % des sélections conservées sur le corpus de base |
| FeatureManager : arbre, renommage, glisser-déposer, compression, suppression, édition (double-clic), rejeu, indicateurs erreur/avertissement | toute fonction ré-éditable sans perte |
| PropertyManager piloté par schéma (`FeatureTypeRegistry`) | ajouter un type de fonction = 1 fichier de déclaration + 1 builder |
| Aperçu en direct + validation ✓/annuler ✗ + annulation par Échap | aucune modification du document avant validation |
| Configurations v1 (valeurs + compression) | basculer entre 2 configurations sans recharger |

### Lot 3 — Robustesse, édition et confort « SolidWorks » (12 j)

| Tâches | Critères d'acceptation |
|---|---|
| Détection/restauration d'erreurs, journal de reconstruction, diagnostic détaillé par fonction | un document cassé est réparable à la main |
| Pré-sélection, filtres de sélection, sélection par boîte/assoit, sélection avancée (arêtes tangentes, faces coplanaires…) | conforme aux habitudes SW |
| Équations et paramètres globaux, cotes pilotées par formule | « D1 = 2*epaisseur » fonctionne |
| Annuler/rétablir global (commandes transactionnelles), copier/coller de fonction, duplication | Ctrl+Z/Ctrl+Y sur 100 actions |
| Mesures, propriétés de masse, section dynamique, styles d'affichage, matériaux | exports et affichage conformes |
| Sauvegarde locale + autosave + reprise de session + fichiers `.cao3.json` | fermeture brutale → aucun travail perdu + restauration |
| Import STEP/STL et export STEP/STL/OBJ/3MF | fichier STEP ré-importable par SolidWorks/FreeCAD |

### Lot 4 — Mise en plan (10 j)

| Tâches | Critères d'acceptation |
|---|---|
| Feuille de plan (formats A4→A1, cartouche), vues projetées/auxiliaire/iso/coupe/détail (via `drawProjection`), arêtes cachées en pointillés | vue de face + coupe d'une pièce réelle |
| Cotation et annotations sur la vue (linéaire, angulaire, rayon, diamètre, filetage, note, symbole), style de cotation | cotes accrochées à la géométrie projetée (mise à jour après modification du modèle) |
| Export PDF, DXF, SVG, impression | PDF vectoriel propre, DXF ouvert dans un lecteur standard |

### Lot 5 — Assemblage (15 j)

| Tâches | Critères d'acceptation |
|---|---|
| Modèle d'assemblage, instances multiples, sous-assemblages, apparences | 50 instances fluides |
| Contraintes : coïncidence, parallélisme, perpendicularité, concentrique, tangente, distance, angle, verrou ; solveur (projection itérative + jacobien analytique) | assemblages classiques (glissière, pivot, rotule) corrects, ré-ouvert après modification d'une pièce |
| Détection d'interférences, contrôle de distance, nomenclature BOM (avec masse/volume) | rapport exportable CSV |
| Édition en contexte (ouvrir une pièce depuis l'assemblage, revenir) | sans perte de contraintes |

### Lot 6 — Persistance serveur & partage (8 j, optionnel)

| Tâches | Critères d'acceptation |
|---|---|
| Réutilisation du backend Django existant : comptes, projets, versions, partage en lecture, matériothèque | aucune donnée géométrique calculée côté serveur |
| Lien d'export/partage d'une vue 3D (STEP + capture + JSON du document) | lien ouvrable sans compte (option) |

### Lot 7 — Performance, qualité, industrialisation (continu, 15 j étalés)

| Tâches | Critères d'acceptation |
|---|---|
| Pool de workers + build WASM `multi` (threads) derrière un flag `COOP/COEP` | rebuild 2× plus rapide sur gros modèles |
| Checkpoints disque, cache de tessellation, LOD, `InstancedMesh` | ouverture d'un document 50 fonctions < 2 s |
| Monitoring : durée par fonction, mémoire OC, taux d'erreur, taille de document ; auto-redémarrage worker à la dérive mémoire | aucun crash de session sur une journée de travail |
| Accessibilité, i18n FR/EN, onboarding, tutoriels intégrés, jeux d'exemples | parcours « premier cube » < 2 min sans aide |

**Jalons**

| Jalon | Contenu | Durée cumulée |
|---|---|---|
| **M1 — Démo interne** | Lots 0+1 : esquisse contrainte → extrusion | ~3,5 sem. |
| **M2 — MVP utilisable** | + Lot 2 : pièce paramétrique complète, arbre, export STEP/STL | ~8 sem. |
| **M3 — Bêta « SolidWorks-like »** | + Lots 3+4 : robustesse, configurations, mise en plan | ~13 sem. |
| **M4 — CAO d'ensemble** | + Lot 5 : assemblages + BOM | ~16 sem. |
| **M5 — Produit** | + Lots 6+7 : comptes, partage, performances, i18n | ~20 sem. |

---

## 8. Stratégie de performance (chiffrée d'après le spike)

| Levier | Cible | Mise en œuvre |
|---|---|---|
| Chargement du noyau | 1ʳᵉ interaction < 1,5 s après ouverture | Chargement paresseux + streaming WASM + `CacheStorage` (6,9 Mo gzip à mettre en cache une fois) ; écran de progression ; démo « bac à sable » sans noyau pour la page d'accueil |
| Rebuild d'une pièce | < 1 s pour 30 fonctions | Checkpoints par fonction, rejeu du seul sous-arbre *sale*, tessellation incrémentale |
| Interaction cote | 60 fps visuel, 15 reconstructions/s max | Debounce, qualité *preview*, annulation des RPC obsolètes |
| Répétitions massives | < 1 s pour 200 perçages | **Un seul booléen** sur compound + checkpoint avant/après + avertissement au-delà de 500 instances |
| Tessellation | preview 0,2/0,6 · final 0,05/0,3 · mesure 0,01/0,1 | Budget par fonction ; passe finale en tâche de fond |
| Sélection | < 16 ms | `faceId`/`edgeId` mappés directement dans les `faceGroups`/`edgeGroups` (pas de requête OC pour un survol) |
| Mémoire | aucun crash sur 2 h de session | `delete()` explicite des formes intermédiaires, compteur d'objets OC, redémarrage du worker au-delà du seuil, monitor visible dans la barre d'état |
| Parallélisme | rebuild + solveur + I/O concurrents | Pool de workers : 1 noyau par document, 1 solveur, 1 I/O |

---

## 9. Qualité, tests et non-régression

| Niveau | Outil | Contenu | Seuil de sortie |
|---|---|---|---|
| Corpus géométrique doré | Vitest + worker | Pour chaque fonction : volume, bbox, nombre de faces/arêtes, aire — valeurs figées et **revues comme du code** | 100 % des cas |
| Pièges du noyau | Vitest | 14 tests issus du spike (chacun documente le contournement) | 100 % |
| Stabilité de la nomenclature topologique | Vitest | 20 scénarios de modification ; taux de conservation des sélections | ≥ 95 % |
| Solveur d'esquisse | Vitest | Exactitude (rectangle 40×25 exact), détection de conflits, temps de solve | 100 % + < 5 ms |
| RPC noyau | Vitest | Annulation, erreurs, redémarrage worker, sérialisation | 100 % |
| Parcours utilisateur | Playwright | « Nouvelle pièce → esquisse cotée → bossage → perçage → export STEP » ; « import STEP → mesure → export PDF » | 100 % en CI |
| Budgets de performance | Playwright + `performance.mark` | Rebuild, ouverture, tessellation | Non-régression > 20 % = échec |
| Exploration (fuzzing léger) | Script | Paramètres aléatoires réalistes sur un document modèle → détecter erreurs/warnings | Aucune exception non capturée |

**Définition de « terminé »** pour une commande : implémentée, testée (unitaire + corpus), annulable (Ctrl+Z), traduite FR/EN, présente dans le ruban avec icône/infobulle/raccourci, documentée dans le SPEC, mesurée (durée affichée), et fonctionnelle sur 3 scénarios d'usage réels.

---

## 10. Risques et parades

| Risque | Prob. | Impact | Parade |
|---|---|---|---|
| Nomenclature topologique imparfaite → sélections perdues | Élevée | Élevé | Lignage par builder (déterministe) + signatures + avertissements explicites + tests dédiés ; jamais de plantage |
| Exceptions WASM / état corrompu | Élevée | Élevé | `compat.ts` + worker *dirty* + rejeu + journal ; le document reste sain (il est en JSON) |
| Lenteur sur modèles complexes | Moyenne | Élevé | Checkpoints, booléens groupés, preview maillée, budgets et avertissements, WASM multi-thread |
| WASM 6,9 Mo / 1ʳᵉ ouverture | Certaine | Moyen | Cache, streaming, chargement paresseux, message de progression ; possibilité d'un build OC réduit (compilation Emscripten ciblée) en v2 |
| `replicad` (1 mainteneur) peut régresser | Moyenne | Moyen | Nos tests épinglent les versions ; `compat.ts` isole l'API ; possibilité d'appeler OC directement via `getOC()` |
| Licences LGPL (OC wasm, planegcs) | Certaine | Moyen | WASM en fichiers séparés remplaçables, sources et notices fournies, revue juridique avant commercialisation |
| Périmètre « SolidWorks » infini | Certaine | Élevé | Feuille de route par lots, fonctions hors périmètre grisées, mesure du taux de couverture fonctionnelle |
| Attentes de rendu « comme SolidWorks » | Moyenne | Moyen | Vocabulaire visuel sobre, arêtes de silhouette, ombres douces, styles d'affichage, thème sombre identique à l'écosystème industriel |

---

## 11. Indicateurs de succès (à suivre dès le lot 0)

| Indicateur | Cible v1 (M3) |
|---|---|
| Taux de couverture fonctionnelle du SPEC (commandes disponibles / listées) | ≥ 85 % (les 15 % restants = hors périmètre assumé, grisés) |
| Temps « premier cube » (utilisateur novice, sans aide) | < 2 min |
| Temps de rebuild — pièce 20 fonctions | < 700 ms |
| Conservation des sélections après changement de cote | ≥ 95 % |
| Crashs de session / 8 h | 0 (worker relancé sans perte de document) |
| Aller-retour STEP | pièce exportée → lue par FreeCAD/SolidWorks sans erreur |
| Satisfaction « ressenti CAO » (test interne à l'aveugle vs SolidWorks) | ≥ 4/5 sur les gestes d'esquisse et de congé |

---

## 12. Décisions à valider (avant le lot 0)

1. **Faire évoluer `cao_frontend` (Vue existant) plutôt que créer une application neuve** — on conserve l'authentification, les pages projet et l'outillage, et on remplace le noyau (VTK/backend CadQuery) par replicad. *(Recommandé)*
2. **Statut du backend Django existant** : le réduire à « comptes + projets + versions + partage » (aucun calcul géométrique) ou le sortir du dépôt. *(Recommandé : le réduire, lot 6)*
3. **Langue de l'interface** : FR par défaut + EN, ou EN par défaut + FR ? *(Recommandé : FR par défaut, i18n dès le lot 1)*
4. **Priorité du MVP** : pièces mécaniques + mise en plan avant assemblages, ou assemblages avant mise en plan ? *(Recommandé : Lots 0→3, puis 4, puis 5)*
5. **Licence et diffusion** : usage privé/interne, open source, ou produit commercial ? (impacte la revue LGPL et le choix d'un build OC réduit)

---

## 13. Annexe — Correspondance « gestes SolidWorks » / implémentation (extrait)

| Geste SolidWorks | Réflexe attendu dans l'app |
|---|---|
| Clic sur une face + Démarrer une esquisse | `sketchOnFace` + orientation automatique de la caméra (± normale) ; mise à jour du plan si la face bouge (TopoRef) |
| Ctrl+clic pour multi-sélectionner arêtes/faces | multi-sélection + filtres de sélection (barre dédiée) |
| Tab / glisser pour inverser la direction d'extrusion | poignée de direction + touche `Tab` + saisie de valeur au clavier |
| Touche `D` pour coter, `S` pour la barre de raccourcis | `dimTool` magnétique + palette de commandes |
| Double-clic sur une fonction pour l'éditer | PropertyManager pré-rempli, « reconstruire » immédiat, ✔/✗ |
| Barre d'espace : vue isométrique / normale au plan | raccourcis caméra normalisés (0–9 + barre d'espace) |
| Icône « en erreur » dans l'arbre | `featureStates` : erreur (rouge) / avertissement (jaune) + infobulle expliquant la cause et la remédiation |
| « Reconstruire » (Ctrl+B) | bouton dédié dans la barre d'état avec durée et journal |
