/** Client du worker solveur (thread UI). */
import type { SketchData } from "../core/types";
import type { SolveResult, SolverRequest, SolverResponse } from "./protocol";

export class SolverClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (v: SolveResult) => void; reject: (e: Error) => void }>();

  private spawn(): Worker {
    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module", name: "cao-solver" });
    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      const message = event.message || "erreur du solveur";
      for (const [, entry] of this.pending) entry.reject(new Error(message));
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  async solve(sketch: SketchData): Promise<SolveResult> {
    if (!this.worker) this.spawn();
    const request: SolverRequest = { id: ++this.sequence, kind: "solve", sketch };
    const worker = this.worker!;
    return new Promise<SolveResult>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      worker.postMessage(request);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
