/**
 * Validation systématique de chaque résultat de fonction (principe P5).
 * Aucun `isValid()` n'est exposé par replicad (spike §3.8) : on contrôle donc
 * le volume, la boîte englobante et la topologie, et on remonte des avertissements
 * au lieu de laisser passer une géométrie cassée.
 */
import * as R from "replicad";
import type { AnyShape, Shape3D } from "replicad";

export interface ShapeStats {
  volume: number | null;
  faceCount: number;
  edgeCount: number;
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  bboxSize: [number, number, number] | null;
}

export function inspectShape(shape: AnyShape | null | undefined): ShapeStats {
  const empty: ShapeStats = { volume: null, faceCount: 0, edgeCount: 0, bbox: null, bboxSize: null };
  if (!shape) return empty;
  let volume: number | null = null;
  try {
    volume = R.measureVolume(shape as Shape3D);
  } catch {
    volume = null;
  }
  let faceCount = 0;
  let edgeCount = 0;
  try {
    faceCount = shape.faces.length;
    edgeCount = shape.edges.length;
  } catch {
    /* formes non topologiques (wire seul) */
  }
  let bbox: ShapeStats["bbox"] = null;
  let bboxSize: ShapeStats["bboxSize"] = null;
  try {
    const bb = shape.boundingBox;
    const [min, max] = bb.bounds as unknown as [[number, number, number], [number, number, number]];
    bbox = { min, max };
    bboxSize = [bb.width, bb.height, bb.depth];
  } catch {
    /* ignore */
  }
  return { volume, faceCount, edgeCount, bbox, bboxSize };
}

/**
 * Contrôle de plausibilité d'un résultat de fonction.
 * Exemple réel observé pendant le spike : coque après perçage → volume négatif
 * (−32 207 mm³) sans qu'aucune erreur ne soit levée.
 */
export function validateShape(stats: ShapeStats, previous?: ShapeStats | null): string[] {
  const warnings: string[] = [];
  if (stats.faceCount === 0) {
    warnings.push("Résultat vide : aucune face générée.");
    return warnings;
  }
  if (stats.volume === null) {
    warnings.push("Volume non mesurable : le solide est probablement ouvert (coque non fermée).");
  } else if (stats.volume <= 0) {
    warnings.push(`Volume non physique (${stats.volume.toFixed(1)} mm³) : la fonction a produit une géométrie invalide.`);
  }
  if (previous?.bboxSize && stats.bboxSize) {
    const growth = stats.bboxSize.map((v, i) => (previous.bboxSize![i] > 1e-6 ? v / previous.bboxSize![i] : 1));
    if (growth.some((g) => g > 50)) {
      warnings.push("Dimensions multipliées par plus de 50 : vérifiez la direction et la profondeur.");
    }
  }
  if (stats.faceCount > 3000) {
    warnings.push(`${stats.faceCount} faces : opération lourde, envisagez de regrouper les répétitions.`);
  }
  return warnings;
}
