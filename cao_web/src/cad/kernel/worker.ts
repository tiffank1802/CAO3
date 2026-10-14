/// <reference lib="webworker" />
/**
 * Worker du noyau : c'est ICI que vit OpenCascade (principe P2).
 * Aucune exception ne doit remonter au thread UI : on répond toujours,
 * et une erreur fatale demande au client de redémarrer le worker (principe P6).
 */
import ocWasmUrl from "replicad-opencascadejs/wasm?url";
import { initKernel } from "./init";
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

/**
 * Récupère le WASM en streaming pour afficher une progression réelle, puis le présente à
 * Emscripten par une URL `blob:` (la mémoire est libérée dès l'initialisation terminée).
 * En cas d'échec (CSP, absence de flux), on retombe simplement sur l'URL d'origine : le
 * noyau doit toujours pouvoir démarrer, la progression est un confort, pas une condition.
 */
async function wasmSource(url: string): Promise<{ url: string; release: () => void }> {
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const header = response.headers.get("content-length");
    const total = header ? Number(header) : null;
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    let lastReported = -1 << 30;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value as unknown as BlobPart);
      loaded += value.byteLength;
      if (loaded - lastReported >= 256 * 1024) {
        lastReported = loaded;
        reportProgress("téléchargement du noyau", loaded, total);
      }
    }
    reportProgress("téléchargement du noyau", loaded, total);
    const objectUrl = URL.createObjectURL(new Blob(chunks, { type: "application/wasm" }));
    return { url: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
  } catch {
    return { url, release: () => undefined };
  }
}

async function handle(request: KernelRequest): Promise<{ response: KernelResponse; transfer: Transferable[] }> {
  switch (request.kind) {
    case "init": {
      const source = await wasmSource(ocWasmUrl);
      try {
        reportProgress("initialisation d'OpenCascade", 0, null);
        const info = await initKernel(() => source.url);
        kernelReady = true;
        return {
          response: { id: request.id, ok: true, kind: "init", version: info.version, ms: info.ms, heapBytes: info.heapBytes },
          transfer: [],
        };
      } finally {
        source.release();
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
