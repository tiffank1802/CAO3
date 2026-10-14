/// <reference lib="webworker" />
/**
 * Worker du solveur de contraintes : séparé du noyau B-Rep pour que le glissement
 * d'une esquisse ne soit jamais mis en attente par une reconstruction lourde.
 */
import solverWasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { ensureSolver, solveSketch } from "./solve";
import type { SolverRequest, SolverResponse } from "./protocol";

self.onmessage = async (event: MessageEvent<SolverRequest>) => {
  const request = event.data;
  try {
    await ensureSolver(solverWasmUrl);
    if (request.kind === "solve") {
      const result = solveSketch(request.sketch);
      const response: SolverResponse = { id: request.id, ok: true, kind: "solve", result };
      (self as unknown as Worker).postMessage(response);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: SolverResponse = { id: request.id, ok: false, kind: "solve", error: message };
    (self as unknown as Worker).postMessage(response);
  }
};
