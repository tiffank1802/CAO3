import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// tests/kernel.spec.ts tourne dans Node (replicad / OpenCascade WASM s'y exécutent comme
// dans le worker navigateur) ; tests/app.spec.ts demande jsdom via son annotation d'environnement.
export default defineConfig({
  // Le plugin Vue est nécessaire pour les tests d'interface (tests/app.spec.ts).
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
