/**
 * Protocole RPC entre le thread UI et le worker noyau.
 * Aucun import runtime de replicad ici : ce fichier est importé par l'UI.
 */
import type { CadDocument, SketchData } from "../core/types";

export interface MeshPayload {
  positions: Float32Array<ArrayBufferLike>;
  normals: Float32Array<ArrayBufferLike>;
  indices: Uint32Array<ArrayBufferLike>;
  /** Un identifiant de face par triangle (pont avec le B-Rep pour la sélection). */
  faceIds: Uint32Array<ArrayBufferLike>;
  /** 6 flottants par segment (x1,y1,z1,x2,y2,z2). */
  edgeLines: Float32Array<ArrayBufferLike>;
  /** Un identifiant d'arête par segment. */
  edgeIds: Uint32Array<ArrayBufferLike>;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  triangleCount: number;
}

export type FeatureState =
  | { featureId: string; status: "ok"; ms: number }
  | { featureId: string; status: "warning"; ms: number; warnings: string[] }
  | { featureId: string; status: "error"; ms: number; message: string };

/** Progression du chargement du noyau, remontée du worker vers l'interface. */
export interface KernelProgress {
  phase: string;
  loaded: number;
  total: number | null;
  fraction: number | null;
}

export interface RebuildResult {
  revision: number;
  mesh: MeshPayload | null;
  states: FeatureState[];
  totalMs: number;
  /** Volume en mm³ du corps final (null si aucune géométrie). */
  volume: number | null;
  messages: string[];
  /** Taille du tas WebAssembly d'OpenCascade après reconstruction (octets). */
  heapBytes: number | null;
}

export interface ExportResult {
  format: "step" | "stl";
  data: Uint8Array;
  fileName: string;
  byteLength: number;
}

export interface SolverConflictInfo {
  conflicts: string[];
  redundant: string[];
}

export interface SolveResult {
  points: Record<string, { x: number; y: number }>;
  radii: Record<string, number>;
  status: number;
  dof: number;
  conflicts: string[];
  redundant: string[];
  ms: number;
}

export type KernelRequest =
  | { id: number; kind: "init" }
  | { id: number; kind: "rebuild"; document: CadDocument; revision: number; quality: "preview" | "final" }
  | { id: number; kind: "export"; document: CadDocument; format: "step" | "stl" }
  | { id: number; kind: "ping" };

export type SolverRequest = { id: number; kind: "solve"; sketch: SketchData };

export type KernelResponse =
  | { id: number; ok: true; kind: "progress"; progress: KernelProgress }
  | { id: number; ok: true; kind: "init"; version: string; ms: number; heapBytes: number | null }
  | { id: number; ok: true; kind: "rebuild"; result: RebuildResult }
  | { id: number; ok: true; kind: "export"; result: ExportResult }
  | { id: number; ok: true; kind: "ping"; ms: number }
  | { id: number; ok: false; kind: string; error: string; fatal?: boolean };

export type SolverResponse =
  | { id: number; ok: true; kind: "solve"; result: SolveResult }
  | { id: number; ok: false; kind: "solve"; error: string };
