<script setup lang="ts">
/** Barre d'état : unités, statut du noyau, statut du solveur, temps de reconstruction, sélection. */
import { computed } from "vue";
import { useCadStore } from "../core/documentStore";

const store = useCadStore();

const kernelLabel = computed(() => {
  switch (store.kernelStatus) {
    case "loading":
      return "Noyau OpenCascade : chargement…";
    case "ready":
      return `Noyau prêt`;
    case "error":
      return "Noyau en erreur";
    case "restarting":
      return "Redémarrage du noyau…";
    default:
      return "Noyau inactif";
  }
});

const kernelColor = computed(() => (store.kernelStatus === "ready" ? "var(--ok)" : store.kernelStatus === "error" ? "var(--error)" : "var(--warn)"));

/** Origine du noyau : « cache » = démarrage instantané, sans réseau. */
const kernelOrigin = computed(() => {
  const info = store.kernelInfo;
  if (!info.starts) return "";
  return info.source === "cache" ? " · cache local" : " · réseau";
});

/** Mémoire : c'est le voyant qui prévient avant que le navigateur ne sature. */
const memoryStatus = computed(() => {
  const pressure = store.memoryPressure;
  const label = store.memoryLabel;
  if (pressure) return { text: `${label} ⚠`, color: "var(--warn)" };
  return { text: label, color: "var(--text-dim)" };
});

const triangleStatus = computed(() => {
  const count = store.triangles;
  if (!count) return { text: "0 triangle", color: "var(--text-dim)" };
  if (count > 1_000_000) return { text: `${(count / 1e6).toFixed(2)} M triangles ⚠`, color: "var(--warn)" };
  return { text: `${count.toLocaleString("fr-FR")} triangles`, color: "var(--text-dim)" };
});

const sketchStatus = computed(() => {
  if (!store.activeSketchFeature) return null;
  if (store.sketchSession.conflicts.length) return { text: `Conflit de contraintes (${store.sketchSession.conflicts.length})`, color: "var(--error)" };
  if (store.sketchSession.dof === 0) return { text: "Esquisse entièrement contrainte", color: "var(--ok)" };
  return { text: `${store.sketchSession.dof} degré(s) de liberté`, color: "var(--accent)" };
});
</script>

<template>
  <footer class="status">
    <span class="dot" :style="{ background: kernelColor }" />
    <span :title="store.kernelDetail || undefined">{{ kernelLabel }}{{ kernelOrigin }}</span>
    <span class="sep" />
    <span>{{ store.document.units.length }}</span>
    <span class="sep" />
    <span v-if="sketchStatus" :style="{ color: sketchStatus.color }">{{ sketchStatus.text }}</span>
    <span v-else class="dim">Aucune esquisse active</span>
    <span class="sep" />
    <span>Reconstruction : {{ store.lastBuildMs.toFixed(0) }} ms</span>
    <span class="sep" />
    <span :style="{ color: store.storage.available ? 'var(--text-dim)' : 'var(--warn)' }" title="Document conservé dans la base du navigateur (IndexedDB)">
      {{ store.lastSavedLabel }}
    </span>
    <span class="sep" />
    <span :style="{ color: memoryStatus.color }" title="Mémoire du noyau WASM et de l'interface">{{ memoryStatus.text }}</span>
    <span class="sep" />
    <span :style="{ color: triangleStatus.color }" title="Budget de rendu : la tessellation est allégée automatiquement au-delà du seuil">{{ triangleStatus.text }}</span>
    <span class="sep" />
    <span v-if="store.build?.volume">{{ (store.build.volume / 1000).toFixed(3) }} cm³</span>
    <span v-else class="dim">volume —</span>
    <span class="grow" />
    <span v-if="store.selection" class="selection">Sélection : {{ store.selection.label }}</span>
    <span v-if="store.rebuilding" class="busy">⟳ reconstruction…</span>
    <span v-if="store.kernelDetail" class="dim">{{ store.kernelDetail }}</span>
    <span v-if="store.solverDetail" class="dim">{{ store.solverDetail }}</span>
  </footer>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: var(--glass-strong);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  border-top: 1px solid var(--glass-line);
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.sep {
  width: 1px;
  height: 12px;
  background: var(--border-strong);
}

.grow {
  flex: 1;
}

.dim {
  opacity: 0.65;
}

.selection {
  color: var(--text);
}

.busy {
  color: var(--warn);
}
</style>
