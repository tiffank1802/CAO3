/**
 * Initialisation du noyau OpenCascade. Utilisé par le worker (navigateur) et par les
 * tests Node, ce qui garantit que la même séquence est éprouvée des deux côtés.
 *
 * Deux façons de fournir le WebAssembly :
 *  - `locateFile` : Emscripten va le chercher lui-même à l'URL indiquée ;
 *  - `wasmBinary` : les octets sont déjà en mémoire (cas du cache local — voir `wasmCache.ts`),
 *    donc **aucune requête réseau** supplémentaire.
 */
import initOpenCascade from "replicad-opencascadejs";
import { setOC } from "replicad";

export interface KernelInitInfo {
  version: string;
  ms: number;
  /** Taille du tas WebAssembly (la mémoire du noyau, celle qu'il faut surveiller). */
  heapBytes: number | null;
}

export interface KernelInitOptions {
  locateFile?: (fileName: string) => string;
  wasmBinary?: ArrayBuffer;
}

export const KERNEL_VERSION = "OpenCascade WASM · replicad 1.1.0";

type EmscriptenModule = { wasmMemory?: { buffer: ArrayBuffer } };

let ocModule: EmscriptenModule | null = null;

/** Accepte l'ancienne signature (`locateFile` seul) ou un objet d'options complet. */
export async function initKernel(
  options: KernelInitOptions | ((fileName: string) => string) = {},
): Promise<KernelInitInfo> {
  const resolved: KernelInitOptions = typeof options === "function" ? { locateFile: options } : options;
  const started = performance.now();
  const overrides: Record<string, unknown> = {};
  if (resolved.locateFile) overrides.locateFile = resolved.locateFile;
  if (resolved.wasmBinary) overrides.wasmBinary = resolved.wasmBinary;

  const oc = await initOpenCascade(overrides);
  ocModule = oc as EmscriptenModule;
  setOC(oc as never);
  return { version: KERNEL_VERSION, ms: performance.now() - started, heapBytes: kernelHeapBytes() };
}

/**
 * Mémoire effectivement réservée par le noyau. OpenCascade ne libère jamais son tas
 * vers le système : c'est cette valeur qu'il faut garder sous surveillance.
 */
export function kernelHeapBytes(): number | null {
  const bytes = ocModule?.wasmMemory?.buffer.byteLength;
  return typeof bytes === "number" ? bytes : null;
}
