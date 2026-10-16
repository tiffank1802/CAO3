/**
 * Tessellation : transforme une forme B-Rep en buffers prêts pour WebGL
 * (positions, normales, indices) + tables de correspondance face/arête
 * qui servent au picking dans la vue 3D.
 */
import type { AnyShape } from "replicad";
import type { MeshPayload } from "./protocol";

export interface TessellationQuality {
  tolerance: number;
  angularTolerance: number;
}

export const QUALITY: Record<"preview" | "final" | "measure", TessellationQuality> = {
  preview: { tolerance: 0.25, angularTolerance: 0.6 },
  final: { tolerance: 0.05, angularTolerance: 0.3 },
  measure: { tolerance: 0.01, angularTolerance: 0.15 },
};

interface FaceGroupLike {
  start: number;
  count: number;
  faceId: number;
}

interface EdgeGroupLike {
  start: number;
  count: number;
  edgeId: number;
}

function fillFaceIds(triangleCount: number, groups: FaceGroupLike[] | undefined): Uint32Array {
  const faceIds = new Uint32Array(triangleCount);
  if (!groups?.length) return faceIds;
  for (const group of groups) {
    const firstTriangle = Math.floor(group.start / 3);
    const count = Math.floor(group.count / 3);
    for (let i = 0; i < count; i += 1) {
      const index = firstTriangle + i;
      if (index >= 0 && index < triangleCount) faceIds[index] = group.faceId;
    }
  }
  return faceIds;
}

/**
 * `meshEdges()` renvoie `{ lines, edgeGroups }` dont l'unité de `start`/`count`
 * n'est pas documentée : on la déduit en comparant la somme des groupes à la
 * longueur du tableau de lignes (6 flottants par segment).
 */
function fillEdgeIds(segmentCount: number, linesLength: number, groups: EdgeGroupLike[] | undefined): Uint32Array {
  const edgeIds = new Uint32Array(segmentCount);
  if (!groups?.length) return edgeIds;
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const isFloatUnit = Math.abs(total - linesLength) < 1e-6; // count en flottants
  const isSegmentUnit = Math.abs(total - segmentCount) < 1e-6; // count en segments
  for (const group of groups) {
    if (isFloatUnit) {
      const first = Math.floor(group.start / 6);
      const count = Math.floor(group.count / 6);
      for (let i = 0; i < count; i += 1) if (first + i < segmentCount) edgeIds[first + i] = group.edgeId;
    } else if (isSegmentUnit) {
      for (let i = 0; i < group.count; i += 1) if (group.start + i < segmentCount) edgeIds[group.start + i] = group.edgeId;
    } else {
      const first = Math.floor(group.start / 6);
      const count = Math.max(1, Math.floor(group.count / 6));
      for (let i = 0; i < count; i += 1) if (first + i < segmentCount) edgeIds[first + i] = group.edgeId;
    }
  }
  return edgeIds;
}

export function tessellate(shape: AnyShape, quality: TessellationQuality = QUALITY.final): MeshPayload {
  const raw = shape.mesh({ tolerance: quality.tolerance, angularTolerance: quality.angularTolerance });
  const positions = Float32Array.from(raw.vertices) as Float32Array<ArrayBufferLike>;
  const indices = Uint32Array.from(raw.triangles) as Uint32Array<ArrayBufferLike>;
  const normals = Float32Array.from(raw.normals ?? []) as Float32Array<ArrayBufferLike>;
  const triangleCount = indices.length / 3;
  const faceIds = fillFaceIds(triangleCount, raw.faceGroups as FaceGroupLike[] | undefined) as Uint32Array<ArrayBufferLike>;

  let edgeLines = new Float32Array(0) as Float32Array<ArrayBufferLike>;
  let edgeIds = new Uint32Array(0) as Uint32Array<ArrayBufferLike>;
  try {
    const rawEdges = shape.meshEdges({ tolerance: quality.tolerance }) as unknown as {
      lines: number[] | Float32Array;
      edgeGroups?: EdgeGroupLike[];
    };
    edgeLines = Float32Array.from(rawEdges.lines ?? []) as Float32Array<ArrayBufferLike>;
    edgeIds = fillEdgeIds(edgeLines.length / 6, edgeLines.length, rawEdges.edgeGroups) as Uint32Array<ArrayBufferLike>;
  } catch {
    /* certaines formes n'exposent pas d'arêtes : la vue 3D s'en passe */
  }

  let bbox: MeshPayload["bbox"] = { min: [0, 0, 0], max: [0, 0, 0] };
  try {
    const bounds = shape.boundingBox.bounds as unknown as [[number, number, number], [number, number, number]];
    bbox = { min: bounds[0], max: bounds[1] };
  } catch {
    /* ignore */
  }

  return { positions, normals, indices, faceIds, edgeLines, edgeIds, bbox, triangleCount };
}

export function emptyMesh(): MeshPayload {
  return {
    positions: new Float32Array(0) as Float32Array<ArrayBufferLike>,
    normals: new Float32Array(0) as Float32Array<ArrayBufferLike>,
    indices: new Uint32Array(0) as Uint32Array<ArrayBufferLike>,
    faceIds: new Uint32Array(0) as Uint32Array<ArrayBufferLike>,
    edgeLines: new Float32Array(0) as Float32Array<ArrayBufferLike>,
    edgeIds: new Uint32Array(0) as Uint32Array<ArrayBufferLike>,
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    triangleCount: 0,
  };
}
