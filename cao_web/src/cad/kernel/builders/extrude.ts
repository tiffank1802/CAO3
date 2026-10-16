/**
 * Bossage / Enlèvement de matière par extrusion (+ dépouille).
 *
 * Points d'attention (spike) :
 *  - la dépouille ne peut PAS passer par `shape.draft()` (cassé) : on réalise une
 *    dépouille par lissage entre le profil de base et un profil mis à l'échelle ;
 *  - `intersect` est reconstruit par double coupe ;
 *  - « à travers tout » est calculé depuis la boîte englobante du corps précédent.
 */
import type { Shape3D, Sketch } from "replicad";
import type { SketchFeature, ExtrudeFeature } from "../../core/types";
import { draftScaleFactors, fuseOrCompound, intersectSafe } from "../compat";
import { countHoles, sketchToDrawing } from "./sketch";

export interface BuildOutcome {
  shape: Shape3D | null;
  warnings: string[];
}

function planeArgs(feature: SketchFeature): { plane: "XY" | "XZ" | "YZ"; offset: number } {
  return { plane: feature.sketch.plane.name, offset: feature.sketch.plane.offset ?? 0 };
}

/** Distance d'extrusion effective selon le mode d'aboutissement. */
function resolveDistance(feature: ExtrudeFeature, previous: Shape3D | null): { distance: number; warnings: string[] } {
  const warnings: string[] = [];
  if (feature.end.kind === "throughAll") {
    if (!previous) {
      warnings.push("« À travers tout » sans corps existant : profondeur par défaut de 100 mm appliquée.");
      return { distance: 100, warnings };
    }
    try {
      const size = previous.boundingBox;
      const span = Math.max(size.width, size.height, size.depth) * 2 + 20;
      return { distance: span, warnings };
    } catch {
      warnings.push("Boîte englobante indisponible : profondeur de 100 mm appliquée.");
      return { distance: 100, warnings };
    }
  }
  return { distance: feature.end.depth, warnings };
}

export function buildExtrude(
  profile: SketchFeature,
  feature: ExtrudeFeature,
  previous: Shape3D | null,
): BuildOutcome {
  const warnings: string[] = [];
  const { plane, offset } = planeArgs(profile);
  const drawing = sketchToDrawing(profile.sketch);

  // Origine de l'extrusion dans le repère du plan.
  const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0;
  const origin: [number, number, number] = [0, 0, 0];
  if (plane === "XY") origin[2] = offset;
  if (plane === "XZ") origin[1] = offset;
  if (plane === "YZ") origin[0] = offset;

  const { distance, warnings: distanceWarnings } = resolveDistance(feature, previous);
  warnings.push(...distanceWarnings);

  let startOffset = 0;
  const direction: [number, number, number] = [0, 0, 1];
  if (plane === "XY") direction[2] = feature.end.reverse ? -1 : 1;
  if (plane === "XZ") direction[1] = feature.end.reverse ? -1 : 1;
  if (plane === "YZ") direction[0] = feature.end.reverse ? -1 : 1;

  if (feature.end.kind === "symmetric") {
    startOffset = -distance / 2;
  }
  origin[axis] += startOffset;

  const baseSketch = drawing.sketchOnPlane(plane, offset + startOffset) as unknown as Sketch;
  void origin;

  const extrudeOptions = { extrusionDirection: direction };

  let solid: Shape3D;
  if (Math.abs(feature.end.draftAngle) > 1e-6) {
    const holes = countHoles(profile.sketch);
    if (holes > 0) {
      warnings.push("Dépouille ignorée : les esquisses contenant des perçages ne sont pas prises en charge (v0).");
      solid = baseSketch.extrude(distance, extrudeOptions) as unknown as Shape3D;
    } else {
      const bb = drawing.boundingBox;
      const { fx, fy } = draftScaleFactors(bb.width, bb.height, distance, feature.end.draftAngle);
      const center: [number, number] = [bb.center[0], bb.center[1]];
      const scaled = drawing
        .stretch(fx, [1, 0], center)
        .stretch(fy, [0, 1], center)
        .sketchOnPlane(plane, offset + startOffset + (direction[axis] > 0 ? distance : -distance)) as unknown as Sketch;
      solid = baseSketch.loftWith([scaled], { ruled: true }) as unknown as Shape3D;
      warnings.push("Dépouille réalisée par lissage entre profil de base et profil élargi.");
    }
  } else {
    solid = baseSketch.extrude(distance, extrudeOptions) as unknown as Shape3D;
  }

  switch (feature.operation) {
    case "cut": {
      if (!previous) throw new Error("Enlèvement de matière sans corps existant.");
      return { shape: previous.cut(solid) as unknown as Shape3D, warnings };
    }
    case "fuse": {
      if (!previous) return { shape: solid, warnings };
      const fused = fuseOrCompound(previous, solid);
      if (fused.warning) warnings.push(fused.warning);
      return { shape: fused.shape, warnings };
    }
    case "intersect": {
      if (!previous) throw new Error("Intersection sans corps existant.");
      return { shape: intersectSafe(previous, solid), warnings };
    }
    case "newBody":
    default:
      return { shape: solid, warnings };
  }
}
