/**
 * Solveur de contraintes d'esquisse (planegcs — portage WASM de FreeCAD).
 *
 * Le modèle d'esquisse est traduit à la volée, résolu, puis relu :
 *  - les points sont préfixés `pt:` et les entités `ln:`/`ci:` pour éviter toute collision d'identifiants ;
 *  - les cotes et contraintes portent leur identifiant d'origine, ce qui permet
 *    de remonter directement les conflits dans l'interface ;
 *  - le degré de liberté est lu sur le solveur (`dof()`), d'où le statut exact
 *    « entièrement contraint » comme dans SolidWorks.
 */
import { make_gcs_wrapper, type GcsWrapper } from "@salusoft89/planegcs";
import type { SketchConstraint, SketchData, SketchDimension } from "../core/types";
import type { SolveResult } from "./protocol";

const P = (id: string) => `pt:${id}`;
const L = (id: string) => `ln:${id}`;
const C = (id: string) => `ci:${id}`;
const strip = (id: string) => id.replace(/^(pt:|ln:|ci:|c:|d:)/, "");

let wrapper: GcsWrapper | null = null;

export async function ensureSolver(wasmUrl?: string): Promise<void> {
  if (!wrapper) wrapper = await make_gcs_wrapper(wasmUrl);
}

export function isSolverReady(): boolean {
  return wrapper !== null;
}

export function resetSolverForTests(): void {
  wrapper = null;
}

interface GcsPrimitive {
  type: string;
  id: string;
  [key: string]: unknown;
}

function constraintToGcs(constraint: SketchConstraint): GcsPrimitive | null {
  const line = (index = 0) => L(constraint.lines?.[index] ?? "");
  const point = (index = 0) => P(constraint.points?.[index] ?? "");
  const circle = (index = 0) => C(constraint.circles?.[index] ?? "");
  const base = { id: `c:${constraint.id}` };
  switch (constraint.kind) {
    case "coincident":
      return { ...base, type: "p2p_coincident", p1_id: point(0), p2_id: point(1) };
    case "horizontal":
      return { ...base, type: "horizontal_l", l_id: line(0) };
    case "vertical":
      return { ...base, type: "vertical_l", l_id: line(0) };
    case "parallel":
      return { ...base, type: "parallel", l1_id: line(0), l2_id: line(1) };
    case "perpendicular":
      return { ...base, type: "perpendicular_ll", l1_id: line(0), l2_id: line(1) };
    case "tangent":
      if (constraint.circles?.length && constraint.circles.length >= 2) {
        return { ...base, type: "tangent_cc", c1_id: circle(0), c2_id: circle(1) };
      }
      return { ...base, type: "tangent_lc", l_id: line(0), c_id: circle(0) };
    case "concentric":
      return { ...base, type: "p2p_coincident", p1_id: point(0), p2_id: point(1) };
    case "equal":
      if (constraint.circles?.length && constraint.circles.length >= 2) {
        return { ...base, type: "equal_radius_cc", c1_id: circle(0), c2_id: circle(1) };
      }
      return { ...base, type: "equal_length", l1_id: line(0), l2_id: line(1) };
    case "symmetric":
      if (constraint.lines?.length) {
        return { ...base, type: "p2p_symmetric_ppl", p1_id: point(0), p2_id: point(1), l_id: line(0) };
      }
      return { ...base, type: "p2p_symmetric_ppp", p1_id: point(0), p2_id: point(1), p_id: point(2) };
    case "fix":
      return null; // traité via le drapeau `fixed` du point
    case "midpoint":
      // Non supporté en v0 : nécessite une contrainte d'égalité de distances (voir plan, lot 1 bis).
      return null;
    default:
      return null;
  }
}

function dimensionToGcs(dimension: SketchDimension): GcsPrimitive | null {
  const base = { id: `d:${dimension.id}`, driving: dimension.driving };
  const point = (index = 0) => P(dimension.points?.[index] ?? "");
  switch (dimension.kind) {
    case "distance":
      return { ...base, type: "p2p_distance", p1_id: point(0), p2_id: point(1), distance: dimension.value };
    case "length":
      return { ...base, type: "p2p_distance", p1_id: point(0), p2_id: point(1), distance: dimension.value };
    case "radius":
      return { ...base, type: "circle_radius", c_id: C(dimension.circle ?? ""), radius: dimension.value };
    case "diameter":
      return { ...base, type: "circle_diameter", c_id: C(dimension.circle ?? ""), diameter: dimension.value };
    case "angle":
      return {
        ...base,
        type: "l2l_angle_ll",
        l1_id: L(dimension.lines?.[0] ?? ""),
        l2_id: L(dimension.lines?.[1] ?? ""),
        angle: dimension.value,
      };
    case "coordX":
      return { ...base, type: "coordinate_x", p_id: point(0), x: dimension.value };
    case "coordY":
      return { ...base, type: "coordinate_y", p_id: point(0), y: dimension.value };
    default:
      return null;
  }
}

/**
 * Résout l'esquisse et renvoie les coordonnées corrigées.
 * Le solveur réutilise la même instance : on efface les données à chaque appel.
 */
export function solveSketch(sketch: SketchData): SolveResult {
  if (!wrapper) throw new Error("Solveur non initialisé : appelez ensureSolver() avant solveSketch().");
  const solver = wrapper;
  const started = performance.now();
  solver.clear_data();

  const primitives: GcsPrimitive[] = [];
  for (const point of sketch.points) {
    primitives.push({ type: "point", id: P(point.id), x: point.x, y: point.y, fixed: !!point.fixed });
  }
  for (const entity of sketch.entities) {
    if (entity.kind === "line") {
      primitives.push({ type: "line", id: L(entity.id), p1_id: P(entity.p1), p2_id: P(entity.p2) });
    } else {
      primitives.push({ type: "circle", id: C(entity.id), c_id: P(entity.center), radius: entity.radius });
    }
  }
  for (const constraint of sketch.constraints) {
    const mapped = constraintToGcs(constraint);
    if (mapped) primitives.push(mapped);
  }
  for (const dimension of sketch.dimensions) {
    const mapped = dimensionToGcs(dimension);
    if (mapped) primitives.push(mapped);
  }

  solver.push_primitives_and_params(primitives as never);
  const status = solver.solve() as unknown as number;
  solver.apply_solution();

  const points: Record<string, { x: number; y: number }> = {};
  const radii: Record<string, number> = {};
  for (const primitive of solver.sketch_index.get_primitives() as unknown as Array<Record<string, unknown>>) {
    if (primitive.type === "point") {
      points[strip(String(primitive.id))] = { x: Number(primitive.x), y: Number(primitive.y) };
    } else if (primitive.type === "circle") {
      radii[strip(String(primitive.id))] = Number(primitive.radius);
    }
  }

  let dof = -1;
  try {
    dof = (solver.gcs as unknown as { dof: () => number }).dof();
  } catch {
    dof = -1;
  }

  const conflicts = (solver.get_gcs_conflicting_constraints() ?? []).map(strip);
  const redundant = (solver.get_gcs_redundant_constraints() ?? []).map(strip);

  return { points, radii, status, dof, conflicts, redundant, ms: performance.now() - started };
}
