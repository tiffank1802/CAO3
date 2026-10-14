/**
 * Initialisation du noyau OpenCascade. Utilisé par le worker (navigateur) et par les
 * tests Node, ce qui garantit que la même séquence est éprouvée des deux côtés.
 */
import initOpenCascade from "replicad-opencascadejs";
import { setOC } from "replicad";

export interface KernelInitInfo {
  version: string;
  ms: number;
}

export const KERNEL_VERSION = "OpenCascade WASM · replicad 1.1.0";

export async function initKernel(locateFile?: (fileName: string) => string): Promise<KernelInitInfo> {
  const started = performance.now();
  const oc = await initOpenCascade(locateFile ? { locateFile } : undefined);
  setOC(oc as never);
  return { version: KERNEL_VERSION, ms: performance.now() - started };
}
