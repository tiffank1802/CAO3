# 🎛️ Spécification des rubans et des commandes — CAO web « type SolidWorks »

**Version** : 1.0 · **Date** : 2026-10-14 · Compagnon de **[PLAN_CAO_REPLICAD.md](PLAN_CAO_REPLICAD.md)** et **[SPIKE_REPLICAD_FINDINGS.md](SPIKE_REPLICAD_FINDINGS.md)**

Légende de disponibilité : ✅ **v1 (lots 0–5)** · 🟡 **v1.5** · ⛔ **hors périmètre v1 (commande visible mais désactivée + infobulle « v2 »)** · ⚠️ **nécessite un contournement vérifié** (voir spike §3)

---

## 1. Anatomie de l'écran

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Fichier][Esquisse][Fonctions][Assemblage][Mise en plan][Évaluation][Affichage][Rendu][Outils][Aide]
├────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────────────────────────────────┐  ┌──────────────────┐   │
│  │ Feature     │  │                                              │  │ PropertyManager  │   │
│  │ Manager     │  │             VUE 3D  (three.js)               │  │  (commande       │   │
│  │             │  │   pré-sélection, triade, coupes, mesures     │  │   en cours)      │   │
│  │ ▸ Support   │  │                                              │  │  ┌────────────┐  │   │
│  │   Esquisse1 │  │        ou  CANVAS D'ESQUISSE (Konva)         │  │  │ paramètres │  │   │
│  │   Bossage1  │  │   entités + cotes + contraintes + statut     │  │  │ ✔ Annuler  │  │   │
│  │   Congé1 ⚠️ │  │                                              │  │  └────────────┘  │   │
│  │   Perçage1  │  │                                              │  │  Matériaux       │   │
│  └─────────────┘  └──────────────────────────────────────────────┘  └──────────────────┘   │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Barre de sélection │ Unités : mm │ Esquisse : entièrement contrainte (6/6) │ Rebuild : 214 ms │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Éléments permanents**

| Zone | Rôle | Détails d'implémentation |
|---|---|---|
| **Ruban** | Commandes regroupées par onglet, regroupées en « groupes » avec séparateurs | `Ribbon.vue` + table de définitions `ribbon/<tab>.ts` — chaque commande = `{ id, labelKey, icon, shortcut, when, run() }` |
| **FeatureManager** | Arbre de construction | Glisser-déposer, renommage F2, compression (clic droit), indicateurs ✅/⚠️/❌, barre de rejeu, double-clic = édition, menu contextuel complet |
| **PropertyManager** | Panneau de commande contextuel (à gauche, comme SolidWorks) | Généré depuis `FeatureTypeRegistry` : champs, unités, sélecteurs de faces/arêtes, cases d'option, aperçu en direct, boutons **✔ (valider)** / **✗ (annuler)** |
| **Vue 3D / Canvas 2D** | Espace de travail, bascule automatique en mode esquisse | Vue 3D : styles d'affichage, section, mesures ; Canvas : grille, origine rouge/vert, cotes, contraintes |
| **Barre d'état** | Unités, statut du solveur d'esquisse, statut du rebuild, mémoire, coordonnées | Clique = panneaux détaillés (journal de reconstruction, conflits de contraintes) |
| **Recherche de commande** | Touche **S** (barre de raccourcis) et **Ctrl+K** (palette) | Recherche FR/EN par libellé, synonyme et nom SolidWorks (« bossage », « extrude », « hole wizard ») |

**Conventions d'interaction (héritées de SolidWorks)**

* **Pré-sélection** : survol = surbrillance orange des arêtes, face transparente + normale affichée pour les faces ; clic = sélection (vert).
* **Filtres de sélection** dans la barre d'état : faces / arêtes / sommets / corps / esquisses.
* **Ctrl+clic** = ajout/retrait de la sélection · **Maj+clic** = sélection multiple.
* **Échap** : annule l'opération en cours ; **Ctrl+Z / Ctrl+Y** : annuler/rétablir global.
* **Tab** : inverse la direction d'une extrusion/révolution ; saisie directe d'une cote à l'écran.
* **Double-clic sur une fonction** : édition ; **double-clic sur une cote** : modification ; **glisser une cote** : modification en direct avec reconstruction.
* **Menu contextuel** (clic droit) : dépend de la sélection (comme SW) — « Démarrer une esquisse », « Cotter », « Ajouter une contrainte », « Insérer une fonction ▸ », « Zoom sur la sélection », « Propriétés ».
* **Gestes souris** (v1.5) : 4 gestes configurables (extrusion, congé, chanfrein, esquisse).

---

## 2. Onglet **Fichier**

| Groupe | Commande (FR) | Équivalent SW | Implémentation | Statut |
|---|---|---|---|---|
| Nouveau | Nouvelle pièce / Nouvel assemblage / Nouvelle mise en plan | New ▾ | Création de document vide typé | ✅ |
| Ouvrir | Ouvrir… (`.cao3.json`) | Open | `documentFile.ts` + IndexedDB (récents) | ✅ |
| Importer | Importer STEP | Open → STEP | `await R.importSTEP(file)` | ✅ |
| Importer | Importer STL / maillage | — | `R.importSTL`, `R.importSTLAsMesh` (corps maillé, marqué « non paramétrique ») | ✅ |
| Enregistrer | Enregistrer / Enregistrer sous | Save / Save As | Autosave IndexedDB + export fichier | ✅ |
| Exporter | Export STEP | Save As STEP | `blobSTEP()` | ✅ |
| Exporter | Export STL (binaire/ASCII) | Save As STL | `blobSTL({binary})` + facteur d'échelle | ✅ |
| Exporter | Export OBJ / 3MF | — | Écriture depuis la tessellation (module I/O) | ✅ |
| Exporter | Export DXF / PDF / SVG (mise en plan) | Save As DWG/PDF | Module mise en plan | ✅ |
| Exporter | Capture d'écran (PNG) | Screen capture | `renderer.domElement.toBlob()` | ✅ |
| Propriétés | Propriétés du document (unités, précision, matériau par défaut, nom, auteur) | Document Properties | Boîte de dialogue | ✅ |
| Version | Historique local (30 versions), restaurer | — | Snapshots IndexedDB | 🟡 |
| Impression | Imprimer la vue / la mise en plan | Print | Rendu feuille → PDF | ✅ |

---

## 3. Onglet **Esquisse** (actif uniquement en mode esquisse)

### 3.1 Entités

| Commande | Modes / variantes | Implémentation | Statut |
|---|---|---|---|
| Ligne | chaînée (polyligne), simple | `DrawingPen.lineTo` | ✅ |
| Rectangle | **Centre**, **À partir des bords (2 coins)**, **3 points (avec angle)**, **Parallélogramme** | `drawRectangle`, variante orientée | ✅ |
| Cercle | **Centre-rayon**, **Périmètre**, **2 points**, **3 points** | `drawCircle` + construction | ✅ |
| Arc | **Centre**, **3 points**, **Tangent**, **Arc de périmètre** | `threePointsArcTo`, `tangentArcTo`, construction | ✅ |
| Ellipse | **Centre**, **Arc d'ellipse** | `drawEllipse`, `ellipseTo` | ✅ |
| Spline | Spline (points d'inflexion), **Spline de style**, Courbe passant par des points | `smoothSplineTo`, `drawPointsInterpolation` | ✅ |
| Polyligne | segments + arcs | `lineTo` + `threePointsArcTo` | ✅ |
| Polygone | n côtés, inscrit/circonscrit | `drawPolysides` | ✅ |
| Rainure / oblong | **droite**, **arc**, **arc-arc** | 2 demi-cercles + segments | 🟡 |
| Point | point de construction | primitive de construction | ✅ |
| Texte | texte gravé/extrudé (police embarquée) | `R.loadFont(ttf)`, `R.sketchText` | ✅ |
| Lignes/points de construction | bascule « pour construction » (sélection + X) | attribut `construction: true` | ✅ |

### 3.2 Contraintes et cotes (solveur `planegcs`)

| Commande | Types de contraintes | Statut |
|---|---|---|
| Ajouter une relation (poignée de contrainte) | Coïncidence, Colinéaire, Horizontal, Vertical, Parallèle, Perpendiculaire, Tangent, Concentrique, Égalité, Symétrie, Milieu, Fixe (géométrie figée), Fusionner des points | ✅ (`p2p_coincident`, `horizontal_l/pp`, `vertical_l/pp`, `parallel`, `perpendicular_ll`, `tangent_lc/cc/aa/ll`, `equal_length`, `equal_radius_*`, `p2p_symmetric_ppl`, `midpoint_on_line_*`) |
| Cotation intelligente (`D`) | Distance, Longueur, Rayon, Diamètre, Angle, Distance point-ligne, Distance ligne-ligne | ✅ |
| Cote pilote vs **de référence** (affichée entre parenthèses, non pilotante) | `driving: false` | ✅ |
| Cotes pilotées par équation (`= "D1"/2`) | Moteur d'expressions | ✅ |
| **Afficher/supprimer les relations**, supprimer plusieurs à la fois | Panneau latéral | ✅ |
| Statut d'esquisse | bleu = sous-contraint, noir = entièrement contraint, rouge = conflit/sur-contraint, jaune = redondance | ✅ (`SolveStatus` + `get_gcs_conflicting_constraints`) |
| Contraintes inférées automatiquement | H/V/coïncidence/alignement/tangence au survol | ✅ |
| Accrochages | grille, origine, points/arêtes/quadrants, sur arêtes du solide | ✅ |

### 3.3 Outils d'édition d'esquisse

| Commande | Statut | Notes |
|---|---|---|
| Rognage (Trim) / Prolongation (Extend) | ✅ | implémentation géométrique 2D maison (intersections analytiques) |
| Décalage d'entités (Offset) | ✅ **à construire** | ⚠️ `makeOffset` de replicad = offset de *Face 3D*, inutilisable ici → offset 2D maison (lignes/arcs) avec gestion des coins ouvert/fermé/parallèle |
| Convertir des entités (Projection d'arêtes du solide) | ✅ | `R.makeProjectedEdges` / projection analytique sur le plan d'esquisse |
| Symétrie d'entités · Copier/Rotation/Échelle · Répétition d'entités | ✅ | transformations de la couche esquisse |
| Congé / Chanfrein d'esquisse (coins) | ✅ | `DrawingPen.customCorner(r, mode)` (`fillet`, `chamfer`, `dogbone`) |
| Ajuster / Réparer l'esquisse | 🟡 | fermeture automatique des profils ouverts |
| Basculer en **esquisse 3D** | 🟡 | arcs et lignes dans l'espace, hors v1 |
| Quitter / Enregistrer l'esquisse | ✅ | quitter avec reconstruction aval |

---

## 4. Onglet **Fonctions** (Caractéristiques)

| Groupe | Commande | Référence SW | Détails / modes | Implémentation replicad | Statut |
|---|---|---|---|---|---|
| **Bossage/Base** | Bossage/Extrusion | Extruded Boss/Base | ✓ **Base** ✓ **Extruder** (ajout) ; aboutissement : Aveugle, Jusqu'au sommet, Jusqu'à la face, **À travers tout**, **Jusqu'au corps**, **Milieu du plan**, **Symétrique**, 2 directions ; **dépouille** (angle, vers l'extérieur/intérieur) ; **torsion** ; **décalage** de départ | `.extrude(h, {extrusionProfile, twistAngle, origin, extrusionDirection})` ⚠️ (`draft()` cassé → profil linéaire/loft) | ✅ |
| | Révolution | Revolved Boss/Base | axe (arête/axe/ligne de construction), angle, direction, révolution mince | `.revolve(axis, {origin, angle})` | ✅ |
| | Lissage | Lofted Boss/Base | sections multiples, guides, **réglé/lisse**, épaisseur mince, aboutissements | `sketch.loftWith([...], {ruled, startPoint, endPoint})` ⚠️ (jamais `R.loft`) | ✅ |
| | Balayage | Swept Boss/Base | profil + chemin (arête, spline, hélice) ; **avec contact**, torsion, chemin fermé | `sketch.sweepSketch(cb, {withContact, frenet})` | ✅ |
| | Nervure | Rib | épaisseur, extrusion dans 1/2 directions, bouchon | composition (extrusion mince + booleans) | ✅ |
| **Enlèvement de matière** | Enlèvement par extrusion | Extruded Cut | mêmes aboutissements que Bossage ; faces à enlever | idem Bossage en mode `cut` | ✅ |
| | Enlèvement par révolution / lissage / balayage | Revolved/Lofted/Swept Cut | idem | idem | ✅ |
| | **Assistant Perçage** | Hole Wizard | normes (ISO/ANSI), type : **alésage**, **lamage**, **fraisure**, **taraudage**, **filetage cosmétique**, **trou simple**, fond plat/conique ; taille ; perçage sur 1 ou plusieurs faces ; position par esquisse de points | cylindres/cônes/`genericSweep` + booléen groupé ; bibliothèque de paramètres ISO en JSON | ✅ (taraudage réel : 🟡 — v1 = cosmétique + filet symbolique) |
| **Modification** | Congés | Fillet | **constante**, **variable par arête** (callback), arêtes multiples, faces multiples, boucles, propagation tangentielle, rayon par sélection | `.fillet(r \| e => r, e => filtres)` ⚠️ (tableau de rayons cassé) | ✅ |
| | Chanfreins | Chamfer | constante, angle×distance, distance×distance | `.chamfer(...)` | ✅ |
| | Coque | Shell | épaisseur, faces enlevées, multisélection, épaisseur asymétrique 🟡, multicoque | `.shell(-t, f => filtre)` | ✅ |
| | Dépouille | Draft | face de dépouille, plan neutre, angle, face par face | `extrusionProfile` linéaire / `loftWith` ⚠️ (`draft()` cassé) | ✅ v1 sur bossage/révolution ; par face : 🟡 |
| | Décaler les faces / Épaissir | Move Face / Thicken | — | OC brut | 🟡 |
| **Corps** | Symétrie | Mirror | symétrie de **fonction**, de **face**, de **corps**, plan de symétrie (= plan/face/arête) | `.mirror(plane)` + rejeu inverse | ✅ |
| | Répétition linéaire | Linear Pattern | direction 1/2, instances, espacement, **instances à ignorer**, répétition de **fonctions** ou de **corps** | transformations + **un seul booléen sur compound** ⚠️ | ✅ |
| | Répétition circulaire | Circular Pattern | axe, angle, nombre, équidistant, orientation | idem | ✅ |
| | Répétition d'esquisse | Sketch Driven | points d'esquisse comme positions | idem | 🟡 |
| | Tableau (Table Pattern) | Table Driven | table XY/CSV | idem | 🟡 |
| | Fusionner / Soustraire / Intersecter | Combine | corps cibles + outils, résultat (ajout/enlèvement/commun) | `.fuse()`, `.cut()`, `A.cut(A.cut(B))` ⚠️ | ✅ |
| | Scission | Split | plan, face, corps, garder les deux côtés | `.cutPlane(plane, offset, keep)` | ✅ |
| | Déplacer/Copier le corps | Move/Copy Body | translation, rotation, copie multiple | transformations | ✅ |
| | Échelle | Scale | facteur uniforme (v1) / non uniforme 🟡 | `.scale(k)` | ✅ |
| **Données externes** | Insérer une pièce / corps importé | Insert Part | STEP/STL comme corps « mort » | `await importSTEP/importSTL` | ✅ |
| | Corps de forme libre / surfaces avancées | Surface tools | — | ⛔ |
| | **Direct Editing** (déplacer/redimensionner une face, Instant 3D) | Move Face / Instant3D | — | 🟡/⛔ |

---

## 5. Onglet **Assemblage**

| Groupe | Commande | Détails | Statut |
|---|---|---|---|
| Composants | Insérer des pièces | depuis le projet local/IndexedDB, instances multiples, mêmes pièces = même définition | ✅ (lot 5) |
| | Insérer un sous-assemblage | hiérarchie | 🟡 |
| | Déplacer / Tourner un composant | triade, « Déplacer avec les contraintes » | ✅ |
| | Remplacer / Rendre virtuel | — | 🟡 |
| Contraintes | **Coïncidence**, **Parallélisme**, **Perpendicularité**, **Concentricité**, **Tangence**, **Distance**, **Angle**, **Verrou (fixer)**, **Symétrie d'assemblage** | sélection de faces/arêtes/sommets/axes/plans d'origine, alignements (même/opposé/antiparallèle), inverse/aligné, types d'alignement multiples | ✅ solveur maison (projection itérative + jacobien) |
| | Contraintes intelligentes (SmartMates) | glisser une face sur une face → contrainte proposée | 🟡 |
| Détection | **Détecter les interférences** | rapport visuel + liste, par paire/sélection | ✅ |
| | Vérifier · Contrôle de distance | | 🟡 |
| Nomenclature | **Table des composants (BOM)** | quantités, masse, volume, matériau, export CSV | ✅ |
| | Éclaté / Vue explosée + lignes d'éclatement | — | 🟡 |
| | Vue en coupe d'assemblage | via plans de coupe | ✅ |

---

## 6. Onglet **Mise en plan**

| Groupe | Commande | Détails | Implémentation | Statut |
|---|---|---|---|---|
| Feuille | Nouvelle feuille (A4→A1, portrait/paysage), cartouche, format personnalisé | bloc titre rempli automatiquement (nom, échelle, date, auteur, matière) | Canvas/SVG maison | ✅ |
| Vues | Vue **de face / dessus / côté / isométrique**, **normale au plan** | via caméras de projection | `R.drawProjection(shape, R.lookFromPlane(...))` → `{visible, hidden}` | ✅ |
| | Vue **auxiliaire**, **détaillée**, **rupture** | — | 🟡 (auxiliaire v1.5) |
| | **Vue en coupe** (section A-A, coupe locale, demi-coupe, coupe décalée 🟡) | génération par `cutPlane` + projection + hachures | ✅ |
| | Échelle de vue, alignement, glisser-déposer | | ✅ |
| Cotation | Cotes linéaires, angulaires, rayon/diamètre, chanfrein, **diamètre d'arc** | accrochage aux arêtes projetées ; mise à jour après modification du modèle | module `drawing/dims.ts` | ✅ |
| | Cotes automatiques (basique), tolérances (±, limite) | | 🟡 |
| Annotations | Note, symbole de soudure ⛔, symbole de surface, repère de composant, **tableau de perçage** | | 🟡 |
| Export | PDF vectoriel, DXF, SVG, PNG | | `io/pdf.ts`, `io/dxf.ts` | ✅ |

---

## 7. Onglet **Évaluation**

| Commande | Détails | Implémentation | Statut |
|---|---|---|---|
| **Mesurer** | distance (minimale/normale/parallèle), longueur d'arête, angle, rayon/diamètre, épaisseur, aire de face, coordonnées ; cotes à l'écran persistantes | `measureDistanceBetween`, `measureLength`, `measureArea`, raycast | ✅ |
| **Propriétés de masse** | volume, aire, masse (densité du matériau), centre de gravité, moments/scissions d'inertie, matrice d'inertie | `measureShapeVolumeProperties`, `measureShapeLinearProperties`, `measureShapeSurfaceProperties` | ✅ |
| **Analyse de dépouille** | coloration des faces par angle de dépouille | calcul de normales par face (surbrillance) | 🟡 |
| **Section dynamique** | plan de coupe déplaçable (visuel) + option « modèle sectionné réel » | clipping planes three.js / `cutPlane` | ✅ |
| **Vérifier** | validité des corps, arêtes dégénérées, avertissements de reconstruction | `validate.ts` | ✅ |
| **Détecter les interférences** (dans une pièce) | chevauchement de corps | booléens + volume d'intersection | ✅ |
| **Comparer** deux documents / géométries | nuage de déviation | — | ⛔ |
| **Analyse de faisabilité / Simulation (FEA)** | — | ⛔ (intégration possible v3 via backend) |

---

## 8. Onglet **Affichage**

| Groupe | Commandes | Statut |
|---|---|---|
| Vues standard | Face, Arrière, Gauche, Droite, Dessus, Dessous, **Isométrique**, Trimétrique, Dimétrique, **Normale au plan** | ✅ |
| Zoom | Zoom sur sélection, Zoom étendu, Zoom arrière, Panoramique, **Rotation** (orbite), **Zoom au curseur** | ✅ |
| Styles d'affichage | **Ombré avec arêtes**, Ombré, Arêtes de silhouette, Filaire, Filaire estompé, **Transparence**, **Avec ombres** | ✅ |
| Éléments | Plans/axes/origine, **Plans de référence**, Cotes d'esquisse, Relations, **Vue éclatée** (assemblage), Points, Annotations, Systèmes de coordonnées | ✅ / 🟡 (éclaté) |
| Fenêtres | Diviser la fenêtre (2-4 vues), vue secondaire, plein écran | 🟡 |
| Caméras | Caméra de référence, enregistrer une vue nommée, animation de rotation | 🟡 |
| Sections | Section 1/2/3 activables, plans de coupe, contour de section | ✅ |

---

## 9. Onglet **Rendu & Apparences**

| Commande | Détails | Statut |
|---|---|---|
| Matériau (bibliothèque : aciers, alu, plastiques, bois, laiton) | couleur + densité + rugosité | ✅ |
| Apparence d'une face/corps/composant | couleur, éclat, transparence, texture (v1.5) | ✅ (v1 couleur/transparence) |
| Environnement / scène (fond dégradé, HDRI) | éclairage neutre atelier | 🟡 |
| Options de rendu | arêtes de silhouette, ombres portées, occlusion ambiante simplifiée, reflets | ✅ (basique) |
| Capture / export d'image (PNG, 2×) | | ✅ |
| Rendu photoréaliste (ray tracing) | | ⛔ |

---

## 10. Onglet **Outils**

| Commande | Détails | Statut |
|---|---|---|
| **Équations et paramètres globaux** | cotes liées par formules, renommage `D1→largeur` | ✅ |
| **Configurations** | jeu de valeurs + fonctions compressées, apparences, propriétés personnalisées | ✅ (les autres onglets d'une config : 🟡) |
| **Propriétés personnalisées** | champs utilisateur (matière, référence, traitement) réutilisables dans le cartouche et la BOM | ✅ |
| **Journal de reconstruction / diagnostic** | durées par fonction, avertissements, erreurs, copie du rapport | ✅ |
| **Console noyau** | statistiques OC, taille mémoire, version wasm, redémarrer le worker, tester la santé | ✅ |
| **API / Macro JS** | exécuter un script replicad (comme une macro SolidWorks) avec accès au document et au kernel ; enregistrer/rejouer | 🟡 (différenciateur fort : « macro CAD » côté navigateur) |
| **Préférences** | unités, précision d'affichage, qualité de tessellation, thème, langue, raccourcis, autosave | ✅ |
| **Options de performance** | budget de tessellation, nombre de workers, seuils d'avertissement (ex. > 500 instances) | ✅ |
| Nettoyer / optimiser le document, purger les caches | | ✅ |
| Migration de schéma (ouvrir un document plus ancien) | | ✅ |
| **Bibliothèque de pièces / fonctionnalités** (Toolbox) | vis, écrous, roulements ISO paramétriques | 🟡 |
| **Tôlerie** (dépliage, plis, tôles) | | ⛔ v2 |
| **Formes de tôle / surfaces / maillage (Mesh tools)** | | ⛔ |

---

## 11. Onglet **Aide**

| Commande | Contenu |
|---|---|
| Recherche d'aide contextuelle (F1) | fiche de la commande en cours : paramètres, cas d'usage, équivalence SolidWorks, tableau des pièges connus |
| Raccourcis clavier | table complète (voir §12) |
| Tutoriels intégrés | 5 parcours de 2 min : « premier cube », « pièce avec perçages », « esquisse contrainte », « assemblage vis-écrou », « mise en plan + PDF » |
| À propos | versions replicad / OpenCascade / planegcs, licences, journal des modifications |
| Signaler un problème | export d'un paquet de diagnostic (document, journal, version, mémoire) |

---

## 12. Raccourcis clavier (extrait normatif)

| Raccourci | Action |
|---|---|
| `S` | Barre de raccourcis contextuels (comme SolidWorks) |
| `Ctrl+K` | Palette de commandes (recherche FR/EN, synonymes SW) |
| `D` | Cotation intelligente (esquisse) |
| `L` / `R` / `C` / `A` / `E` | Ligne / Rectangle / Cercle / Arc / Ellipse (esquisse) |
| `Tab` | Inverser la direction de l'extrusion en cours |
| `X` | Basculer « pour construction » |
| `Échap` | Annuler la commande en cours |
| `Entrée` | Valider la commande en cours (✔) |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Rétablir |
| `Ctrl+B` | Reconstruire |
| `Ctrl+S` | Enregistrer (document + snapshot local) |
| `Ctrl+Maj+S` | Enregistrer sous / exporter |
| `Espace` | Basculer vue normale au plan ↔ isométrique |
| `0`–`9`, `Maj+0`–`Maj+9` | Vues standard / vues enregistrées |
| `F` | Zoom sur la sélection |
| `Ctrl+Maj+E` | Isoler la sélection |
| `Suppr` | Supprimer la sélection (entité, fonction, composant) |
| `F2` | Renommer (arbre, fonction, cote) |

## 13. Souris

| Action | Résultat |
|---|---|
| Clic gauche | Sélectionner (face → arête → sommet selon le filtre / proximité) |
| Clic gauche (outil actif) | Placer un point / démarrer-glisser |
| Clic droit | Menu contextuel dépendant de la sélection |
| Molette | Zoom au curseur |
| Clic molette (ou `Ctrl`+clic droit) | Orbiter |
| `Maj`+clic molette | Panoramique |
| Double-clic | Éditer (fonction, cote, composant) |
| Glisser une cote | Modification en direct + reconstruction (aperçu puis final) |
| Glisser une face avec triade | Déplacer la face (v1.5) |

---

## 14. Écoulement d'une commande (contrat d'interface)

```
1. Déclenchement (ruban / raccourci / menu contextuel / palette)
2. PropertyManager s'ouvre : champs par défaut intelligents (sélection courante pré-remplie)
3. Sélection guidée : la commande demande ce qui manque
   (« Sélectionnez un plan ou une face plane », surbrillance des candidats valides)
4. Aperçu en direct (reconstruction fantôme, qualité preview, non destructif)
5. ✔ Valider   → commit dans le document (1 transaction undo) → rebuild aval → arbre mis à jour
   ✗ Annuler   → aucun changement ; Échap = équivalent
   Échec        → avertissement/erreur dans le PropertyManager avec cause + suggestion
6. La fonction devient éditable à tout moment (double-clic) et peut être compressée/supprimée
```

**États d'une fonction** (icônes de l'arbre)

| État | Icône | Comportement |
|---|---|---|
| Validée | ✔ verte | rejouée normalement |
| Avertissement | ⚠️ jaune | ex. « référence topologique appariée par proximité », « 320 instances : opération lente » ; infobulle détaillée + option « corriger » |
| Erreur | ❌ rouge | fonction non appliquée, l'aval est reconstruit sur le dernier état valide ; l'utilisateur peut éditer/compresser/redéfinir les références |
| Compressée | ⊘ grise | ignorée (mais conservée dans le document et les configurations) |
| En cours | ⟳ bleue | reconstruction avec barre de progression annulable |

---

## 15. Couverture fonctionnelle du SPEC (à tenir à jour)

| Onglet | Commandes listées | v1 ✅ | v1.5 🟡 | hors périmètre ⛔ |
|---|---|---|---|---|
| Fichier | 16 | 13 | 2 | 1 |
| Esquisse | 38 | 34 | 4 | 0 |
| Fonctions | 32 | 26 | 4 | 2 |
| Assemblage | 16 | 9 | 7 | 0 |
| Mise en plan | 17 | 9 | 7 | 1 |
| Évaluation | 8 | 6 | 1 | 1 |
| Affichage | 22 | 16 | 6 | 0 |
| Rendu | 6 | 4 | 1 | 1 |
| Outils | 14 | 10 | 4 | 0 |
| **Total** | **169** | **127 (75 %)** | **36 (21 %)** | **7 (4 %)** |

> Objectif M3 (bêta « SolidWorks-like ») : ≥ 85 % des 169 commandes livrées ou livrables (v1 + v1.5), avec les 7 commandes hors périmètre **visibles mais désactivées** et documentées.
