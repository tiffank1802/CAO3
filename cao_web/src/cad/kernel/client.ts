/**
 * Client du worker noyau (thread UI).
 * - promesses typées, aucune fuite d'API worker dans l'interface ;
 * - une seule reconstruction utile à la fois (les demandes obsolètes sont annulées) ;
 * - redémarrage automatique du worker après une erreur fatale (état OC corrompu).
 */
import type { CadDocument } from "../core/types";
import type { ExportResult, KernelRequest, KernelResponse, RebuildResult } from "./protocol";

export type KernelStatus = "idle" | "loading" | "ready" | "error" | "restarting";

type StatusListener = (status: KernelStatus, detail?: string) => void;

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
}

export class KernelClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<StatusListener>();
  private status: KernelStatus = "idle";
  private initPromise: Promise<void> | null = null;
  private lastRebuild = 0;

  get currentStatus(): KernelStatus {
    return this.status;
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: KernelStatus, detail?: string): void {
    this.status = status;
    for (const listener of this.listeners) listener(status, detail);
  }

  private spawn(): Worker {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "cao-kernel" });
    worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      const response = event.data;
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

  private send<T>(request: KernelRequest, transfer: Transferable[] = []): Promise<T> {
    if (!this.worker) throw new Error("Worker noyau non démarré.");
    const worker = this.worker;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, { resolve: resolve as (value: never) => void, reject });
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
    const response = await this.send<RebuildResult>({ id, kind: "rebuild", document, revision: id, quality });
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

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.initPromise = null;
    this.setStatus("idle");
  }
}
