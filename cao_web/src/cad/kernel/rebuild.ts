/**
 * Moteur de reconstruction : document (JSON) → géométrie + buffers de rendu.
 *
 * Comportement calqué sur SolidWorks : une fonction qui échoue est marquée en erreur,
 * la reconstruction continue sur le dernier état valide, et rien n'est perdu
 * (le document reste la source de vérité).
 */
import * as R from "replicad";
import type { Shape3D } from "replicad";
import type { CadDocument, Feature, SketchFeature } from "../core/types";
import { isSketchFeature } from "../core/types";
import { buildExtrude } from "./builders/extrude";
import { kernelHeapBytes } from "./init";
import { emptyMesh, QUALITY, tessellate } from "./tessellate";
import type { ExportResult, FeatureState, RebuildResult } from "./protocol";
import { inspectShape, validateShape, type ShapeStats } from "./validate";

/**
 * Libère explicitement une forme OpenCascade.
 *
 * Mesuré (PERFORMANCES_NAVIGATEUR.md §4) : `delete()` rend les poignées côté JavaScript et
 * évite d'accumuler des références, mais **ne fait pas rétrécir le tas WASM** — Emscripten ne
 * rend jamais la mémoire au système. On appelle donc `delete()` systématiquement (c'est gratuit
 * et cela évite les fuites de poignées), sans en attendre une baisse de mémoire : la seule
 * façon de récupérer le tas est de tuer le worker (`KernelClient.restart`).
 */
export function freeShape(shape: Shape3D | null | undefined): void {
  try {
    (shape as unknown as { delete?: () => void } | null)?.delete?.();
  } catch {
    // Forme déjà libérée : sans conséquence.
  }
}

export interface ShapeBuildResult {
  shape: Shape3D | null;
  states: FeatureState[];
  messages: string[];
  totalMs: number;
}

/** Rejoue l'arbre de fonctions et renvoie la forme finale + l'état de chaque fonction. */
export function buildShape(doc: CadDocument, now: () => number = () => performance.now()): ShapeBuildResult {
  const started = now();
  const states: FeatureState[] = [];
  const messages: string[] = [];
  let shape: Shape3D | null = null;
  let stats: ShapeStats | null = null;

  for (const feature of doc.features as Feature[]) {
    if (feature.suppressed) {
      states.push({ featureId: feature.id, status: "ok", ms: 0 });
      continue;
    }
    const featureStart = now();
    try {
      if (isSketchFeature(feature)) {
        // Une esquisse ne produit pas de géométrie : elle est consommée par les fonctions aval.
        states.push({ featureId: feature.id, status: "ok", ms: now() - featureStart });
        continue;
      }
      const profile = doc.features.find((f) => f.id === feature.profileId);
      if (!isSketchFeature(profile)) throw new Error("Esquisse source introuvable ou supprimée.");
      const outcome = buildExtrude(profile as SketchFeature, feature, shape);
      const nextShape = (outcome.shape ?? null) as Shape3D | null;
      // La forme précédente n'est plus référencée : on la libère tout de suite.
      if (shape && nextShape !== shape) freeShape(shape);
      const nextStats = inspectShape(nextShape);
      const warnings = [...outcome.warnings, ...validateShape(nextStats, stats)];
      shape = nextShape;
      stats = nextStats;
      if (warnings.length) {
        states.push({ featureId: feature.id, status: "warning", ms: now() - featureStart, warnings });
      } else {
        states.push({ featureId: feature.id, status: "ok", ms: now() - featureStart });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      states.push({ featureId: feature.id, status: "error", ms: now() - featureStart, message });
    }
  }

  return { shape, states, messages, totalMs: now() - started };
}

export function rebuildDocument(
  doc: CadDocument,
  revision: number,
  quality: "preview" | "final",
  now: () => number = () => performance.now(),
): RebuildResult {
  const { shape, states, messages, totalMs } = buildShape(doc, now);

  let mesh = null as RebuildResult["mesh"];
  if (shape) {
    try {
      mesh = tessellate(shape as never, QUALITY[quality]);
    } catch (error) {
      messages.push(`Tessellation impossible : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!mesh) mesh = emptyMesh();

  let volume: number | null = null;
  if (shape) {
    try {
      volume = R.measureVolume(shape as never);
    } catch {
      volume = null;
    }
  }

  // La forme finale a rempli son rôle (maillage + volume) : on rend la mémoire au système.
  if (shape) freeShape(shape);

  return { revision, mesh, states, totalMs, volume, messages, heapBytes: kernelHeapBytes() };
}

export async function exportDocument(doc: CadDocument, format: "step" | "stl"): Promise<ExportResult> {
  const { shape } = buildShape(doc);
  if (!shape) throw new Error("Aucune géométrie à exporter.");
  const baseName = doc.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeName = baseName || "piece";
  const blob = (format === "step" ? shape.blobSTEP() : shape.blobSTL({ binary: true })) as unknown as Blob;
  const buffer = await blob.arrayBuffer();
  freeShape(shape);
  return {
    format,
    data: new Uint8Array(buffer),
    fileName: format === "step" ? `${safeName}.step` : `${safeName}.stl`,
    byteLength: buffer.byteLength,
  };
}
