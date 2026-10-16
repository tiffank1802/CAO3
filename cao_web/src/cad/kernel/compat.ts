/**
 * Couche de compatibilité avec le noyau OpenCascade/replicad.
 *
 * ⚠️ TOUS les appels sensibles passent par ici (principe P3 du plan).
 * Constats vérifiés lors du spike du 2026-10-14 (voir SPIKE_REPLICAD_FINDINGS.md §3) :
 *   - `R.loft(sketches)` échoue dans 1.1.0 (AddWire : signature invalide) → `sketch.loftWith()`
 *   - `shape.draft()` échoue dans 1.1.0                                     → profil d'extrusion / lissage
 *   - `fillet([r1, r2, ...])` (tableau de rayons) échoue                   → callback par arête
 *   - `cut(tool)` n'accepte pas de tableau                                 → `makeCompound()`
 *   - `makeBox(corner1, corner2)` attend DEUX POINTS 3D : passer trois nombres
 *     (largeur, profondeur, hauteur) lève une exception WASM sans message   → `boxSafe()`
 * En revanche, `fuse`, `cut`, `intersect` et les exceptions attrapées se comportent
 * normalement (vérifié) : aucune reprise sur état corrompu n'est nécessaire.
 */
import * as R from "replicad";
import type { AnyShape, Shape3D, Sketch } from "replicad";

export type Vec3 = [number, number, number];

/** Boîte centrée construite par ses deux coins (l'API à un seul argument numérique n'existe pas). */
export function boxSafe(width: number, depth: number, height: number, center: Vec3 = [0, 0, 0]): Shape3D {
  const half: Vec3 = [width / 2, depth / 2, height / 2];
  const box = R.makeBox([-half[0], -half[1], -half[2]], [half[0], half[1], half[2]]);
  const shifted = center.some((v) => v !== 0) ? box.translate(center as never) : box;
  return shifted as unknown as Shape3D;
}

/** Boîte entre deux coins quelconques (comme « Rectangle par 2 coins » en 3D). */
export function boxBetween(corner1: Vec3, corner2: Vec3): Shape3D {
  return R.makeBox(corner1, corner2) as unknown as Shape3D;
}

/** Intersection : appel natif vérifié, repli sur A − (A − B) si le noyau refuse. */
export function intersectSafe(a: Shape3D, b: Shape3D): Shape3D {
  try {
    return a.intersect(b) as unknown as Shape3D;
  } catch {
    return a.cut(a.cut(b)) as unknown as Shape3D;
  }
}

/** Coupe par un ensemble d'outils : un seul booléen sur un Compound (100× plus rapide). */
export function cutMany(shape: Shape3D, tools: Shape3D[]): Shape3D {
  if (tools.length === 0) return shape;
  if (tools.length === 1) return shape.cut(tools[0]) as unknown as Shape3D;
  return shape.cut(R.makeCompound(tools) as never) as unknown as Shape3D;
}

/** Fusion d'un ensemble de formes. */
export function fuseMany(shapes: Shape3D[]): Shape3D {
  if (shapes.length === 0) throw new Error("fuseMany : aucune forme");
  if (shapes.length === 1) return shapes[0];
  return shapes[0].fuse(R.makeCompound(shapes.slice(1)) as never) as unknown as Shape3D;
}

/**
 * Fusion tolérante : si les corps sont disjoints, `fuse` peut échouer (spike §3) ;
 * on retombe alors sur un Compound (les corps restent distincts mais valides).
 */
export function fuseOrCompound(a: Shape3D, b: Shape3D): { shape: Shape3D; warning?: string } {
  try {
    return { shape: a.fuse(b) as unknown as Shape3D };
  } catch {
    try {
      return {
        shape: R.makeCompound([a, b]) as unknown as Shape3D,
        warning: "Corps disjoints : résultat conservé sous forme de compound (fusion impossible).",
      };
    } catch (error) {
      throw new Error(`Fusion impossible : ${String(error)}`);
    }
  }
}

/** Lissage : toujours via loftWith (jamais R.loft). */
export function loftSafe(sketches: Sketch[], ruled = false): Shape3D {
  if (sketches.length < 2) throw new Error("Lissage : il faut au moins deux sections.");
  const [first, ...rest] = sketches;
  return first.loftWith(rest, { ruled }) as unknown as Shape3D;
}

/**
 * Facteur de mise à l'échelle par direction pour une dépouille donnée sur une
 * extrusion de hauteur h partant d'un profil de largeur w :
 *   x' = x + h·tan(θ) de chaque côté  ⇒  facteur = 1 + 2·h·tan(θ)/w
 */
export function draftScaleFactors(width: number, depth: number, height: number, angleDeg: number) {
  const t = Math.tan((Math.abs(angleDeg) * Math.PI) / 180);
  const grow = (size: number) => (size > 1e-6 ? 1 + (2 * height * t) / size : 1);
  return { fx: grow(width), fy: grow(depth) };
}

/** Extraction d'une forme 3D « propre » depuis un résultat quelconque. */
export function asShape3D(shape: AnyShape | null | undefined): Shape3D | null {
  if (!shape) return null;
  return shape as unknown as Shape3D;
}
