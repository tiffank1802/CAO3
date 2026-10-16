/**
 * Modèle documentaire — la source de vérité (§4 du plan).
 *
 * Règles :
 *  - tout objet a un identifiant stable et sérialisable ;
 *  - aucune donnée issue d'OpenCascade (hashCode, pointeur) n'est persistée ;
 *  - la géométrie 3D est reconstruite depuis ce document par le worker noyau.
 */

export type Unit = "mm" | "cm" | "in";
export type PlaneName = "XY" | "XZ" | "YZ";

export interface Vec2 {
  x: number;
  y: number;
}

// --------------------------------------------------------------------------- esquisse

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  /** Point ancré : le solveur ne le déplace pas. */
  fixed?: boolean;
}

export type SketchEntity =
  | { id: string; kind: "line"; p1: string; p2: string; construction?: boolean }
  | { id: string; kind: "circle"; center: string; radius: number; construction?: boolean };

export type ConstraintKind =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "concentric"
  | "equal"
  | "symmetric"
  | "midpoint"
  | "fix";

export interface SketchConstraint {
  id: string;
  kind: ConstraintKind;
  points?: string[];
  lines?: string[];
  circles?: string[];
}

export type DimensionKind = "distance" | "length" | "radius" | "diameter" | "angle" | "coordX" | "coordY";

export interface SketchDimension {
  id: string;
  kind: DimensionKind;
  points?: string[];
  line?: string;
  lines?: string[];
  circle?: string;
  value: number;
  /** false = cote de référence (pilotée par la géométrie, non pilotante). */
  driving: boolean;
}

export interface SketchPlaneRef {
  kind: "base";
  name: PlaneName;
  offset: number;
}

export interface SketchData {
  plane: SketchPlaneRef;
  /** Point d'origine de l'esquisse (toujours fixe) : socle des symétries. */
  originId: string;
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  dimensions: SketchDimension[];
  /** Pas d'accrochage en mm. */
  gridStep: number;
}

// --------------------------------------------------------------------------- fonctions

export type FeatureOperation = "newBody" | "fuse" | "cut" | "intersect";

export type ExtrudeEndKind = "blind" | "symmetric" | "throughAll";

export interface ExtrudeEnd {
  kind: ExtrudeEndKind;
  depth: number;
  reverse: boolean;
  /** Dépouille en degrés (0 = pas de dépouille). */
  draftAngle: number;
}

export interface SketchFeature {
  id: string;
  type: "sketch";
  name: string;
  suppressed: boolean;
  sketch: SketchData;
}

export interface ExtrudeFeature {
  id: string;
  type: "extrude";
  name: string;
  suppressed: boolean;
  /** Identifiant de la fonction d'esquisse consommée. */
  profileId: string;
  end: ExtrudeEnd;
  operation: FeatureOperation;
}

export type Feature = SketchFeature | ExtrudeFeature;

export interface CadDocument {
  schema: "cao3/document@1";
  id: string;
  name: string;
  units: { length: Unit; decimals: number };
  features: Feature[];
}

// --------------------------------------------------------------------------- utilitaires

export function isSketchFeature(f: Feature | undefined): f is SketchFeature {
  return !!f && f.type === "sketch";
}

export function isExtrudeFeature(f: Feature | undefined): f is ExtrudeFeature {
  return !!f && f.type === "extrude";
}

export function findFeature(doc: CadDocument, id: string | null | undefined): Feature | undefined {
  if (!id) return undefined;
  return doc.features.find((f) => f.id === id);
}

export function findSketch(doc: CadDocument, id: string | null | undefined): SketchFeature | undefined {
  const f = findFeature(doc, id);
  return isSketchFeature(f) ? f : undefined;
}

export const ENTITY_LABELS: Record<Feature["type"], string> = {
  sketch: "Esquisse",
  extrude: "Bossage/Extrusion",
};
