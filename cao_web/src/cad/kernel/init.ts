/**
 * Initialisation du noyau OpenCascade. Utilisé par le worker (navigateur) et par les
 * tests Node, ce qui garantit que la même séquence est éprouvée des deux côtés.
 */
import initOpenCascade from "replicad-opencascadejs";
import { setOC } from "replicad";

export interface KernelInitInfo {
  version: string;
  ms: number;
  /** Taille du tas WebAssembly (la mémoire du noyau, celle qu'il faut surveiller). */
  heapBytes: number | null;
}

export const KERNEL_VERSION = "OpenCascade WASM · replicad 1.1.0";

type EmscriptenModule = { wasmMemory?: { buffer: ArrayBuffer } };

let ocModule: EmscriptenModule | null = null;

export async function initKernel(locateFile?: (fileName: string) => string): Promise<KernelInitInfo> {
  const started = performance.now();
  const oc = await initOpenCascade(locateFile ? { locateFile } : undefined);
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
