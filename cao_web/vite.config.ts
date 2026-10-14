import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

/**
 * En développement, Vite sert les fichiers de `node_modules` en `no-cache` : les 23 Mo du noyau
 * étaient donc retéléchargés à chaque rechargement de page (et le noyau se réinitialisait).
 * On impose un cache long **uniquement pour les fichiers .wasm**, qui ne changent jamais sans
 * changement de version.
 */
function wasmCacheHeaders(): Plugin {
  return {
    name: "cao3-wasm-cache",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && /\.wasm(\?|$)/.test(req.url)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), wasmCacheHeaders()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  worker: { format: "es" },
  // Le serveur de prévisualisation est proxifié par la plateforme : on accepte l'hôte
  // et l'origine dynamiques, sinon Vite bloque les requêtes (host/origin allowlist).
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
    headers: {
      // Utile le jour où l'on active le build WASM multi-thread (SharedArrayBuffer).
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    cors: true,
    headers: {
      // Les assets sont hachés : cache long sans risque. Le noyau profite du cache local
      // (Cache Storage) de toute façon.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  },
  optimizeDeps: {
    // Déclarer les dépendances utilisées évite à Vite d'en découvrir de nouvelles en cours de
    // session — chaque découverte déclenche un rechargement complet de la page (donc un
    // redémarrage du noyau WebAssembly). Elles sont donc pré-optimisées au démarrage.
    include: ["vue", "pinia", "three", "konva", "replicad"],
    // Ces deux paquets référencent leur WASM en interne (`new URL(..., import.meta.url)`) :
    // le pré-bundling transforme cette référence en import ESM de .wasm, ce que Vite refuse
    // (« ESM integration proposal for Wasm is not supported »). On les sert tels quels et on
    // fournit l'URL du WASM explicitement (locateFile / make_gcs_wrapper).
    exclude: ["replicad-opencascadejs", "@salusoft89/planegcs"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 8192,
  },
});
