/// <reference lib="webworker" />
/**
 * Worker du noyau : c'est ICI que vit OpenCascade (principe P2).
 * Aucune exception ne doit remonter au thread UI : on répond toujours,
 * et une erreur fatale demande au client de redémarrer le worker (principe P6).
 */
import ocWasmUrl from "replicad-opencascadejs/wasm?url";
import { initKernel } from "./init";
import { exportDocument, rebuildDocument } from "./rebuild";
import type { KernelRequest, KernelResponse } from "./protocol";

let kernelReady = false;

function post(response: KernelResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(response, transfer);
}

async function handle(request: KernelRequest): Promise<{ response: KernelResponse; transfer: Transferable[] }> {
  switch (request.kind) {
    case "init": {
      const info = await initKernel(() => ocWasmUrl);
      kernelReady = true;
      return { response: { id: request.id, ok: true, kind: "init", version: info.version, ms: info.ms }, transfer: [] };
    }
    case "ping":
      return { response: { id: request.id, ok: true, kind: "ping", ms: performance.now() }, transfer: [] };
    case "rebuild": {
      if (!kernelReady) throw new Error("Noyau non initialisé.");
      const result = rebuildDocument(request.document, request.revision, request.quality);
      const mesh = result.mesh;
      const transfer: Transferable[] = mesh
        ? [
            mesh.positions.buffer,
            mesh.normals.buffer,
            mesh.indices.buffer,
            mesh.faceIds.buffer,
            mesh.edgeLines.buffer,
            mesh.edgeIds.buffer,
          ]
        : [];
      return { response: { id: request.id, ok: true, kind: "rebuild", result }, transfer };
    }
    case "export": {
      if (!kernelReady) throw new Error("Noyau non initialisé.");
      const result = await exportDocument(request.document, request.format);
      return { response: { id: request.id, ok: true, kind: "export", result }, transfer: [result.data.buffer] };
    }
    default:
      throw new Error(`Requête inconnue : ${JSON.stringify(request)}`);
  }
}

self.onmessage = async (event: MessageEvent<KernelRequest>) => {
  const request = event.data;
  try {
    const { response, transfer } = await handle(request);
    post(response, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ id: request.id, ok: false, kind: request.kind, error: message, fatal: true });
  }
};
