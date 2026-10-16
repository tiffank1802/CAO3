/// <reference lib="webworker" />
/**
 * Worker du noyau : c'est ICI que vit OpenCascade (principe P2).
 * Aucune exception ne doit remonter au thread UI : on répond toujours,
 * et une erreur fatale demande au client de redémarrer le worker (principe P6).
 *
 * Le WebAssembly est lu **depuis le cache local** quand il y est déjà (voir `wasmCache.ts`) :
 * un rechargement de page ne coûte alors aucune requête réseau et le noyau redémarre
 * quasi instantanément.
 */
import ocWasmUrl from "replicad-opencascadejs/wasm?url";
import { initKernel } from "./init";
import { loadKernelWasm } from "./wasmCache";
import { exportDocument, rebuildDocument } from "./rebuild";
import type { KernelProgress, KernelRequest, KernelResponse } from "./protocol";

let kernelReady = false;

function post(response: KernelResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(response, transfer);
}

/** Informe l'interface de l'avancement (l'appelant limite la fréquence à 256 Ko). */
function reportProgress(phase: string, loaded: number, total: number | null): void {
  const progress: KernelProgress = { phase, loaded, total, fraction: total ? Math.min(1, loaded / total) : null };
  post({ id: 0, ok: true, kind: "progress", progress });
}

async function handle(request: KernelRequest): Promise<{ response: KernelResponse; transfer: Transferable[] }> {
  switch (request.kind) {
    case "init": {
      let loaded = await loadKernelWasm({
        url: ocWasmUrl,
        forceNetwork: request.forceDownload === true,
        onProgress: (progress) => reportProgress(progress.phase, progress.loaded, progress.total),
      });
      reportProgress("initialisation d'OpenCascade", loaded.bytesLength, loaded.bytesLength);
      try {
        const info = await initKernel({ wasmBinary: loaded.bytes });
        kernelReady = true;
        return {
          response: {
            id: request.id,
            ok: true,
            kind: "init",
            version: info.version,
            ms: info.ms,
            heapBytes: info.heapBytes,
            source: loaded.source,
            bytes: loaded.bytesLength,
            loadMs: loaded.ms,
          },
          transfer: [],
        };
      } finally {
        // Les octets ont été copiés dans la mémoire WebAssembly : on relâche le tampon
        // temporaire (23 Mo) au lieu de le garder pendant toute la session.
        loaded = { ...loaded, bytes: new ArrayBuffer(0) };
      }
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
