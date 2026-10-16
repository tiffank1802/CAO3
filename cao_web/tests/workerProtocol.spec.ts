/**
 * Reproduction du protocole du worker noyau, **hors navigateur**.
 *
 * Objectif : vérifier exactement ce que fait le vrai worker — produire un maillage, puis le
 * **transférer** au thread UI (`postMessage` avec liste de transfert). Un transfert qui échoue
 * (tampon déjà détaché, tampon partagé, donnée non clonable) provoque une erreur *dans le
 * worker*, donc un noyau qui semble « tomber » et se recharger sans qu'aucune pièce ne
 * s'affiche. C'est ce scénario que ce fichier reproduit fidèlement, via `structuredClone`
 * (même algorithme que `postMessage`, liste de transfert comprise).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { initKernel } from "@/cad/kernel/init";
import { rebuildDocument } from "@/cad/kernel/rebuild";
import { createDocument, createExtrudeFeature, createSketchFeature } from "@/cad/core/registry";
import { addCircleAt, addRectangleCentered } from "@/cad/sketch/model";
import type { CadDocument } from "@/cad/core/types";
import { resolve } from "node:path";

const OC_WASM = resolve(__dirname, "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");

/** Réplique exacte de la liste de transfert du worker (`src/cad/kernel/worker.ts`). */
function transferListOf(result: { mesh: { positions: ArrayBufferView; normals: ArrayBufferView; indices: ArrayBufferView; faceIds: ArrayBufferView; edgeLines: ArrayBufferView; edgeIds: ArrayBufferView } | null }) {
  const mesh = result.mesh;
  if (!mesh) return [];
  return [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, mesh.faceIds.buffer, mesh.edgeLines.buffer, mesh.edgeIds.buffer];
}

/** Pièce de démonstration : rectangle 80 × 50 contraint + bossage 20 mm. */
function demoPart(): CadDocument {
  const doc = createDocument("Demonstration");
  const sketch = createSketchFeature("Esquisse1");
  addRectangleCentered(sketch.sketch, { x: 0, y: 0 }, 80, 50);
  const extrude = createExtrudeFeature(sketch.id, "Bossage1");
  doc.features.push(sketch, extrude);
  return doc;
}

/** Pièce avec perçage : exerce les booléens et la tessellation après coupe. */
function plateWithHole(): CadDocument {
  const doc = createDocument("Piece_percee");
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

beforeAll(async () => {
  await initKernel(() => OC_WASM);
}, 180_000);

describe("Protocole du worker noyau (transfert du maillage)", () => {
  it("la pièce de démonstration produit un maillage transférable", { timeout: 120_000 }, () => {
    const result = rebuildDocument(demoPart(), 1, "final");
    expect(result.states.filter((s) => s.status === "error")).toHaveLength(0);
    expect(result.volume).toBeCloseTo(80_000, -2);
    expect(result.mesh!.triangleCount).toBeGreaterThan(0);

    // Le transfert doit réussir : c'est lui qui échoue silencieusement dans le navigateur.
    const cloned = structuredClone(result, { transfer: transferListOf(result as never) }) as typeof result;
    expect(cloned.mesh!.triangleCount).toBeGreaterThan(0);
    expect(cloned.mesh!.positions.length).toBeGreaterThan(0);
    expect(cloned.mesh!.indices.length).toBe(cloned.mesh!.triangleCount * 3);
    expect(cloned.mesh!.faceIds.length).toBe(cloned.mesh!.triangleCount);
    expect(cloned.mesh!.bbox.max[0]).toBeGreaterThan(0);
  });

  it("une pièce percée produit aussi un maillage transférable", { timeout: 120_000 }, () => {
    const result = rebuildDocument(plateWithHole(), 1, "final");
    expect(result.states.filter((s) => s.status === "error")).toHaveLength(0);
    const cloned = structuredClone(result, { transfer: transferListOf(result as never) }) as typeof result;
    expect(cloned.mesh!.triangleCount).toBeGreaterThan(0);
    expect(cloned.mesh!.edgeLines.length).toBeGreaterThan(0);
  });

  it("un maillage vide (aucune géométrie) reste transférable", { timeout: 120_000 }, () => {
    // Document sans aucune fonction : le worker renvoie `emptyMesh()`, dont les tampons
    // font zéro octet — cas classique de « DataCloneError » lors du transfert.
    const result = rebuildDocument(createDocument("Vide"), 1, "preview");
    expect(result.mesh!.triangleCount).toBe(0);

    const cloned = structuredClone(result, { transfer: transferListOf(result as never) }) as typeof result;
    expect(cloned.mesh!.triangleCount).toBe(0);
    expect(cloned.mesh!.positions.length).toBe(0);
  });

  it("la qualité d'aperçu et la qualité finale produisent toutes deux un maillage", { timeout: 120_000 }, () => {
    for (const quality of ["preview", "final"] as const) {
      const result = rebuildDocument(demoPart(), 1, quality);
      const cloned = structuredClone(result, { transfer: transferListOf(result as never) }) as typeof result;
      expect(cloned.mesh!.triangleCount, `qualité ${quality}`).toBeGreaterThan(0);
    }
  });
});
