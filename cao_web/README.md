# 🛠️ CAO3 Web — application de CAO paramétrique dans le navigateur

Application autonome (aucun serveur de calcul) construite sur **OpenCascade WASM via [replicad](https://replicad.xyz)**,
avec une interface de type SolidWorks : rubans, arbre de construction (FeatureManager),
panneau de commande contextuel (PropertyManager) et barre d'état.

* **Plan et feuille de route** : [`../PLAN_CAO_REPLICAD.md`](../PLAN_CAO_REPLICAD.md)
* **Spécification des rubans (169 commandes)** : [`../SPEC_RUBANS_FONCTIONS.md`](../SPEC_RUBANS_FONCTIONS.md)
* **Constats noyau vérifiés + pièges** : [`../SPIKE_REPLICAD_FINDINGS.md`](../SPIKE_REPLICAD_FINDINGS.md)
* **Performances et mémoire navigateur** : [`../PERFORMANCES_NAVIGATEUR.md`](../PERFORMANCES_NAVIGATEUR.md)
* **Journal des décisions (ADR)** : [`DECISIONS.md`](DECISIONS.md)

---

## Démarrage (en local)

### Prérequis

| Élément | Exigence | Vérification |
|---|---|---|
| **Node.js** | **20.19+** ou **22.12+** (exigence de Vite 7 ; développement et tests faits en 22.22) | `node -v` |
| npm | 10+ | `npm -v` |
| Navigateur | Chrome / Edge / Firefox / Safari récents (WebGL 2, WebAssembly, Web Workers modules, IndexedDB) | — |

Aucun backend, aucune base de données, aucun compte, aucune clé d'API. Node n'est utilisé que pour
construire et servir les fichiers ; **rien ne s'exécute côté serveur**.

### Les commandes

```bash
git clone https://github.com/tiffank1802/CAO3.git
cd CAO3
git checkout arena/d139f6fc-cao3      # branche de travail (le lot 0+1 est dans la PR #1, pas encore sur main)

cd cao_web
npm install                           # ~200 Mo dans node_modules, aucun script de post-installation
npm run dev                           # → http://localhost:5173
```

C'est tout : l'application s'ouvre sur une pièce vide, avec le bouton **« Charger la pièce de démonstration »**
dans l'arbre (ou *Fichier → Pièce de démonstration*) pour voir immédiatement une esquisse contrainte et un bossage.

### Les autres scripts

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | Serveur de développement avec rechargement à chaud. Les WASM sont servis **depuis `node_modules`** (aucune copie, aucun script de synchronisation). |
| `npm test` | 33 tests : 19 noyau (Node, mêmes chemins de code que le worker), 3 stockage (IndexedDB en mémoire), 11 interface (jsdom). ~4 s. |
| `npm run typecheck` | `vue-tsc --noEmit`, aucun avertissement toléré. |
| `npm run build` | Bundle de production dans `dist/` (WASM émis en assets hachés pour un cache long). |
| `npm run preview` | Sert `dist/` comme le ferait un hébergeur — utile pour tester le build avant déploiement. |

### À savoir au premier lancement

* **22,9 Mo de WebAssembly** (OpenCascade) sont téléchargés **en local** au premier chargement, avec une
  barre de progression réelle. Ensuite tout est en cache : plus aucune attente réseau.
* `npm install` nécessite Internet **une fois** (registry npm). Après, l'application fonctionne **hors-ligne**,
  à l'exception du Service Worker qui reste au lot 3.
* Le document est conservé automatiquement dans **IndexedDB** (profil du navigateur) : fermer l'onglet ou
  recharger la page ne perd rien. *Fichier → Documents locaux* permet de lister, rouvrir ou supprimer.
* Le nœud du port : 5173 par défaut ; s'il est occupé, Vite en choisit un autre et l'affiche au démarrage.

### En cas de problème

| Symptôme | Cause probable / solution |
|---|---|
| Au lancement de Vite : `crypto.hash is not a function`, ou message `EBADENGINE` | Node trop ancien → installer **20.19+** ou **22.12+** (un `.nvmrc` est fourni : `nvm use`). |
| `Failed to resolve import "replicad-opencascadejs/wasm?url"` | `npm install` incomplet → relancer `npm install` (le WASM vit dans `node_modules`). |
| La barre de chargement du noyau reste à 0 % | Le réseau ou un proxy intercepte le flux. Le worker retombe automatiquement sur un téléchargement direct ; si cela persiste, vérifier qu'aucun bloqueur ne coupe les requêtes vers des fichiers `.wasm`. |
| Page blanche dans la zone 3D | WebGL indisponible (pilote, machine virtuelle). Vérifier `chrome://gpu` ; l'esquisse 2D (Konva) fonctionne indépendamment. |
| `Port 5173 is in use` | Rien à faire : Vite change de port sans échouer (`strictPort: false`). |
| Déploiement derrière nginx/Apache : « `WebAssembly.instantiateStreaming failed` » | Le serveur doit servir les `.wasm` avec le type MIME **`application/wasm`** et autoriser les fichiers de ~23 Mo. |
| Mémoire du navigateur qui grimpe | *Outils → Diagnostic du noyau → Libérer la mémoire* (ou le bandeau orange). Voir [`../PERFORMANCES_NAVIGATEUR.md`](../PERFORMANCES_NAVIGATEUR.md) §4. |
| Repartir de zéro | *Fichier → Nouveau*, puis *Documents locaux → supprimer* ; ou vider le stockage du site dans le navigateur. |

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
| **Premier contact** | ✅ « Fichier → Pièce de démonstration » (ou le bouton de l'arbre vide) charge une esquisse entièrement contrainte 80 × 50 et son bossage de 20 mm, prête à être modifiée |
| **Échange de données** | ✅ export STEP et STL, document `.cao3.json` (enregistrer / ouvrir) |
| **Persistance locale** | ✅ **IndexedDB** : sauvegarde automatique, reprise de session au démarrage, écran « Documents locaux » (lister / ouvrir / supprimer) — aucune donnée n'est envoyée sur le réseau |
| **Ne pas saturer le navigateur** | ✅ progression réelle du téléchargement du noyau, LOD de tessellation (aperçu / final), plafond de 400 k triangles, alerte mémoire à 900 Mo, chien de garde de 20 s, action « Libérer la mémoire » (voir [`../PERFORMANCES_NAVIGATEUR.md`](../PERFORMANCES_NAVIGATEUR.md)) |
| **Diagnostic** | ✅ « Outils → Diagnostic du noyau » : état du worker, avertissements, erreurs, redémarrage |

### Raccourcis clavier

| Touche | Action |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Rétablir |
| `Ctrl+S` | Enregistrer le document (`.cao3.json`) |
| — | *Fichier → Enregistrer en local* : copie du document dans IndexedDB (automatique après chaque modification également) |
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
│  └─ io/          download.ts · storage.ts (IndexedDB : documents locaux)
├─ App.vue         assemblage de l'écran + registre de commandes + raccourcis
└─ main.ts
tests/kernel.spec.ts   → 19 tests du noyau : pièges, esquisse→extrusion, export STEP, solveur, mémoire, budget de rendu
tests/app.spec.ts      → 11 tests d'interface : rubans, panneaux, raccourcis, câblage des commandes, mémoire, IndexedDB
tests/storage.spec.ts  → 3 tests du stockage local (IndexedDB) et de sa dégradation propre
```

**Principes appliqués** (voir `PLAN_CAO_REPLICAD.md` §2) : le document JSON est la vérité, la géométrie est un cache ;
le noyau vit dans un worker ; aucun `hashCode` persisté ; chaque fonction produit un état (OK/avertissement/erreur) ;
le maillage est jetable ; toute commande est annulable.

---

## Vérifications automatisées

| Suite | Environnement | Contenu |
|---|---|---|
| `tests/storage.spec.ts` | Node + `fake-indexeddb` | Stockage local : enregistrement, relecture, liste ordonnée, suppression, et **dégradation propre** quand IndexedDB est refusé (navigation privée, quota). |
| `tests/kernel.spec.ts` | Node | Le noyau OpenCascade s'exécute dans Node exactement comme dans le worker : pièges vérifiés (boîte à deux coins, intersection native, récupération après exception), chaîne esquisse → extrusion → tessellation, erreur de fonction non fatale, export STEP, solveur planegcs (degrés de liberté, conflits), **tas WASM stable sur 30 reconstructions**, budget de rendu (triangles et durées). |
| `tests/app.spec.ts` | jsdom | Montage réel de l'écran : 8 onglets, convention « visible mais désactivé », ouverture/validation/annulation d'une esquisse, câblage du bossage, annuler/rétablir, enregistrement `.cao3.json`, styles et vues, pièce de démonstration, **et vérification que chaque commande livrée du ruban est traitée** (aucune commande « non disponible »). |

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
