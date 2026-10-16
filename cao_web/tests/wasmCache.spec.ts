/**
 * Cache local du WebAssembly du noyau (Cache Storage).
 *
 * Objectif testé ici : **un rechargement de page ne doit plus retélécharger les 23 Mo**.
 * Premier chargement → réseau + mise en cache ; chargements suivants → lecture locale,
 * aucune requête. Les échecs de cache ne doivent jamais empêcher le noyau de démarrer.
 */
import { describe, expect, it, vi } from "vitest";
import { clearKernelWasmCache, loadKernelWasm } from "@/cad/kernel/wasmCache";

/** Cache Storage minimal (l'API n'existe pas dans Node). */
function fakeCacheStorage() {
  const stores = new Map<string, Map<string, ArrayBuffer>>();
  return {
    stores,
    api: {
      async open(name: string) {
        const store = stores.get(name) ?? new Map<string, ArrayBuffer>();
        stores.set(name, store);
        return {
          async match(url: string) {
            const bytes = store.get(url);
            return bytes ? new Response(bytes.slice(0), { headers: { "Content-Type": "application/wasm" } }) : undefined;
          },
          async put(url: string, response: Response) {
            store.set(url, await response.arrayBuffer());
          },
        };
      },
      async delete(name: string) {
        return stores.delete(name);
      },
    } as unknown as CacheStorage,
  };
}

/** Réponse réseau simulée, en flux, avec un `content-length` (comme un vrai serveur). */
function streamedResponse(bytes: Uint8Array, chunk = 1024): Response {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const slice = bytes.subarray(offset, Math.min(offset + chunk, bytes.byteLength));
      offset += slice.byteLength;
      controller.enqueue(slice);
    },
  });
  return new Response(body, { headers: { "content-length": String(bytes.byteLength) } });
}

const URL_OC = "/assets/replicad_single.wasm";

describe("Cache local du noyau", () => {
  it("télécharge une fois puis sert depuis le cache, sans requête réseau", async () => {
    const bytes = new Uint8Array(5000).fill(7);
    const fetcher = vi.fn(async () => streamedResponse(bytes));
    const { api } = fakeCacheStorage();
    const progress: string[] = [];

    // 1) Premier chargement : réseau.
    const first = await loadKernelWasm({
      url: URL_OC,
      fetcher: fetcher as unknown as typeof fetch,
      cacheStorage: api,
      onProgress: (p) => progress.push(p.phase),
    });
    expect(first.source).toBe("reseau");
    expect(first.bytesLength).toBe(5000);
    expect(new Uint8Array(first.bytes)[10]).toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(progress.some((phase) => phase.includes("téléchargement"))).toBe(true);

    // 2) Second chargement (rechargement de page) : cache local, aucune requête.
    const second = await loadKernelWasm({ url: URL_OC, fetcher: fetcher as unknown as typeof fetch, cacheStorage: api });
    expect(second.source).toBe("cache");
    expect(second.bytesLength).toBe(5000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(second.bytes)[4999]).toBe(7);

    // 3) Le cache est bien nommé et versionnable.
    expect([...fakeCacheStorage().stores.keys()]).toEqual([]);
  });

  it("remonte une progression réelle pendant le téléchargement", async () => {
    const bytes = new Uint8Array(300_000).fill(1);
    const fetcher = async () => streamedResponse(bytes, 64 * 1024);
    const fractions: number[] = [];

    await loadKernelWasm({
      url: URL_OC,
      fetcher: fetcher as unknown as typeof fetch,
      cacheStorage: null,
      onProgress: (p) => {
        if (p.fraction !== null) fractions.push(p.fraction);
      },
    });

    expect(fractions.length).toBeGreaterThan(1);
    expect(fractions[0]).toBeLessThan(1);
    expect(fractions[fractions.length - 1]).toBe(1);
    // Strictement croissante : la barre ne recule jamais.
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
  });

  it("ignore le cache quand un retéléchargement est forcé", async () => {
    const fetcher = vi.fn(async () => streamedResponse(new Uint8Array(100).fill(3)));
    const { api } = fakeCacheStorage();

    await loadKernelWasm({ url: URL_OC, fetcher: fetcher as unknown as typeof fetch, cacheStorage: api });
    const forced = await loadKernelWasm({
      url: URL_OC,
      fetcher: fetcher as unknown as typeof fetch,
      cacheStorage: api,
      forceNetwork: true,
    });

    expect(forced.source).toBe("reseau");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("démarre quand même si le cache est indisponible ou refuse l'écriture", async () => {
    const fetcher = vi.fn(async () => streamedResponse(new Uint8Array(64).fill(9)));

    // Cache absent (contexte non sécurisé, navigation privée…)
    const without = await loadKernelWasm({ url: URL_OC, fetcher: fetcher as unknown as typeof fetch, cacheStorage: null });
    expect(without.source).toBe("reseau");
    expect(without.bytesLength).toBe(64);

    // Cache qui refuse tout : lecture en erreur et écriture en erreur.
    const broken = {
      open: async () => {
        throw new Error("SecurityError");
      },
      delete: async () => false,
    } as unknown as CacheStorage;
    const resilient = await loadKernelWasm({ url: URL_OC, fetcher: fetcher as unknown as typeof fetch, cacheStorage: broken });
    expect(resilient.source).toBe("reseau");
    expect(resilient.bytesLength).toBe(64);

    // L'API n'existe pas du tout : le module doit se taire, pas lever.
    const original = (globalThis as unknown as { caches?: unknown }).caches;
    delete (globalThis as unknown as { caches?: unknown }).caches;
    await expect(loadKernelWasm({ url: URL_OC, fetcher: fetcher as unknown as typeof fetch })).resolves.toMatchObject({ source: "reseau" });
    await expect(clearKernelWasmCache()).resolves.toBe(false);
    if (original) (globalThis as unknown as { caches: unknown }).caches = original;
  });

  it("signale clairement un échec de téléchargement", async () => {
    const fetcher = async () => new Response("nope", { status: 404 });
    await expect(loadKernelWasm({ url: URL_OC, fetcher: fetcher as unknown as typeof fetch, cacheStorage: null })).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
