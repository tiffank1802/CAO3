<script setup lang="ts">
/**
 * Assemblage de l'application : ruban, arbre, vue 3D / esquisse, panneau de propriétés, barre d'état.
 * App.vue porte aussi le registre de commandes (un seul endroit qui sait « quoi faire »
 * pour chaque identifiant de commande du ruban) et les raccourcis clavier.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import RibbonBar from "./cad/ui/RibbonBar.vue";
import FeatureManager from "./cad/ui/FeatureManager.vue";
import PropertyManager from "./cad/ui/PropertyManager.vue";
import StatusBar from "./cad/ui/StatusBar.vue";
import SketchCanvas from "./cad/ui/SketchCanvas.vue";
import { PREVIEW_TRIANGLE_LIMIT, useCadStore } from "./cad/core/documentStore";
import { CadViewer } from "./cad/view/viewer";
import { downloadBlob, downloadText, openLocalFile } from "./cad/io/download";
import { isSketchFeature } from "./cad/core/types";

const store = useCadStore();
const viewerHost = ref<HTMLDivElement | null>(null);
const sketchRef = ref<InstanceType<typeof SketchCanvas> | null>(null);
const toast = ref("");
const tooltip = ref("");
const showDiagnostics = ref(false);
const showLocalDocuments = ref(false);
const busyExport = ref(false);
const solverText = computed(() => store.solverDetail || "worker dédié");
const loadPercent = computed(() => `${Math.round((store.loadProgress?.fraction ?? 0) * 100)}%`);

/** Attend la prochaine image affichée (avec repli si `requestAnimationFrame` n'existe pas). */
function nextPaint(): Promise<void> {
  const raf: (callback: (time: number) => void) => void =
    typeof requestAnimationFrame === "function"
      ? (callback) => requestAnimationFrame(callback)
      : (callback) => window.setTimeout(() => callback(performance.now()), 0);
  return new Promise((resolve) => raf(() => raf(() => resolve())));
}

let viewer: CadViewer | null = null;
let toastTimer: number | null = null;

function notify(message: string): void {
  toast.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 4000);
}

async function withErrorGuard<T>(label: string, action: () => Promise<T> | T): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    notify(`${label} : ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

onMounted(async () => {
  // Les raccourcis sont globaux (comme dans SolidWorks) : le focus peut être n'importe où.
  window.addEventListener("keydown", onKeydown);
  if (viewerHost.value) {
    viewer = new CadViewer(viewerHost.value, {
      onSelect: (selection) => {
        store.setSelection(selection ? { kind: selection.kind, id: selection.id, label: selection.label } : null);
      },
      onHover: () => undefined,
    });
    viewer.setStyle(store.viewStyle);
  }
  // Priorité à l'affichage : la fenêtre (rubans, arbre, panneaux) est peinte AVANT que les
  // 22,9 Mo de WebAssembly ne commencent à descendre. L'utilisateur voit une application,
  // pas un écran blanc.
  await nextPaint();

  // Le stockage local est indépendant du noyau : on le prépare d'abord (reprise de session),
  // puis le noyau démarre et la pièce est reconstruite.
  await withErrorGuard("Stockage local", () => store.initStorage());
  await withErrorGuard("Initialisation du noyau", () => store.ensureKernel());
  await withErrorGuard("Première reconstruction", () => store.rebuildNow());
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  viewer?.dispose();
  viewer = null;
});

watch(
  () => store.build,
  (build) => viewer?.setMesh(build?.mesh ?? null),
  { immediate: true },
);

watch(
  () => store.viewStyle,
  (style) => viewer?.setStyle(style),
);

watch(
  () => store.view,
  (view) => viewer?.setView(view),
);

watch(
  () => store.showGrid,
  (visible) => viewer?.setGridVisible(visible),
);

async function runCommand(id: string): Promise<void> {
  switch (id) {
    case "file.new":
      store.newDocument();
      viewer?.frameAll();
      return;
    case "file.open": {
      const file = await openLocalFile("application/json,.json");
      if (!file) return;
      const text = await file.text();
      await withErrorGuard("Ouverture", () => store.loadDocument(text));
      viewer?.frameAll();
      notify(`Document « ${store.document.name} » ouvert (${store.features.length} fonctions)`);
      return;
    }
    case "file.save":
    case "file.export-json":
      downloadText(store.serializeDocument(), `${store.document.name}.cao3.json`);
      notify("Document enregistré au format .cao3.json");
      return;
    case "file.save-local": {
      const saved = await withErrorGuard("Enregistrement local", () => store.saveToLocal());
      if (saved === null) return;
      notify(saved ? "Document enregistré dans le navigateur (IndexedDB)" : "Enregistrement refusé par le stockage local");
      return;
    }
    case "file.local-docs":
      await store.refreshLocalDocuments();
      showLocalDocuments.value = true;
      return;
    case "file.demo":
      store.loadDemoPart();
      viewer?.frameAll();
      notify("Pièce de démonstration chargée : esquisse entièrement contrainte + bossage 20 mm");
      return;
    case "file.export-step":
    case "file.export-stl": {
      const format = id.endsWith("step") ? ("step" as const) : ("stl" as const);
      busyExport.value = true;
      const result = await withErrorGuard(`Export ${format.toUpperCase()}`, () => store.exportFile(format));
      busyExport.value = false;
      if (result) {
        downloadBlob(result.blob, result.fileName);
        notify(`${result.fileName} exporté (${(result.blob.size / 1024).toFixed(0)} Ko)`);
      }
      return;
    }
    case "tools.undo":
      store.undo();
      return;
    case "tools.redo":
      store.redo();
      return;
    case "tools.rebuild":
      await withErrorGuard("Reconstruction", () => store.rebuildNow());
      notify(`Reconstruit en ${store.lastBuildMs.toFixed(0)} ms`);
      return;
    case "tools.diagnostics":
    case "tools.about":
      showDiagnostics.value = true;
      return;
    case "sketch.new":
      store.startCommand("sketch", { plane: { kind: "base", name: "XY", offset: 0 } });
      return;
    case "sketch.edit": {
      const sketchFeature = store.features.find((f) => f.id === store.selection?.id && isSketchFeature(f)) ?? store.features.filter(isSketchFeature).at(-1);
      if (!sketchFeature) {
        notify("Aucune esquisse à modifier.");
        return;
      }
      store.openSketch(sketchFeature.id);
      await nextTick();
      sketchRef.value?.fitView();
      return;
    }
    case "sketch.leave":
      store.closeSketch();
      viewer?.frameAll();
      return;
    case "sketch.select":
      store.setSketchTool("select");
      return;
    case "sketch.rectangle-center":
      store.setSketchTool("rectangle-center");
      return;
    case "sketch.rectangle-corners":
      store.setSketchTool("rectangle-corners");
      return;
    case "sketch.circle":
      store.setSketchTool("circle");
      return;
    case "sketch.line":
      store.setSketchTool("line");
      return;
    case "sketch.dimension":
      store.setSketchTool("dimension");
      return;
    case "feature.extrude":
    case "feature.cut": {
      const profile = store.features.filter(isSketchFeature).at(-1);
      if (!profile) {
        notify("Créez d'abord une esquisse.");
        return;
      }
      store.startCommand(id === "feature.cut" ? "cut" : "extrude", { profileId: profile.id, depth: 20 });
      return;
    }
    case "view.iso":
    case "view.front":
    case "view.top":
    case "view.right":
      store.view = id.split(".")[1] as typeof store.view;
      return;
    case "view.frame":
      viewer?.frameAll();
      sketchRef.value?.fitView();
      return;
    case "view.style-shaded-edges":
      store.viewStyle = "shaded-edges";
      return;
    case "view.style-shaded":
      store.viewStyle = "shaded";
      return;
    case "view.style-wireframe":
      store.viewStyle = "wireframe";
      return;
    case "view.style-transparent":
      store.viewStyle = "transparent";
      return;
    case "view.grid":
      store.showGrid = !store.showGrid;
      return;
    default:
      notify(`Commande « ${id} » non disponible dans cette version.`);
  }
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing = target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");

  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      store.undo();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      store.redo();
    } else if (key === "s") {
      event.preventDefault();
      downloadText(store.serializeDocument(), `${store.document.name}.cao3.json`);
    } else if (key === "b") {
      event.preventDefault();
      void withErrorGuard("Reconstruction", () => store.rebuildNow());
    }
    return;
  }

  if (typing) return;

  const inSketch = !!store.activeSketchFeature;
  switch (event.key) {
    case "Escape":
      if (store.activeCommand) store.cancelCommand();
      else if (inSketch) store.setSketchTool("select");
      break;
    case "Enter":
      if (store.activeCommand) store.commitCommand();
      break;
    case "Delete":
    case "Backspace":
      if (inSketch) {
        event.preventDefault();
        store.deleteSelection();
      }
      break;
    case " ":
      event.preventDefault();
      store.view = store.view === "iso" ? "front" : "iso";
      break;
    case "f":
    case "F":
      viewer?.frameAll();
      sketchRef.value?.fitView();
      break;
    default:
      if (!inSketch) return;
      if (event.key === "s" || event.key === "S") store.setSketchTool("select");
      if (event.key === "r" || event.key === "R") store.setSketchTool("rectangle-center");
      if (event.key === "c" || event.key === "C") store.setSketchTool("circle");
      if (event.key === "l" || event.key === "L") store.setSketchTool("line");
      if (event.key === "d" || event.key === "D") store.setSketchTool("dimension");
  }
}

/**
 * Libère la mémoire : le worker qui détient OpenCascade est tué (sa mémoire est rendue au
 * système d'un coup) et un noyau neuf reconstruit le document. Rien n'est perdu — le document
 * est en JSON — et l'opération est immédiate côté utilisateur.
 */
async function releaseMemory(): Promise<void> {
  const freed = store.memory.heapBytes;
  await withErrorGuard("Libération de la mémoire", () => store.releaseMemory());
  notify(freed ? `Mémoire du noyau libérée (${(freed / 1048576).toFixed(0)} Mo) · noyau redémarré` : "Noyau redémarré");
}

async function openLocal(id: string): Promise<void> {
  await withErrorGuard("Ouverture locale", () => store.openLocalDocument(id));
  showLocalDocuments.value = false;
  viewer?.frameAll();
  notify("Document repris depuis le stockage local");
}

function restartKernel(): void {
  void withErrorGuard("Redémarrage du noyau", () => store.ensureKernel());
  notify("Noyau redémarré");
}
</script>

<template>
  <div class="app">
    <RibbonBar @command="runCommand" @tooltip="tooltip = $event" />

    <div class="workspace">
      <FeatureManager />

      <main class="viewport">
        <div ref="viewerHost" class="viewer-host" />
        <div v-if="store.activeSketchFeature" class="sketch-overlay">
          <SketchCanvas ref="sketchRef" />
        </div>
        <div v-if="store.kernelStatus === 'loading'" class="viewport-overlay">
          <div class="loader">
            <strong>Chargement du noyau OpenCascade</strong>
            <span v-if="store.loadProgress?.total">
              {{ store.loadProgress.phase }} — {{ (store.loadProgress.loaded / 1048576).toFixed(1) }} Mo /
              {{ (store.loadProgress.total / 1048576).toFixed(1) }} Mo
              ({{ Math.round((store.loadProgress.fraction ?? 0) * 100) }} %)
            </span>
            <span v-else>{{ store.loadProgress?.phase ?? "ouverture du flux WebAssembly" }}</span>
            <div class="loader-bar"><i :style="{ width: loadPercent }" /></div>
            <span class="loader-note">21,9 Mo une seule fois — ensuite tout est en cache local (aucun serveur).</span>
          </div>
        </div>
      </main>

      <PropertyManager />
    </div>

    <StatusBar />

    <div v-if="store.memoryPressure" class="memory-banner">
      <span>
        Mémoire {{ store.memoryPressure === "noyau" ? "du noyau OpenCascade" : "de l'interface" }}
        élevée ({{ store.memoryLabel }}). Le navigateur peut devenir instable.
      </span>
      <button :disabled="store.restartingKernel" @click="releaseMemory">
        {{ store.restartingKernel ? "Libération…" : "Libérer la mémoire" }}
      </button>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
    <div v-if="tooltip" class="tooltip-hint">{{ tooltip }}</div>

    <div v-if="showLocalDocuments" class="modal-backdrop" @click.self="showLocalDocuments = false">
      <div class="modal">
        <header>
          <h2>Documents locaux</h2>
          <button @click="showLocalDocuments = false">✕</button>
        </header>
        <p class="modal-note">
          Stockés dans la base du navigateur (IndexedDB) — plusieurs centaines de mégaoctets disponibles,
          rien ne quitte votre machine. Les gros assemblages et les fichiers STEP restent des fichiers.
        </p>
        <ul class="local-docs">
          <li v-for="entry in store.storage.documents" :key="entry.id">
            <button class="doc-name" @click="openLocal(entry.id)">{{ entry.name }}</button>
            <span class="doc-meta">
              {{ entry.features }} fonction(s) · {{ (entry.bytes / 1024).toFixed(1) }} Ko ·
              {{ new Date(entry.updatedAt).toLocaleString("fr-FR") }}
              <template v-if="entry.volume"> · {{ entry.volume.toFixed(0) }} mm³</template>
            </span>
            <button class="doc-delete" title="Supprimer" @click="store.removeLocalDocument(entry.id)">✕</button>
          </li>
        </ul>
        <p v-if="!store.storage.documents.length" class="modal-note">Aucun document enregistré pour l'instant.</p>
        <p v-if="store.storage.error" class="modal-note warn">{{ store.storage.error }}</p>
        <footer>
          <button class="primary" @click="showLocalDocuments = false">Fermer</button>
        </footer>
      </div>
    </div>

    <div v-if="showDiagnostics" class="modal-backdrop" @click.self="showDiagnostics = false">
      <div class="modal">
        <header>
          <h2>Diagnostic du noyau</h2>
          <button @click="showDiagnostics = false">✕</button>
        </header>
        <dl>
          <dt>État du worker</dt>
          <dd>{{ store.kernelStatus }} — {{ store.kernelDetail || "en attente" }}</dd>
          <dt>Noyau</dt>
          <dd>OpenCascade WASM via replicad 1.1.0</dd>
          <dt>Solveur</dt>
          <dd>planegcs 1.3.0 ({{ solverText }})</dd>
          <dt>Document</dt>
          <dd>{{ store.features.length }} fonctions · {{ store.triangles }} triangles · {{ store.lastBuildMs.toFixed(0) }} ms</dd>
          <dt>Mémoire</dt>
          <dd>
            {{ store.memoryLabel }} · pic interface
            {{ (store.memory.peakJsBytes / 1048576).toFixed(0) }} Mo
            <template v-if="store.triangles > PREVIEW_TRIANGLE_LIMIT"> · tessellation allégée au-delà de {{ PREVIEW_TRIANGLE_LIMIT / 1000 }} k triangles</template>
          </dd>
          <dt>Avertissements</dt>
          <dd>{{ store.warnings.length ? store.warnings.join(" · ") : "aucun" }}</dd>
          <dt>Erreurs</dt>
          <dd>{{ store.errors.length ? store.errors.map((e) => e.message).join(" · ") : "aucune" }}</dd>
        </dl>
        <footer>
          <button :disabled="store.restartingKernel" @click="releaseMemory">
            {{ store.restartingKernel ? "Libération…" : "Libérer la mémoire (redémarrer le noyau)" }}
          </button>
          <button @click="restartKernel">Redémarrer le noyau</button>
          <button class="primary" @click="showDiagnostics = false">Fermer</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}

.viewport {
  position: relative;
  flex: 1;
  min-width: 0;
  background: #1d2129;
}

.viewer-host {
  position: absolute;
  inset: 0;
}

.sketch-overlay {
  position: absolute;
  inset: 0;
  background: #191d24;
}

.loader-bar {
  width: 260px;
  height: 5px;
  margin: 10px 0 6px;
  border-radius: 3px;
  background: #2a323d;
  overflow: hidden;
}

.loader-bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 120ms linear;
}

.loader-note {
  font-size: 10px;
  opacity: 0.75;
}

.local-docs {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 300px;
  overflow-y: auto;
}

.local-docs li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
}

.local-docs .doc-name {
  color: var(--accent);
  text-decoration: underline;
}

.local-docs .doc-meta {
  flex: 1;
  color: var(--text-dim);
  font-size: 11px;
}

.local-docs .doc-delete {
  color: var(--error);
}

.modal-note {
  margin: 0 0 10px;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
}

.modal-note.warn {
  color: var(--warn);
}

.memory-banner {
  position: absolute;
  left: 50%;
  bottom: 44px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px 7px 14px;
  border-radius: 6px;
  background: #4a2f16;
  border: 1px solid var(--warn);
  color: #ffd9a0;
  font-size: 12px;
  z-index: 20;
}

.memory-banner button {
  padding: 5px 10px;
  border-radius: 4px;
  background: var(--warn);
  color: #1d2129;
  font-weight: 600;
}

.memory-banner button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.viewport-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #14181ecc;
}

.loader {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 22px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  text-align: center;
}

.loader span {
  font-size: 11px;
  color: var(--text-dim);
}

.toast {
  position: fixed;
  bottom: 34px;
  left: 50%;
  transform: translateX(-50%);
  background: #232a34;
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 12px;
  z-index: 40;
}

.tooltip-hint {
  position: fixed;
  right: 12px;
  bottom: 30px;
  font-size: 11px;
  color: var(--text-dim);
  background: #1b2129;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  z-index: 30;
  max-width: 340px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: #0b0e12cc;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  width: 560px;
  max-width: 92vw;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  overflow: hidden;
}

.modal header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--bg-panel-alt);
  border-bottom: 1px solid var(--border);
}

.modal h2 {
  margin: 0;
  font-size: 14px;
}

.modal dl {
  margin: 0;
  padding: 14px;
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 8px 12px;
  font-size: 12px;
}

.modal dt {
  color: var(--text-dim);
}

.modal dd {
  margin: 0;
  word-break: break-word;
}

.modal footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.modal button {
  padding: 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel-alt);
}

.modal button.primary {
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
