/**
 * Conversion du modèle d'esquisse (lignes / cercles + points) en géométrie 2D replicad.
 *
 * Stratégie : constituer les boucles fermées (chaînage par points partagés),
 * classifier par emboîtement (une boucle contenue dans une autre est un perçage),
 * puis assembler un `Drawing` : fusion des contours extérieurs − perçages.
 */
import * as R from "replicad";
import type { Drawing } from "replicad";
import type { SketchData, SketchEntity } from "../../core/types";

export interface Loop {
  entityIds: string[];
  kind: "polygon" | "circle";
  /** Sommets dans l'ordre (polygone fermé implicitement). */
  polygon?: Array<[number, number]>;
  circle?: { center: [number, number]; radius: number };
  /** Point représentatif à l'intérieur de la boucle (test d'emboîtement). */
  sample: [number, number];
}

export class OpenProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenProfileError";
  }
}

export function findLoops(sketch: SketchData): Loop[] {
  const loops: Loop[] = [];
  const points = new Map(sketch.points.map((p) => [p.id, p]));
  const lines = sketch.entities.filter(
    (e): e is Extract<SketchEntity, { kind: "line" }> => e.kind === "line" && !e.construction,
  );
  const circles = sketch.entities.filter(
    (e): e is Extract<SketchEntity, { kind: "circle" }> => e.kind === "circle" && !e.construction,
  );

  const used = new Set<string>();
  for (const start of lines) {
    if (used.has(start.id)) continue;
    const headId = start.p1;
    let tailId = start.p2;
    const chain = [start];
    used.add(start.id);

    let guard = 0;
    while (tailId !== headId) {
      const next = lines.find((l) => !used.has(l.id) && (l.p1 === tailId || l.p2 === tailId));
      if (!next) {
        throw new OpenProfileError(
          "Profil ouvert : les lignes de l'esquisse ne forment pas une boucle fermée (rognez, prolongez ou contraignez les extrémités).",
        );
      }
      used.add(next.id);
      chain.push(next);
      tailId = next.p1 === tailId ? next.p2 : next.p1;
      if (guard++ > lines.length + 1) throw new OpenProfileError("Profil invalide : boucle non résolue.");
    }

    let cursorId = headId;
    const polygon: Array<[number, number]> = [];
    for (const edge of chain) {
      const point = points.get(cursorId);
      if (!point) throw new OpenProfileError("Profil invalide : point d'esquisse manquant.");
      polygon.push([point.x, point.y]);
      cursorId = edge.p1 === cursorId ? edge.p2 : edge.p1;
    }
    if (polygon.length < 3) throw new OpenProfileError("Profil invalide : moins de trois sommets.");

    loops.push({
      entityIds: chain.map((e) => e.id),
      kind: "polygon",
      polygon,
      sample: polygonCentroid(polygon),
    });
  }

  for (const circle of circles) {
    const center = points.get(circle.center);
    if (!center) throw new OpenProfileError("Cercle invalide : centre manquant.");
    loops.push({
      entityIds: [circle.id],
      kind: "circle",
      circle: { center: [center.x, center.y], radius: circle.radius },
      sample: [center.x, center.y],
    });
  }

  return loops;
}

function polygonCentroid(points: Array<[number, number]>): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function loopContains(outer: Loop, point: [number, number]): boolean {
  if (outer.kind === "circle" && outer.circle) {
    const [cx, cy] = outer.circle.center;
    const d = Math.hypot(point[0] - cx, point[1] - cy);
    return d < outer.circle.radius * 0.999;
  }
  return outer.polygon ? pointInPolygon(point, outer.polygon) : false;
}

function loopToDrawing(loop: Loop): Drawing {
  if (loop.kind === "circle" && loop.circle) {
    return R.drawCircle(loop.circle.radius).translate(loop.circle.center[0], loop.circle.center[1]);
  }
  const pts = loop.polygon ?? [];
  let pen = R.draw([pts[0][0], pts[0][1]]);
  for (let i = 1; i < pts.length; i += 1) pen = pen.lineTo([pts[i][0], pts[i][1]]);
  return pen.close();
}

/**
 * Construit le `Drawing` exploitable par le noyau (extrusion, révolution…).
 * Les boucles non contenues dans une autre sont des contours ; les autres des perçages.
 */
export function sketchToDrawing(sketch: SketchData): Drawing {
  const loops = findLoops(sketch);
  if (loops.length === 0) throw new OpenProfileError("Esquisse vide : dessinez un contour (rectangle, cercle, lignes fermées).");

  const outers: Loop[] = [];
  const holes: Loop[] = [];
  for (const loop of loops) {
    const contained = loops.some((other) => other !== loop && loopContains(other, loop.sample));
    (contained ? holes : outers).push(loop);
  }

  const outerDrawings = outers.map(loopToDrawing);
  let result = outerDrawings[0];
  for (const extra of outerDrawings.slice(1)) result = result.fuse(extra);
  for (const hole of holes) result = result.cut(loopToDrawing(hole));
  return result;
}

/** Nombre de perçages implicites (boucles intérieures). */
export function countHoles(sketch: SketchData): number {
  const loops = findLoops(sketch);
  return loops.filter((loop) => loops.some((other) => other !== loop && loopContains(other, loop.sample))).length;
}
