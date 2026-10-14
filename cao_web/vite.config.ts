import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
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
  preview: { host: true, allowedHosts: true, cors: true },
  optimizeDeps: {
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
