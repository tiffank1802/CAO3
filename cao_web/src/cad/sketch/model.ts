/**
 * Fabrique d'entités d'esquisse : création des géométries et des contraintes
 * qu'un utilisateur de SolidWorks attend par défaut (contraintes « implicites »).
 *
 * Exemple : le rectangle par centre crée 4 lignes, 2 horizontales, 2 verticales,
 * 2 cotes (largeur/hauteur) et 1 symétrie par rapport à l'origine ⇒ esquisse
 * entièrement contrainte (dof = 0) tout en restant indépendante (aucune redondance).
 */
import { newId } from "../core/ids";
import type {
  ConstraintKind,
  DimensionKind,
  SketchConstraint,
  SketchData,
  SketchDimension,
  Vec2,
} from "../core/types";
import type { SolveResult } from "../kernel/protocol";

export interface RectangleResult {
  pointIds: [string, string, string, string];
  lineIds: [string, string, string, string];
  dimensionIds: string[];
  constraints: string[];
}

export function addPoint(sketch: SketchData, x: number, y: number, fixed = false): string {
  const id = newId("p");
  sketch.points.push(fixed ? { id, x, y, fixed: true } : { id, x, y });
  return id;
}

export function addLine(sketch: SketchData, p1: string, p2: string, construction = false): string {
  const id = newId("l");
  sketch.entities.push(construction ? { id, kind: "line", p1, p2, construction: true } : { id, kind: "line", p1, p2 });
  return id;
}

export function addCircle(sketch: SketchData, centerId: string, radius: number): string {
  const id = newId("c");
  sketch.entities.push({ id, kind: "circle", center: centerId, radius });
  return id;
}

export function addConstraint(sketch: SketchData, kind: ConstraintKind, refs: Partial<SketchConstraint>): string {
  const id = newId("k");
  sketch.constraints.push({ id, kind, ...refs });
  return id;
}

export function addDimension(sketch: SketchData, kind: DimensionKind, refs: Partial<SketchDimension>, value: number, driving = true): string {
  const id = newId("d");
  sketch.dimensions.push({ id, kind, ...refs, value, driving });
  return id;
}

/** Point existant proche de la position donnée (accrochage), sinon null. */
export function findPointNear(sketch: SketchData, position: Vec2, tolerance: number): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const point of sketch.points) {
    const distance = Math.hypot(point.x - position.x, point.y - position.y);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { id: point.id, distance };
  }
  return best?.id ?? null;
}

export function addRectangleCentered(sketch: SketchData, center: Vec2, width: number, height: number): RectangleResult {
  const hw = width / 2;
  const hh = height / 2;
  const p0 = addPoint(sketch, center.x - hw, center.y - hh);
  const p1 = addPoint(sketch, center.x + hw, center.y - hh);
  const p2 = addPoint(sketch, center.x + hw, center.y + hh);
  const p3 = addPoint(sketch, center.x - hw, center.y + hh);

  const l0 = addLine(sketch, p0, p1);
  const l1 = addLine(sketch, p1, p2);
  const l2 = addLine(sketch, p2, p3);
  const l3 = addLine(sketch, p3, p0);

  const constraints: string[] = [];
  constraints.push(addConstraint(sketch, "horizontal", { lines: [l0] }));
  constraints.push(addConstraint(sketch, "horizontal", { lines: [l2] }));
  constraints.push(addConstraint(sketch, "vertical", { lines: [l1] }));
  constraints.push(addConstraint(sketch, "vertical", { lines: [l3] }));

  const dimensionIds: string[] = [];
  dimensionIds.push(addDimension(sketch, "distance", { points: [p0, p1] }, width));
  dimensionIds.push(addDimension(sketch, "distance", { points: [p1, p2] }, height));

  if (Math.abs(center.x) < 1e-9 && Math.abs(center.y) < 1e-9) {
    // Centré sur l'origine de l'esquisse : symétrie (2 équations) ⇒ dof = 0.
    constraints.push(addConstraint(sketch, "symmetric", { points: [p0, p2, sketch.originId] }));
  }

  return {
    pointIds: [p0, p1, p2, p3],
    lineIds: [l0, l1, l2, l3],
    dimensionIds,
    constraints,
  };
}

export function addRectangleFromCorners(sketch: SketchData, first: Vec2, second: Vec2, firstPointId?: string | null): RectangleResult {
  const minX = Math.min(first.x, second.x);
  const maxX = Math.max(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxY = Math.max(first.y, second.y);

  const p0 = firstPointId ?? addPoint(sketch, minX, minY);
  const p1 = addPoint(sketch, maxX, minY);
  const p2 = addPoint(sketch, maxX, maxY);
  const p3 = addPoint(sketch, minX, maxY);

  const l0 = addLine(sketch, p0, p1);
  const l1 = addLine(sketch, p1, p2);
  const l2 = addLine(sketch, p2, p3);
  const l3 = addLine(sketch, p3, p0);

  const constraints: string[] = [
    addConstraint(sketch, "horizontal", { lines: [l0] }),
    addConstraint(sketch, "horizontal", { lines: [l2] }),
    addConstraint(sketch, "vertical", { lines: [l1] }),
    addConstraint(sketch, "vertical", { lines: [l3] }),
  ];
  const dimensionIds: string[] = [
    addDimension(sketch, "distance", { points: [p0, p1] }, Math.abs(second.x - first.x)),
    addDimension(sketch, "distance", { points: [p1, p2] }, Math.abs(second.y - first.y)),
  ];
  return { pointIds: [p0, p1, p2, p3], lineIds: [l0, l1, l2, l3], dimensionIds, constraints };
}

export function addCircleAt(sketch: SketchData, center: Vec2, radius: number, centerPointId?: string | null): { centerId: string; circleId: string; radiusDimensionId: string } {
  const centerId = centerPointId ?? addPoint(sketch, center.x, center.y);
  const circleId = addCircle(sketch, centerId, radius);
  const radiusDimensionId = addDimension(sketch, "radius", { circle: circleId }, radius);
  return { centerId, circleId, radiusDimensionId };
}

export function addLineEntity(sketch: SketchData, from: Vec2, to: Vec2, fromPointId?: string | null, toPointId?: string | null): { lineId: string; p1: string; p2: string } {
  const p1 = fromPointId ?? addPoint(sketch, from.x, from.y);
  const p2 = toPointId ?? addPoint(sketch, to.x, to.y);
  const lineId = addLine(sketch, p1, p2);
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  // Contraintes implicites : presque horizontal / vertical (comme l'inférence SolidWorks).
  if (dy < 1e-6 || dx > 12 * dy) addConstraint(sketch, "horizontal", { lines: [lineId] });
  else if (dx < 1e-6 || dy > 12 * dx) addConstraint(sketch, "vertical", { lines: [lineId] });
  return { lineId, p1, p2 };
}

/** Applique la solution du solveur au modèle d'esquisse. */
export function applySolveResult(sketch: SketchData, result: SolveResult): void {
  for (const point of sketch.points) {
    const solved = result.points[point.id];
    if (solved) {
      point.x = solved.x;
      point.y = solved.y;
    }
  }
  for (const entity of sketch.entities) {
    if (entity.kind === "circle") {
      const radius = result.radii[entity.id];
      if (typeof radius === "number" && radius > 0) entity.radius = radius;
    }
  }
}

export function sketchPoint(sketch: SketchData, id: string) {
  return sketch.points.find((p) => p.id === id);
}

export function sketchBounds(sketch: SketchData): { min: Vec2; max: Vec2 } {
  const xs = sketch.points.map((p) => p.x);
  const ys = sketch.points.map((p) => p.y);
  for (const entity of sketch.entities) {
    if (entity.kind === "circle") {
      const center = sketchPoint(sketch, entity.center);
      if (center) {
        xs.push(center.x - entity.radius, center.x + entity.radius);
        ys.push(center.y - entity.radius, center.y + entity.radius);
      }
    }
  }
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}
