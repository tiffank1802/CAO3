// @vitest-environment jsdom
/**
 * Test d'intégration de la chaîne RPC complète : **le vrai client** (`KernelClient`) parle au
 * **vrai worker** (`kernel/worker.ts`), avec un `Worker` simulé qui reproduit fidèlement le
 * comportement du navigateur (transfert des tampons, messages de progression, erreurs fatales).
 *
 * C'est le test qui manquait : les tests du noyau appelaient `rebuildDocument()` en direct, sans
 * passer par le protocole ; les tests d'interface remplaçaient le client par une doublure. Un
 * défaut dans le protocole (init, progression, transfert, reconstruction) restait donc invisible.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { KernelRequest, KernelResponse } from "@/cad/kernel/protocol";
import type { CadDocument } from "@/cad/core/types";

const OC_WASM = resolve(__dirname, "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");

/** Messages envoyés par le worker vers le client (ce que l'interface reçoit réellement). */
const channel = {
  fromWorker: null as ((response: KernelResponse) => void) | null,
  requests: [] as KernelRequest[],
  responses: [] as KernelResponse[],
};

/**
 * Le worker réel : on l'importe et il s'installe sur `self.onmessage`.
 * `self.postMessage` est relié au client, avec le même algorithme que le navigateur.
 */
function installWorkerGlobal(): void {
  const global = globalThis as unknown as { self?: unknown };
  global.self = {
    postMessage: (response: KernelResponse, transfer: Transferable[] = []) => {
      // `structuredClone` applique exactement les règles de `postMessage`, transfert compris :
      // un tampon déjà détaché fait échouer l'envoi, comme dans un vrai Worker.
      const cloned = transfer.length ? structuredClone(response, { transfer }) : structuredClone(response);
      channel.responses.push(cloned as KernelResponse);
      channel.fromWorker?.(cloned as KernelResponse);
    },
    onmessage: null,
  };
}

/** `Worker` simulé : dirige les requêtes vers le module du worker. */
class FakeWorker {
  onmessage: ((event: MessageEvent<KernelResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private alive = true;

  constructor() {
    channel.fromWorker = (response) => {
      // Livraison asynchrone, comme un vrai Worker.
      queueMicrotask(() => {
        if (this.alive) this.onmessage?.({ data: response } as MessageEvent<KernelResponse>);
      });
    };
  }

  postMessage(request: KernelRequest): void {
    channel.requests.push(request);
    queueMicrotask(() => {
      if (!this.alive) return;
      const handler = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => Promise<void> } }).self.onmessage;
      void handler({ data: request } as MessageEvent);
    });
  }

  terminate(): void {
    this.alive = false;
  }
}

beforeEach(() => {
  channel.requests = [];
  channel.responses = [];
  channel.fromWorker = null;
  // Le module du worker s'installe sur `self` à l'import : on repart d'un registre neuf pour
  // que le module soit réévalué à chaque test (`vi.resetModules`).
  vi.resetModules();
  installWorkerGlobal();
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  (globalThis as unknown as { caches: unknown }).caches = undefined;

  // Le worker télécharge le WASM : dans Node on le sert depuis le disque.
  const bytes = readFileSync(OC_WASM);
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(buffer, { headers: { "content-length": String(buffer.byteLength) } });
  });
});

/** Import dynamique : le module s'installe sur le `self` en place. */
async function loadWorkerModule(): Promise<void> {
  await import("@/cad/kernel/worker");
  const self = (globalThis as unknown as { self: { onmessage?: unknown } }).self;
  if (typeof self.onmessage !== "function") throw new Error("le module du worker ne s'est pas installé sur self.onmessage");
}

function demoDocument(): CadDocument {
  return {
    schema: "cao3/document@1",
    id: "doc_test",
    name: "Demonstration",
    units: { length: "mm", decimals: 2 },
    features: [
      {
        id: "f_sketch",
        type: "sketch",
        name: "Esquisse1",
        suppressed: false,
        sketch: {
          plane: { kind: "base", name: "XY", offset: 0 },
          originId: "p_origin",
          points: [
            { id: "p_origin", x: 0, y: 0, fixed: true },
            { id: "p0", x: -40, y: -25 },
            { id: "p1", x: 40, y: -25 },
            { id: "p2", x: 40, y: 25 },
            { id: "p3", x: -40, y: 25 },
          ],
          entities: [
            { id: "l0", kind: "line", p1: "p0", p2: "p1" },
            { id: "l1", kind: "line", p1: "p1", p2: "p2" },
            { id: "l2", kind: "line", p1: "p2", p2: "p3" },
            { id: "l3", kind: "line", p1: "p3", p2: "p0" },
          ],
          constraints: [],
          dimensions: [],
          gridStep: 1,
        },
      },
      {
        id: "f_extrude",
        type: "extrude",
        name: "Bossage1",
        suppressed: false,
        profileId: "f_sketch",
        operation: "newBody",
        end: { kind: "blind", depth: 20, reverse: false, draftAngle: 0 },
      },
    ],
  };
}

describe("Chaîne client ↔ worker (celle utilisée par l'application)", () => {
  it("initialise le noyau, reconstruit une pièce et livre un maillage exploitable", { timeout: 180_000 }, async () => {
    await loadWorkerModule();
    const { KernelClient } = await import("@/cad/kernel/client");
    const client = new KernelClient(() => new FakeWorker() as unknown as Worker);

    const progress: string[] = [];
    client.onProgress((p) => progress.push(p.phase));
    const statuses: string[] = [];
    client.onStatus((status) => statuses.push(status));

    await client.init();
    expect(statuses).toContain("loading");
    expect(statuses).toContain("ready");
    // La progression remonte bien jusqu'à l'interface.
    expect(progress.some((phase) => phase.includes("téléchargement"))).toBe(true);
    expect(client.diagnostics().source).toBe("reseau");
    expect(client.diagnostics().starts).toBe(1);

    const result = await client.rebuild(demoDocument(), "final");

    // Le maillage doit être **effectivement reçu** par le thread UI.
    expect(result.mesh, "maillage absent").not.toBeNull();
    expect(result.mesh!.triangleCount).toBeGreaterThan(0);
    expect(result.mesh!.positions.length).toBeGreaterThan(0);
    expect(result.mesh!.indices.length).toBe(result.mesh!.triangleCount * 3);
    expect(result.mesh!.faceIds.length).toBe(result.mesh!.triangleCount);
    expect(result.mesh!.edgeLines.length).toBeGreaterThan(0);
    expect(result.mesh!.bbox.max[0]).toBeCloseTo(40, 3);
    expect(result.volume).toBeCloseTo(80_000, -2);
    expect(result.states.filter((s) => s.status === "error")).toHaveLength(0);

    // Les tampons côté worker sont détachés après transfert : le thread UI en est propriétaire.
    expect(result.mesh!.positions.byteLength).toBeGreaterThan(0);

    // Le client déplie l'enveloppe du protocole : l'interface ne voit jamais le champ `ok`/`kind`.
    expect((result as unknown as Record<string, unknown>).ok).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).kind).toBeUndefined();

    // Aucun redémarrage inutile : le noyau n'a démarré qu'une fois.
    expect(client.diagnostics().starts).toBe(1);
    expect(client.diagnostics().restarts).toBe(0);
  });

  it("exporte STEP et STL par le même chemin RPC", { timeout: 180_000 }, async () => {
    await loadWorkerModule();
    const { KernelClient } = await import("@/cad/kernel/client");
    const client = new KernelClient(() => new FakeWorker() as unknown as Worker);

    const step = await client.exportFile(demoDocument(), "step");
    expect(ArrayBuffer.isView(step.data)).toBe(true);
    expect(step.byteLength).toBeGreaterThan(1000);
    expect(step.fileName.endsWith(".step")).toBe(true);
    expect(new TextDecoder().decode(step.data.slice(0, 20))).toContain("ISO-10303");

    const stl = await client.exportFile(demoDocument(), "stl");
    expect(ArrayBuffer.isView(stl.data)).toBe(true);
    // STL binaire : 84 octets d'en-tête + 50 octets par triangle (un parallélépipède = 12).
    expect(stl.byteLength).toBe(84 + 12 * 50);
    expect(stl.fileName.endsWith(".stl")).toBe(true);

    expect(client.diagnostics().starts).toBe(1);
    // Le worker a bien transféré les octets (tampons détachés côté worker).
    const response = channel.responses.find((r) => r.kind === "export") as { result: { byteLength: number } } | undefined;
    expect(response?.result.byteLength).toBeGreaterThan(1000);
  });

  it("enchaîne les reconstructions sans redémarrer le noyau", { timeout: 180_000 }, async () => {
    await loadWorkerModule();
    const { KernelClient } = await import("@/cad/kernel/client");
    const client = new KernelClient(() => new FakeWorker() as unknown as Worker);
    await client.init();

    const document = demoDocument();
    const bossage = document.features[1];
    if (bossage.type !== "extrude") throw new Error("bossage attendu en seconde fonction");
    for (let depth = 5; depth <= 30; depth += 5) {
      bossage.end = { kind: "blind", depth, reverse: false, draftAngle: 0 };
      const result = await client.rebuild(document, depth % 10 === 0 ? "preview" : "final");
      expect(result.mesh!.triangleCount, `profondeur ${depth}`).toBeGreaterThan(0);
      expect(result.volume).toBeCloseTo(80 * 50 * depth, -3);
    }

    // Une seule initialisation pour six reconstructions : c'est la garantie « le noyau ne
    // recharge pas à chaque affichage ».
    expect(client.diagnostics().starts).toBe(1);
  });
});
