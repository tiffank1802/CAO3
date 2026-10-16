/**
 * Chargement du WebAssembly du noyau — avec **cache persistant dans le navigateur**.
 *
 * Pourquoi ce module existe (constat du 2026-10-14) : les 22,98 Mo d'OpenCascade étaient
 * retéléchargés à **chaque** rechargement de page (en développement, Vite sert les fichiers de
 * `node_modules` en `no-cache`), et le noyau devait donc se réinitialiser à chaque fois — ce
 * que l'utilisateur perçoit comme « le noyau qui bouge et recharge ».
 *
 * La parade est celle des jeux en ligne : on range l'actif dans le **Cache Storage** du
 * navigateur (API disponible sans Service Worker) et on l'instancie depuis ces octets
 * (`wasmBinary`), donc **zéro requête réseau** aux chargements suivants.
 *
 * Dégradation garantie : si l'API `caches` est absente (contexte non sécurisé), si le quota
 * refuse l'écriture ou si la lecture échoue, on retombe simplement sur le téléchargement.
 * Le noyau doit toujours démarrer : le cache est une optimisation, jamais une condition.
 */

export type WasmSource = "cache" | "reseau";

export interface WasmProgress {
  phase: string;
  loaded: number;
  total: number | null;
  fraction: number | null;
}

export interface WasmLoadResult {
  bytes: ArrayBuffer;
  source: WasmSource;
  bytesLength: number;
  ms: number;
}

export interface WasmLoadOptions {
  url: string;
  /** Nom du cache (versionné) : incrémenter pour invalider. */
  cacheName?: string;
  onProgress?: (progress: WasmProgress) => void;
  /** Injectables pour les tests ; par défaut `fetch` et `globalThis.caches`. */
  fetcher?: typeof fetch;
  cacheStorage?: CacheStorage | null;
  /** Ignore le cache (utilisé par le rechargement forcé du noyau). */
  forceNetwork?: boolean;
}

const DEFAULT_CACHE = "cao3-noyau-v1";
const PROGRESS_STEP = 256 * 1024;

function availableCaches(explicit?: CacheStorage | null): CacheStorage | null {
  if (explicit !== undefined) return explicit;
  try {
    return typeof caches !== "undefined" ? caches : null;
  } catch {
    // Accès refusé (contexte non sécurisé) : on continue sans cache.
    return null;
  }
}

/**
 * Récupère les octets du WASM : d'abord dans le cache local, sinon par le réseau
 * (en flux, pour pouvoir afficher une progression réelle), puis met en cache.
 */
export async function loadKernelWasm(options: WasmLoadOptions): Promise<WasmLoadResult> {
  const started = (globalThis.performance ?? Date).now?.() ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const storage = availableCaches(options.cacheStorage);
  const cacheName = options.cacheName ?? DEFAULT_CACHE;

  if (storage && !options.forceNetwork) {
    try {
      const cache = await storage.open(cacheName);
      const hit = await cache.match(options.url);
      if (hit) {
        const bytes = await hit.arrayBuffer();
        options.onProgress?.({
          phase: "noyau lu depuis le cache local",
          loaded: bytes.byteLength,
          total: bytes.byteLength,
          fraction: 1,
        });
        return { bytes, source: "cache", bytesLength: bytes.byteLength, ms: elapsed(started) };
      }
    } catch {
      // Cache illisible : on passera par le réseau.
    }
  }

  const response = await fetcher(options.url);
  if (!response.ok) throw new Error(`Téléchargement du noyau impossible (HTTP ${response.status}).`);

  const headerLength = response.headers.get("content-length");
  const total = headerLength ? Number(headerLength) : null;
  let bytes: ArrayBuffer;

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastReported = -PROGRESS_STEP;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      loaded += value.byteLength;
      if (loaded - lastReported >= PROGRESS_STEP) {
        lastReported = loaded;
        options.onProgress?.({ phase: "téléchargement du noyau", loaded, total, fraction: total ? loaded / total : null });
      }
    }
    options.onProgress?.({ phase: "téléchargement du noyau", loaded, total, fraction: total ? loaded / total : 1 });
    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    bytes = merged.buffer;
  } else {
    bytes = await response.arrayBuffer();
    options.onProgress?.({ phase: "téléchargement du noyau", loaded: bytes.byteLength, total: bytes.byteLength, fraction: 1 });
  }

  if (storage) {
    try {
      const cache = await storage.open(cacheName);
      // Une nouvelle Response : le corps du flux d'origine est déjà consommé.
      await cache.put(
        options.url,
        new Response(bytes.slice(0), { headers: { "Content-Type": "application/wasm" } }),
      );
    } catch {
      // Quota refusé ou écriture impossible : le noyau fonctionne quand même.
    }
  }

  return { bytes, source: "reseau", bytesLength: bytes.byteLength, ms: elapsed(started) };
}

/** Vide le cache du noyau (diagnostic : « forcer un nouveau téléchargement »). */
export async function clearKernelWasmCache(cacheName = DEFAULT_CACHE): Promise<boolean> {
  const storage = availableCaches();
  if (!storage) return false;
  try {
    return await storage.delete(cacheName);
  } catch {
    return false;
  }
}

function elapsed(started: number): number {
  const now = (globalThis.performance ?? Date).now?.() ?? Date.now();
  return now - started;
}
