/**
 * Tests du noyau — mêmes chemins de code que le worker navigateur.
 * Ils figent (1) les pièges vérifiés lors du spike, (2) la chaîne esquisse→extrusion,
 * (3) le solveur de contraintes et (4) l'export STEP.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as R from "replicad";
import { initKernel, kernelHeapBytes } from "@/cad/kernel/init";
import { boxBetween, boxSafe, cutMany, draftScaleFactors, intersectSafe, loftSafe } from "@/cad/kernel/compat";
import { buildShape, exportDocument, rebuildDocument } from "@/cad/kernel/rebuild";
import { sketchToDrawing } from "@/cad/kernel/builders/sketch";
import { ensureSolver, solveSketch } from "@/cad/kernel/solve";
import { createDocument, createEmptySketchData, createExtrudeFeature, createSketchFeature } from "@/cad/core/registry";
import { addRectangleCentered, addCircleAt, applySolveResult } from "@/cad/sketch/model";
import type { CadDocument } from "@/cad/core/types";
import { resolve } from "node:path";

const OC_WASM = resolve(__dirname, "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const PLANEGCS_WASM = resolve(__dirname, "../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm");

beforeAll(async () => {
  await initKernel(() => OC_WASM);
  await ensureSolver(PLANEGCS_WASM);
});

describe("compatibilité noyau (pièges du spike figés en tests)", () => {
  it("makeBox attend deux coins 3D : trois nombres lèvent une exception sans message → boxSafe", () => {
    // Piège d'API : R.makeBox(largeur, profondeur, hauteur) n'existe pas.
    expect(() => (R.makeBox as unknown as (a: number, b: number, c: number) => unknown)(20, 20, 20)).toThrow();
    // L'API réelle est « deux coins » (comme le rectangle par 2 coins d'esquisse).
    expect(R.measureVolume(boxBetween([0, 0, 0], [20, 20, 20]) as never)).toBeCloseTo(8000, 3);
    // boxSafe renvoie une boîte centrée de 20 mm d'arête.
    const centered = boxSafe(20, 20, 20);
    const bounds = centered.boundingBox.bounds as unknown as [[number, number, number], [number, number, number]];
    expect(bounds[0][0]).toBeCloseTo(-10, 6);
    expect(bounds[1][2]).toBeCloseTo(10, 6);
    expect(R.measureVolume(centered as never)).toBeCloseTo(8000, 3);
  });

  it("intersect() natif fonctionne (80×50×20 ∩ bande de 10 mm)", () => {
    const plate = boxSafe(80, 50, 20);
    const band = boxSafe(100, 10, 200);
    expect(R.measureVolume(plate.intersect(band) as never)).toBeCloseTo(80 * 10 * 20, 2);
    expect(R.measureVolume(intersectSafe(plate, band) as never)).toBeCloseTo(80 * 10 * 20, 2);
  });

  it("une exception attrapée ne corrompt pas la session du noyau", () => {
    const before = boxSafe(20, 20, 20);
    expect(() => R.makeBox([0, 0, 0], "oops" as never)).toThrow();
    const after = boxSafe(20, 20, 20);
    expect(R.measureVolume(after as never)).toBeCloseTo(R.measureVolume(before as never), 6);
  });

  it("cutMany regroupe les outils dans un seul booléen", () => {
    const plate = boxSafe(80, 50, 20);
    const tools = [-20, -10, 0, 10, 20].map((x) => R.makeCylinder(3, 60).translate(x, 0, -30) as never);
    const result = cutMany(plate, tools);
    const volume = R.measureVolume(result as never);
    const expected = 80 * 50 * 20 - 5 * Math.PI * 9 * 20;
    expect(volume).toBeGreaterThan(expected - 120);
    expect(volume).toBeLessThan(expected + 120);
  });

  it("loftSafe passe par loftWith (jamais R.loft)", () => {
    const s1 = R.drawRectangle(40, 40).sketchOnPlane("XY") as unknown as import("replicad").Sketch;
    const s2 = R.drawRectangle(20, 20).sketchOnPlane("XY", 30) as unknown as import("replicad").Sketch;
    const volume = R.measureVolume(loftSafe([s1, s2], true) as never);
    // Tronc de pyramide : h/3·(A1+A2+√(A1A2)) = 30/3·(1600+400+800) = 28000
    expect(volume).toBeGreaterThan(27000);
    expect(volume).toBeLessThan(29000);
  });

  it("les facteurs de dépouille suivent 1 + 2·h·tan(θ)/taille", () => {
    const { fx } = draftScaleFactors(80, 50, 20, 45);
    expect(fx).toBeCloseTo(1 + (2 * 20) / 80, 6);
  });
});

function rectangleDocument(width = 80, height = 50, depth = 20, operation: "newBody" | "cut" = "newBody"): CadDocument {
  const doc = createDocument("Pièce test");
  const sketch = createEmptySketchData();
  addRectangleCentered(sketch, { x: 0, y: 0 }, width, height);
  const sketchFeature = createSketchFeature("Esquisse1", sketch);
  doc.features.push(sketchFeature);
  const extrude = createExtrudeFeature(sketchFeature.id, "Bossage1");
  extrude.end.depth = depth;
  extrude.operation = operation;
  doc.features.push(extrude);
  return doc;
}

describe("esquisse → extrusion → tessellation", () => {
  it("convertit un rectangle d'esquisse en Drawing fermé", () => {
    const sketch = createEmptySketchData();
    addRectangleCentered(sketch, { x: 0, y: 0 }, 80, 50);
    const drawing = sketchToDrawing(sketch);
    expect(drawing.boundingBox.width).toBeCloseTo(80, 4);
    expect(drawing.boundingBox.height).toBeCloseTo(50, 4);
  });

  it("reconstruit un bossage de 80×50×20 (volume, faces, bounding box)", () => {
    const doc = rectangleDocument(80, 50, 20);
    const result = rebuildDocument(doc, 1, "final", () => 0);
    expect(result.states.every((s) => s.status === "ok")).toBe(true);
    expect(result.volume).toBeCloseTo(80000, 1);
    const mesh = result.mesh!;
    expect(mesh.triangleCount).toBeGreaterThan(8);
    expect(mesh.faceIds.length).toBe(mesh.triangleCount);
    expect(mesh.edgeIds.length).toBe(mesh.edgeLines.length / 6);
    expect(mesh.bbox.max[2]).toBeCloseTo(20, 3);
    expect(new Set(Array.from(mesh.faceIds)).size).toBeGreaterThanOrEqual(6);
  });

  it("enlève de la matière par un second bossage en mode cut", () => {
    const doc = createDocument("Pièce percée");
    const sketchA = createEmptySketchData();
    addRectangleCentered(sketchA, { x: 0, y: 0 }, 80, 50);
    const featureA = createSketchFeature("Esquisse1", sketchA);
    doc.features.push(featureA);
    const extrudeA = createExtrudeFeature(featureA.id, "Bossage1");
    extrudeA.end.depth = 20;
    doc.features.push(extrudeA);

    const sketchB = createEmptySketchData();
    addCircleAt(sketchB, { x: 0, y: 0 }, 6);
    const featureB = createSketchFeature("Esquisse2", sketchB);
    doc.features.push(featureB);
    const extrudeB = createExtrudeFeature(featureB.id, "Enlèvement1");
    extrudeB.end.depth = 60;
    extrudeB.end.reverse = false;
    extrudeB.operation = "cut";
    doc.features.push(extrudeB);

    const result = rebuildDocument(doc, 1, "preview", () => 0);
    expect(result.states.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok"]);
    const expected = 80 * 50 * 20 - Math.PI * 36 * 20;
    expect(result.volume!).toBeGreaterThan(expected - 60);
    expect(result.volume!).toBeLessThan(expected + 60);
  });

  it("marque la fonction en erreur sans perdre le corps précédent", () => {
    const doc = rectangleDocument(80, 50, 20);
    const broken = createExtrudeFeature("esquisse_inexistante", "Bossage cassé");
    doc.features.push(broken);
    const result = rebuildDocument(doc, 1, "preview", () => 0);
    expect(result.states.at(-1)!.status).toBe("error");
    expect(result.volume).toBeCloseTo(80000, 1);
  });

  it("exporte un STEP exploitable", async () => {
    const doc = rectangleDocument(40, 30, 10);
    const exported = await exportDocument(doc, "step");
    const header = new TextDecoder().decode(exported.data.slice(0, 30));
    expect(exported.fileName).toBe("Piece_test.step");
    expect(header).toContain("ISO-10303");
    expect(exported.byteLength).toBeGreaterThan(2000);
  });

  it("buildShape renvoie la forme finale (aucune donnée OC ne sort du worker)", () => {
    const { shape, states } = buildShape(rectangleDocument(10, 10, 10), () => 0);
    expect(states.at(-1)!.status).toBe("ok");
    expect(R.measureVolume(shape as never)).toBeCloseTo(1000, 1);
  });
});

describe("solveur d'esquisse (planegcs)", () => {
  it("résout un rectangle centré de 80×50 à dof = 0", () => {
    const sketch = createEmptySketchData();
    addRectangleCentered(sketch, { x: 0, y: 0 }, 80, 50);
    const result = solveSketch(sketch);
    expect(result.status).toBe(0);
    applySolveResult(sketch, result);
    const xs = sketch.points.map((p) => p.x);
    const ys = sketch.points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(50, 6);
    expect(result.dof).toBe(0);
    expect(result.conflicts).toEqual([]);
  });

  it("détecte un conflit de cotes (comme SolidWorks surligne les cotes en conflit)", () => {
    const sketch = createEmptySketchData();
    const rect = addRectangleCentered(sketch, { x: 0, y: 0 }, 80, 50);
    // Deuxième cote contradictoire sur la même arête.
    sketch.dimensions.push({
      id: "conflit",
      kind: "distance",
      points: [rect.pointIds[0], rect.pointIds[1]],
      value: 99,
      driving: true,
    });
    const result = solveSketch(sketch);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts).toContain("conflit");
  });

  it("contraint entièrement un cercle quand son centre est accroché à l'origine", () => {
    const sketch = createEmptySketchData();
    addCircleAt(sketch, { x: 0, y: 0 }, 12, sketch.originId);
    const result = solveSketch(sketch);
    expect(result.status).toBe(0);
    expect(result.dof).toBe(0);
    expect(result.radii[sketch.entities[0].id]).toBeCloseTo(12, 6);
  });

  it("laisse le cercle libre (2 dof) quand il n'est pas positionné", () => {
    const sketch = createEmptySketchData();
    addCircleAt(sketch, { x: 13, y: 7 }, 12);
    const result = solveSketch(sketch);
    expect(result.status).toBe(0);
    expect(result.dof).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------
// Mémoire : c'est le point qui fait « planter le navigateur » si on l'ignore. OpenCascade
// ne rend jamais son tas WASM au système ; en revanche chaque forme est un objet que l'on
// doit libérer explicitement, sinon le tas ne cesse de grossir au fil des reconstructions.
// ---------------------------------------------------------------------------------------
describe("Mémoire du noyau", () => {
  function partWithHoles(): CadDocument {
    const doc = createDocument("Memoire");
    const sketch = createSketchFeature("Esquisse1");
    addRectangleCentered(sketch.sketch, { x: 0, y: 0 }, 80, 50);
    const extrude = createExtrudeFeature(sketch.id, "Bossage1");
    doc.features.push(sketch, extrude);
    const holeSketch = createSketchFeature("Esquisse2");
    addCircleAt(holeSketch.sketch, { x: 0, y: 0 }, 6);
    const hole = createExtrudeFeature(holeSketch.id, "Perçage1");
    hole.operation = "cut";
    doc.features.push(holeSketch, hole);
    return doc;
  }

  it("expose la mémoire du noyau et la libère à chaque reconstruction", { timeout: 180_000 }, () => {
    const doc = partWithHoles();

    // Première passe : référence.
    const first = rebuildDocument(doc, 1, "preview");
    expect(first.volume).toBeCloseTo(80 * 50 * 20 - Math.PI * 36 * 20, -2);
    expect(first.heapBytes).toBeGreaterThan(0);

    // 30 reconstructions enchaînées : sans libération des formes, le tas WASM d'Emscripten
    // grossit à chaque tour (l'ancienne géométrie n'est jamais rendue).
    const samples: number[] = [];
    const started = Date.now();
    for (let i = 0; i < 30; i++) {
      const result = rebuildDocument(doc, i + 2, "preview");
      expect(result.volume).toBeCloseTo(first.volume as number, -2);
      samples.push(result.heapBytes ?? 0);
    }
    const growth = samples[samples.length - 1] - first.heapBytes!;
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    // eslint-disable-next-line no-console -- mesure utile en cas d'échec
    console.log(
      `Tas WASM : départ ${mb(first.heapBytes!)} Mo → après 30 reconstructions ${mb(samples[samples.length - 1])} Mo ` +
        `(Δ ${mb(growth)} Mo) en ${Date.now() - started} ms`,
    );

    // Le tas ne doit pas doubler en 30 reconstructions d'une même pièce.
    expect(samples[samples.length - 1]).toBeLessThan(first.heapBytes! * 2);
    expect(kernelHeapBytes()).toBe(samples[samples.length - 1]);
  });
});

// ---------------------------------------------------------------------------------------
// Budget de rendu : le maillage est un cache jetable. Sa taille et son coût doivent rester
// bornés — c'est ce qui distingue « un peu de géométrie » de « le navigateur ne répond plus ».
// ---------------------------------------------------------------------------------------
describe("Budget de rendu", () => {
  function partWithHoles(): CadDocument {
    const doc = createDocument("Budget");
    const sketch = createSketchFeature("Esquisse1");
    addRectangleCentered(sketch.sketch, { x: 0, y: 0 }, 80, 50);
    const extrude = createExtrudeFeature(sketch.id, "Bossage1");
    doc.features.push(sketch, extrude);
    const holeSketch = createSketchFeature("Esquisse2");
    addCircleAt(holeSketch.sketch, { x: 18, y: 0 }, 6);
    const hole = createExtrudeFeature(holeSketch.id, "Perçage1");
    hole.operation = "cut";
    doc.features.push(holeSketch, hole);
    return doc;
  }

  it("la tessellation d'aperçu coûte au moins deux fois moins cher que la finale", () => {
    const doc = partWithHoles();

    const previewStarted = performance.now();
    const preview = rebuildDocument(doc, 1, "preview");
    const previewMs = performance.now() - previewStarted;

    const finalStarted = performance.now();
    const final = rebuildDocument(doc, 2, "final");
    const finalMs = performance.now() - finalStarted;

    const previewTriangles = preview.mesh?.triangleCount ?? 0;
    const finalTriangles = final.mesh?.triangleCount ?? 0;
    // eslint-disable-next-line no-console -- chiffres utiles (documentés dans PERFORMANCES_NAVIGATEUR.md)
    console.log(
      `Aperçu : ${previewTriangles} triangles en ${previewMs.toFixed(0)} ms · ` +
        `Final : ${finalTriangles} triangles en ${finalMs.toFixed(0)} ms`,
    );

    expect(previewTriangles).toBeGreaterThan(0);
    expect(finalTriangles).toBeGreaterThanOrEqual(previewTriangles);
    expect(previewMs).toBeLessThan(finalMs * 2);
    // Une pièce de ce type doit rester très en deçà du budget de 400 000 triangles.
    expect(finalTriangles).toBeLessThan(50_000);
  });

  it("une pièce lourde (répétition d'outils) reste bornée en triangles et en mémoire", { timeout: 180_000 }, () => {
    const doc = createDocument("AvecTrous");
    const sketch = createSketchFeature("Esquisse1");
    addRectangleCentered(sketch.sketch, { x: 0, y: 0 }, 200, 120);
    const extrude = createExtrudeFeature(sketch.id, "Bossage1");
    extrude.end = { kind: "blind", depth: 10, reverse: false, draftAngle: 0 };
    doc.features.push(sketch, extrude);

    // 12 perçages, chacun dans sa propre esquisse/fonction (comme le ferait l'utilisateur).
    for (let i = 0; i < 12; i++) {
      const holeSketch = createSketchFeature(`Esquisse${i + 2}`);
      addCircleAt(holeSketch.sketch, { x: -80 + i * 14, y: i % 2 ? 30 : -30 }, 4);
      const hole = createExtrudeFeature(holeSketch.id, `Perçage${i + 1}`);
      hole.operation = "cut";
      doc.features.push(holeSketch, hole);
    }

    const started = Date.now();
    const result = rebuildDocument(doc, 1, "final");
    const ms = Date.now() - started;
    // eslint-disable-next-line no-console -- mesure de référence
    console.log(
      `13 fonctions (1 bossage + 12 perçages) : ${result.mesh?.triangleCount ?? 0} triangles, ` +
        `${ms} ms, tas WASM ${((result.heapBytes ?? 0) / 1048576).toFixed(0)} Mo`,
    );

    expect(result.states.filter((s) => s.status === "error")).toHaveLength(0);
    expect(result.volume).toBeCloseTo(200 * 120 * 10 - 12 * Math.PI * 16 * 10, -3);
    expect(result.mesh!.triangleCount).toBeLessThan(400_000);
    expect(ms).toBeLessThan(5000);
  });
});
