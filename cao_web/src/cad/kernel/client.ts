/**
 * Client du worker noyau (thread UI).
 * - promesses typées, aucune fuite d'API worker dans l'interface ;
 * - une seule reconstruction utile à la fois (les demandes obsolètes sont annulées) ;
 * - redémarrage automatique du worker après une erreur fatale (état OC corrompu).
 */
import type { CadDocument } from "../core/types";
import type { ExportResult, KernelProgress, KernelRequest, KernelResponse, RebuildResult } from "./protocol";

export type KernelStatus = "idle" | "loading" | "ready" | "error" | "restarting";

type StatusListener = (status: KernelStatus, detail?: string) => void;
type ProgressListener = (progress: KernelProgress) => void;

/** Mémoire JavaScript du thread principal (Chrome uniquement) — pour le diagnostic. */
export function jsHeapBytes(): number | null {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
}

export class KernelClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<StatusListener>();
  private progressListeners = new Set<ProgressListener>();
  private status: KernelStatus = "idle";
  private initPromise: Promise<void> | null = null;
  private lastRebuild = 0;
  private restarting: Promise<void> | null = null;
  /**
   * Durée au-delà de laquelle une reconstruction est considérée comme perdue.
   * Un calcul OpenCascade pathologique (des milliers d'arêtes) ne consomme pas seulement
   * du temps : il fait grossir un tas WASM que le navigateur ne récupère jamais. Redémarrer
   * le worker rend toute cette mémoire d'un coup — c'est le garde-fou anti-plantage.
   */
  watchdogMs = 20_000;

  get currentStatus(): KernelStatus {
    return this.status;
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private setStatus(status: KernelStatus, detail?: string): void {
    this.status = status;
    for (const listener of this.listeners) listener(status, detail);
  }

  private spawn(): Worker {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "cao-kernel" });
    worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      const response = event.data;
      if (response.ok && response.kind === "progress") {
        for (const listener of this.progressListeners) listener(response.progress);
        return;
      }
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.ok) {
        entry.resolve(response as never);
      } else {
        entry.reject(new Error(response.error));
      }
    };
    worker.onerror = (event) => {
      const message = event.message || "erreur inconnue du worker noyau";
      this.setStatus("error", message);
      for (const [, entry] of this.pending) entry.reject(new Error(message));
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private send<T>(request: KernelRequest, transfer: Transferable[] = [], timeoutMs = 0): Promise<T> {
    if (!this.worker) throw new Error("Worker noyau non démarré.");
    const worker = this.worker;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? window.setTimeout(() => {
              this.pending.delete(request.id);
              reject(new Error(`Calcul interrompu après ${Math.round(timeoutMs / 1000)} s : mémoire du noyau libérée et redémarrage en cours. Le document est intact — relancez la reconstruction.`));
              void this.restartInBackground();
            }, timeoutMs)
          : null;
      const settle = <F extends (value: never) => void>(fn: F) => ((value: never) => {
        if (timer !== null) window.clearTimeout(timer);
        fn(value);
      }) as F;
      this.pending.set(request.id, { resolve: settle(resolve as (value: never) => void), reject: settle(reject) });
      worker.postMessage(request, transfer);
    });
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.setStatus("loading");
    this.spawn();
    this.initPromise = this.send<{ ms: number }>({ id: ++this.sequence, kind: "init" })
      .then((response) => {
        this.setStatus("ready", `noyau prêt (${Math.round(response.ms)} ms)`);
      })
      .catch((error: Error) => {
        this.setStatus("error", error.message);
        this.initPromise = null;
        throw error;
      });
    return this.initPromise;
  }

  /** Reconstruit le document ; les reconstructions obsolètes sont rejetées proprement. */
  async rebuild(document: CadDocument, quality: "preview" | "final"): Promise<RebuildResult> {
    await this.init();
    const id = ++this.sequence;
    this.lastRebuild = id;
    const response = await this.send<RebuildResult>({ id, kind: "rebuild", document, revision: id, quality }, [], this.watchdogMs);
    if (id !== this.lastRebuild) throw new Error("reconstruction obsolète");
    return response;
  }

  async exportFile(document: CadDocument, format: "step" | "stl"): Promise<ExportResult> {
    await this.init();
    return this.send<ExportResult>({ id: ++this.sequence, kind: "export", document, format });
  }

  /** Redémarre le worker (après une erreur fatale du noyau). */
  async restart(): Promise<void> {
    this.setStatus("restarting");
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.initPromise = null;
    await this.init();
  }

  /** Redémarrage silencieux : le worker fautif est tué et un noyau neuf prend sa place. */
  private restartInBackground(): Promise<void> {
    if (this.restarting) return this.restarting;
    this.restarting = this.restart()
      .catch((error: Error) => this.setStatus("error", error.message))
      .finally(() => {
        this.restarting = null;
      });
    return this.restarting;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.initPromise = null;
    this.setStatus("idle");
  }
}
