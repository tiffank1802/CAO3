# 🛠️ CAO3 Web — application de CAO paramétrique dans le navigateur

Application autonome (aucun serveur de calcul) construite sur **OpenCascade WASM via [replicad](https://replicad.xyz)**,
avec une interface de type SolidWorks : rubans, arbre de construction (FeatureManager),
panneau de commande contextuel (PropertyManager) et barre d'état.

* **Plan et feuille de route** : [`../PLAN_CAO_REPLICAD.md`](../PLAN_CAO_REPLICAD.md)
* **Spécification des rubans (169 commandes)** : [`../SPEC_RUBANS_FONCTIONS.md`](../SPEC_RUBANS_FONCTIONS.md)
* **Constats noyau vérifiés + pièges** : [`../SPIKE_REPLICAD_FINDINGS.md`](../SPIKE_REPLICAD_FINDINGS.md)

---

## Démarrage

```bash
cd cao_web
npm install          # récupère replicad, planegcs, three, konva, vue
npm run dev          # http://localhost:5173
npm test             # 22 tests : 16 noyau (Node) + 6 interface (jsdom)
npm run typecheck    # vue-tsc
npm run build        # bundle de production (WASM émis en assets hachés)
```

> Le premier chargement télécharge ~7 Mo de WASM (OpenCascade). Ensuite tout est local :
> aucune donnée ne quitte la machine, aucun backend n'est nécessaire.

---

## Ce qui fonctionne aujourd'hui (Lot 0 + 1ʳᵉ tranche du Lot 1)

| Domaine | État |
|---|---|
| **Noyau dans un Web Worker** | ✅ init OpenCascade, RPC typé, transfert des buffers (zero-copy), annulation des reconstructions obsolètes, redémarrage à la demande |
| **Couche de compatibilité** | ✅ `compat.ts` : `loftSafe`, `boxSafe`, `cutMany`, `fuseOrCompound`, `intersectSafe`, facteurs de dépouille — les pièges du noyau sont isolés en un seul endroit |
| **Moteur de reconstruction** | ✅ arbre de fonctions rejoué, état par fonction (OK / avertissement / erreur), validation (`volume > 0`, boîte englobante, nombre de faces), timings |
| **Esquisse 2D** | ✅ rectangle **par centre** et **par 2 coins**, cercle (centre-rayon), ligne ; accrochage grille + points existants ; contraintes implicites (H/V, symétrie, coïncidences) ; **cotation** (clic sur une arête, un cercle ou deux points) et édition des cotes ; glisser un point ou un rayon |
| **Solveur de contraintes** | ✅ planegcs dans un **worker dédié** : résolution exacte, `dof()` → statut « entièrement contraint », conflits signalés par identifiant et surlignés |
| **Fonctions 3D** | ✅ bossage extrudé (profondeur, sens, mode corps / enlèvement de matière) |
| **Vue 3D** | ✅ three.js : styles (ombré + arêtes / ombré / filaire / transparence), vues standard, pré-sélection orange et sélection verte des faces et arêtes via `faceGroups`/`edgeGroups` |
| **Interface** | ✅ rubans (Fichier, Esquisse, Fonctions, Assemblage, Mise en plan, Évaluation, Affichage, Outils), arbre avec compression/renommage/suppression, panneau de propriétés, barre d'état (noyau, solveur, durée de reconstruction, volume, triangles), historique Annuler/Rétablir |
| **Échange de données** | ✅ export STEP et STL, document `.cao3.json` (enregistrer / ouvrir) |
| **Diagnostic** | ✅ « Outils → Diagnostic du noyau » : état du worker, avertissements, erreurs, redémarrage |

### Raccourcis clavier

| Touche | Action |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Rétablir |
| `Ctrl+S` | Enregistrer le document (`.cao3.json`) |
| `Ctrl+B` | Reconstruire |
| `D` | Cotation intelligente (en esquisse) |
| `L` / `R` / `C` | Ligne / Rectangle par centre / Cercle (en esquisse) |
| `S` | Outil sélection |
| `Suppr` | Supprimer l'entité ou le point sélectionné |
| `Échap` | Annuler la commande / revenir à la sélection |
| `Entrée` | Valider la commande en cours (✔) |
| `Espace` | Basculer isométrique ↔ face |
| `F` | Zoom étendu |

### Ce qui est volontairement grisé (lots suivants du plan)

Arcs et ellipses d'esquisse, boîte de relations complète, congés/chanfreins/coque/répétitions/perçages (lot 2),
import STEP, mesures et propriétés de masse, configurations, équations (lot 3), mise en plan (lot 4),
assemblages (lot 5). Les commandes restent **visibles avec une infobulle indiquant le lot** — convention décrite
dans `SPEC_RUBANS_FONCTIONS.md` §14.

---

## Architecture du code

```
src/
├─ cad/
│  ├─ core/        document.ts · registry.ts · documentStore.ts (Pinia) · ids.ts   → modèle documentaire (source de vérité)
│  ├─ kernel/      worker.ts · client.ts · rebuild.ts · compat.ts · validate.ts
│  │               tessellate.ts · solve.ts · solver.worker.ts · builders/         → tout ce qui parle à OpenCascade
│  ├─ sketch/      model.ts                                                        → fabrique d'entités + contraintes implicites
│  ├─ view/        viewer.ts                                                       → three.js, picking face/arête
│  ├─ ui/          RibbonBar · FeatureManager · PropertyManager · SketchCanvas · StatusBar · Icon
│  │               ribbonDefs.ts                                                   → la carte des rubans
│  └─ io/          download.ts
├─ App.vue         assemblage de l'écran + registre de commandes + raccourcis
└─ main.ts
tests/kernel.spec.ts   → 16 tests du noyau : pièges, esquisse→extrusion, export STEP, solveur
tests/app.spec.ts      → 6 tests d'interface : rubans, panneaux, raccourcis, câblage des commandes
```

**Principes appliqués** (voir `PLAN_CAO_REPLICAD.md` §2) : le document JSON est la vérité, la géométrie est un cache ;
le noyau vit dans un worker ; aucun `hashCode` persisté ; chaque fonction produit un état (OK/avertissement/erreur) ;
le maillage est jetable ; toute commande est annulable.

---

## Vérifications automatisées

| Suite | Environnement | Contenu |
|---|---|---|
| `tests/kernel.spec.ts` | Node | Le noyau OpenCascade s'exécute dans Node exactement comme dans le worker : pièges vérifiés (boîte à deux coins, intersection native, récupération après exception), chaîne esquisse → extrusion → tessellation, erreur de fonction non fatale, export STEP, solveur planegcs (degrés de liberté, conflits). |
| `tests/app.spec.ts` | jsdom | Montage réel de l'écran : 8 onglets, convention « visible mais désactivé », ouverture/validation/annulation d'une esquisse, câblage du bossage, annuler/rétablir, enregistrement `.cao3.json`, styles et vues, **et vérification que chaque commande livrée du ruban est traitée** (aucune commande « non disponible »). |

> Ce test d'interface a immédiatement trouvé un défaut réel : les raccourcis clavier étaient définis mais **jamais enregistrés** (aucune touche ne fonctionnait). Corrigé dans `App.vue`.

---

## Prochaine tranche (suite du Lot 1 puis Lot 2)

1. **Esquisse** : arcs (centre, 3 points, tangent), ellipses, splines, rainure, rognage/prolongation, décalage,
   symétrie et répétition d'entités, `convertir des entités`, boîte de relations complet (tangente, parallèle,
   perpendiculaire, égalité, milieu, colinéaire), cotation multiple.
2. **Fonctions 3D** : congés (dont variable par arête), chanfreins, coque, révolution, lissage, balayage, nervure,
   dépouille, symétrie, répétitions (un seul booléen sur compound), assistant de perçage.
3. **Robustesse** : `topoRef.ts` (références topologiques persistantes : le congé suit sa face même quand une cote change).
4. **Lot 3** : import STEP, mesures et propriétés de masse, configurations, équations, section dynamique.
