/**
 * Store du document (Pinia) : document courant, sélection, reconstruction, undo/redo.
 * L'interface ne parle jamais directement au noyau : tout passe par ce store.
 */
import { computed, reactive, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { CadDocument, Feature, SketchData, SketchFeature } from "./types";
import { findFeature, isExtrudeFeature, isSketchFeature } from "./types";
import { createDocument, createExtrudeFeature, createSketchFeature, validateDocument } from "./registry";
import { newId } from "./ids";
import { jsHeapBytes, KernelClient, type KernelDiagnostics, type KernelStatus } from "../kernel/client";
import { SolverClient } from "../kernel/solverClient";
import type { RebuildResult, SolveResult } from "../kernel/protocol";
import { addRectangleCentered, applySolveResult } from "../sketch/model";
import {
  deleteDocumentRecord,
  isStorageAvailable,
  latestDocument,
  listDocuments,
  loadDocumentRecord,
  saveDocumentRecord,
  type StoredDocumentMeta,
} from "../io/storage";

export type ViewStyle = "shaded-edges" | "shaded" | "wireframe" | "transparent";

/** Seuil au-delà duquel on prévient l'utilisateur avant que le navigateur ne sature. */
export const MEMORY_WARN_HEAP_BYTES = 900 * 1024 * 1024;
/** Tessellation allégée pendant un glissement d'esquisse (aperçu) et au-delà de ce triangle. */
export const PREVIEW_TRIANGLE_LIMIT = 400_000;
export type ViewName = "iso" | "front" | "top" | "right";

export interface SelectionInfo {
  kind: "face" | "edge" | "feature" | "entity";
  id: string | number;
  label: string;
}

export interface ActiveCommand {
  id: string;
  /** Paramètres de la commande (ex. profondeur d'extrusion). */
  params: Record<string, unknown>;
}

export interface SketchSession {
  featureId: string;
  tool: "select" | "rectangle-center" | "rectangle-corners" | "circle" | "line" | "dimension";
  status: "idle" | "solving" | "error";
  dof: number;
  conflicts: string[];
  redundant: string[];
  selectedIds: string[];
  selectedDimensionId: string | null;
}

const HISTORY_LIMIT = 60;

export const useCadStore = defineStore("cad", () => {
  const kernel = new KernelClient();
  const solverClient = new SolverClient();

  const document = ref<CadDocument>(createDocument("Pièce1"));
  const kernelStatus = ref<KernelStatus>("idle");
  const kernelDetail = ref<string>("");
  const kernelInfo = ref<KernelDiagnostics>({ starts: 0, restarts: 0, source: "inconnu", loadMs: 0, initMs: 0, bytes: 0, heapBytes: null, at: 0 });
  const solverDetail = ref<string>("");
  const build = shallowRef<RebuildResult | null>(null);
  const buildError = ref<string>("");
  const rebuilding = ref(false);
  const selection = ref<SelectionInfo | null>(null);
  const activeCommand = ref<ActiveCommand | null>(null);
  const viewStyle = ref<ViewStyle>("shaded-edges");
  const view = ref<ViewName>("iso");
  const showGrid = ref(true);
  const sketchSession = reactive<SketchSession>({
    featureId: "",
    tool: "select",
    status: "idle",
    dof: -1,
    conflicts: [],
    redundant: [],
    selectedIds: [],
    selectedDimensionId: null,
  });

  const loadProgress = ref<{ phase: string; loaded: number; total: number | null; fraction: number | null } | null>(null);
  const storage = reactive<{
    available: boolean;
    lastSavedAt: number;
    saving: boolean;
    documents: StoredDocumentMeta[];
    error: string;
  }>({ available: false, lastSavedAt: 0, saving: false, documents: [], error: "" });
  const memory = ref<{ heapBytes: number | null; jsBytes: number | null; peakJsBytes: number }>({
    heapBytes: null,
    jsBytes: null,
    peakJsBytes: 0,
  });

  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let revision = 0;
  let rebuildTimer: number | null = null;
  let solveTimer: number | null = null;
  let pendingQuality: "preview" | "final" = "final";

  const features = computed(() => document.value.features);
  const activeSketchFeature = computed<SketchFeature | null>(() => {
    const feature = findFeature(document.value, sketchSession.featureId);
    return isSketchFeature(feature) ? feature : null;
  });
  const lastBuildMs = computed(() => build.value?.totalMs ?? 0);
  const warnings = computed(() => (build.value?.states ?? []).flatMap((state) => (state.status === "warning" ? state.warnings : [])));
  const errors = computed(() =>
    (build.value?.states ?? [])
      .filter((s) => s.status === "error")
      .map((s) => ({ featureId: s.featureId, message: (s as { message: string }).message })),
  );
  const kernelReady = computed(() => kernelStatus.value === "ready");
  const meshTriangles = computed(() => build.value?.mesh?.triangleCount ?? 0);
  const triangles = computed(() => build.value?.mesh?.triangleCount ?? 0);

  /** Vrai quand la mémoire du noyau approche la zone où un navigateur commence à lâcher. */
  const memoryPressure = computed(() => {
    const heap = memory.value.heapBytes;
    if (heap !== null && heap >= MEMORY_WARN_HEAP_BYTES) return "noyau";
    if (memory.value.jsBytes !== null && memory.value.jsBytes >= MEMORY_WARN_HEAP_BYTES) return "interface";
    return null;
  });
  const memoryLabel = computed(() => {
    const fmt = (bytes: number | null) => (bytes === null ? "—" : `${(bytes / 1024 / 1024).toFixed(0)} Mo`);
    return `noyau ${fmt(memory.value.heapBytes)} · interface ${fmt(memory.value.jsBytes)}`;
  });

  /** Sonde légère : la mémoire disponible sans reconstruction (simple ping au worker). */
  async function refreshMemory(): Promise<void> {
    const jsBytes = jsHeapBytes();
    memory.value = {
      jsBytes,
      peakJsBytes: Math.max(memory.value.peakJsBytes, jsBytes ?? 0),
      heapBytes: memory.value.heapBytes,
    };
  }

  kernel.onStatus((status, detail) => {
    kernelStatus.value = status;
    kernelInfo.value = kernel.diagnostics();
    if (detail) kernelDetail.value = detail;
    if (status === "ready") loadProgress.value = null;
    // Chaque redémarrage du worker rend toute la mémoire d'OpenCascade d'un coup :
    // c'est la seule façon de la récupérer, le tas WASM ne rétrécit jamais.
    if (status === "restarting") memory.value = { ...memory.value, heapBytes: null };
  });

  kernel.onProgress((progress) => {
    loadProgress.value = progress;
  });

  function snapshot(label: string): void {
    undoStack.push(JSON.stringify({ label, document: document.value }));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function undo(): void {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(JSON.stringify({ label: "redo", document: document.value }));
    document.value = JSON.parse(previous).document as CadDocument;
    scheduleRebuild("final");
  }

  function redo(): void {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify({ label: "undo", document: document.value }));
    document.value = JSON.parse(next).document as CadDocument;
    scheduleRebuild("final");
  }

  async function ensureKernel(): Promise<void> {
    try {
      await kernel.init();
    } catch (error) {
      buildError.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function runRebuild(quality: "preview" | "final"): Promise<void> {
    const issues = validateDocument(document.value);
    if (issues.length) buildError.value = issues.join(" · ");
    rebuildTimer = null;
    rebuilding.value = true;
    revision += 1;
    // Adaptatif : au-delà du seuil (ou pendant un glissement d'esquisse), on demande la
    // tessellation légère. Le maillage n'est qu'un cache — le B-Rep reste exact.
    const effective: "preview" | "final" = quality === "final" && meshTriangles.value > PREVIEW_TRIANGLE_LIMIT ? "preview" : quality;
    try {
      const result = await kernel.rebuild(document.value, effective);
      build.value = result;
      buildError.value = "";
      scheduleAutosave();
      const jsBytes = jsHeapBytes();
      memory.value = {
        heapBytes: result.heapBytes,
        jsBytes,
        peakJsBytes: Math.max(memory.value.peakJsBytes, jsBytes ?? 0),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("obsolète")) buildError.value = message;
    } finally {
      rebuilding.value = false;
      // Une seconde passe en qualité finale garantit une tessellation fine.
      if (quality === "preview") scheduleRebuild("final");
    }
  }

  /** Programme une reconstruction (débounce court pour les modifications en direct). */
  function scheduleRebuild(quality: "preview" | "final", delay?: number): void {
    pendingQuality = quality === "final" ? "final" : pendingQuality;
    const wait = delay ?? (quality === "final" ? 140 : 60);
    if (rebuildTimer !== null) window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => {
      const target = pendingQuality;
      pendingQuality = "preview";
      void runRebuild(target);
    }, wait);
  }

  async function rebuildNow(): Promise<void> {
    await ensureKernel();
    if (rebuildTimer !== null) window.clearTimeout(rebuildTimer);
    await runRebuild("final");
  }

  // ------------------------------------------------------------------ esquisse

  function startSketch(plane: SketchData["plane"] = { kind: "base", name: "XY", offset: 0 }): SketchFeature {
    snapshot("nouvelle esquisse");
    const feature = createSketchFeature(`Esquisse${countSketch()}`, undefined);
    feature.sketch = { ...feature.sketch, plane };
    document.value.features.push(feature);
    openSketch(feature.id);
    return feature;
  }

  function countSketch(): number {
    return document.value.features.filter(isSketchFeature).length + 1;
  }

  function openSketch(featureId: string): void {
    const feature = findFeature(document.value, featureId);
    if (!isSketchFeature(feature)) return;
    sketchSession.featureId = featureId;
    sketchSession.tool = "select";
    sketchSession.selectedIds = [];
    sketchSession.selectedDimensionId = null;
    void solveSketchNow();
  }

  function closeSketch(): void {
    sketchSession.featureId = "";
    sketchSession.selectedIds = [];
    sketchSession.selectedDimensionId = null;
    scheduleRebuild("final");
  }

  /** Résout l'esquisse en cours et met à jour la géométrie résolue. */
  /** Pendant un glissement, seule la qualité d'aperçu est reconstruite (le final suit au relâchement). */
  let draggingSketch = false;

  async function solveSketchNow(): Promise<SolveResult | null> {
    const feature = activeSketchFeature.value;
    if (!feature) return null;
    sketchSession.status = "solving";
    try {
      const result = await solverClient.solve(JSON.parse(JSON.stringify(feature.sketch)) as SketchData);
      applySolveResult(feature.sketch, result);
      sketchSession.dof = result.dof;
      sketchSession.conflicts = result.conflicts;
      sketchSession.redundant = result.redundant;
      sketchSession.status = "idle";
      solverDetail.value = `${result.ms.toFixed(1)} ms · ${result.dof < 0 ? "dof ?" : `${result.dof} degré(s) de liberté`}`;
      scheduleRebuild(draggingSketch ? "preview" : "final", draggingSketch ? 16 : undefined);
      return result;
    } catch (error) {
      sketchSession.status = "error";
      solverDetail.value = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  /** Programme une résolution (utilisé pendant les glissements). */
  function scheduleSolve(delay = 40): void {
    if (solveTimer !== null) window.clearTimeout(solveTimer);
    solveTimer = window.setTimeout(() => {
      solveTimer = null;
      void solveSketchNow();
    }, delay);
  }

  function mutateSketch(label: string, mutator: (sketch: SketchData) => void): void {
    const feature = activeSketchFeature.value;
    if (!feature) return;
    snapshot(label);
    mutator(feature.sketch);
    void solveSketchNow();
  }

  // ------------------------------------------------------------------ fonctions

  function addExtrudeFromSketch(sketchFeatureId: string, params: { depth: number; operation: "newBody" | "fuse" | "cut" }): Feature {
    snapshot("nouveau bossage");
    const feature = createExtrudeFeature(sketchFeatureId, params.operation === "cut" ? `Enlèvement${countExtrude()}` : `Bossage${countExtrude()}`);
    feature.end.depth = params.depth;
    feature.operation = params.operation;
    document.value.features.push(feature);
    scheduleRebuild("final");
    return feature;
  }

  function countExtrude(): number {
    return document.value.features.filter(isExtrudeFeature).length + 1;
  }

  function updateFeature(featureId: string, patch: Partial<Feature>, label = "modification"): void {
    const feature = findFeature(document.value, featureId);
    if (!feature) return;
    snapshot(label);
    Object.assign(feature, patch);
    scheduleRebuild("preview", 30);
    scheduleRebuild("final", 260);
  }

  function renameFeature(featureId: string, name: string): void {
    const feature = findFeature(document.value, featureId);
    if (feature) feature.name = name;
  }

  function deleteFeature(featureId: string): void {
    snapshot("suppression");
    document.value.features = document.value.features.filter((f) => f.id !== featureId);
    if (sketchSession.featureId === featureId) closeSketch();
    scheduleRebuild("final");
  }

  function toggleSuppress(featureId: string): void {
    const feature = findFeature(document.value, featureId);
    if (!feature) return;
    snapshot(feature.suppressed ? "réactiver" : "compresser");
    feature.suppressed = !feature.suppressed;
    scheduleRebuild("final");
  }

  function selectFeature(featureId: string): void {
    const feature = findFeature(document.value, featureId);
    if (!feature) return;
    selection.value = { kind: "feature", id: featureId, label: feature.name };
    if (isSketchFeature(feature)) openSketch(featureId);
  }

  // ------------------------------------------------------------------ commandes

  function startCommand(id: string, params: Record<string, unknown> = {}): void {
    activeCommand.value = { id, params };
  }

  function cancelCommand(): void {
    activeCommand.value = null;
  }

  function commitCommand(): void {
    const command = activeCommand.value;
    if (!command) return;
    if (command.id === "extrude" || command.id === "cut") {
      const profileId = String(command.params.profileId ?? "");
      const feature = findFeature(document.value, profileId);
      if (!isSketchFeature(feature)) {
        buildError.value = "Sélectionnez une esquisse pour définir le profil.";
        return;
      }
      addExtrudeFromSketch(profileId, {
        depth: Number(command.params.depth ?? 20),
        operation: command.id === "cut" ? "cut" : "newBody",
      });
    }
    if (command.id === "sketch") {
      startSketch((command.params.plane as SketchData["plane"]) ?? { kind: "base", name: "XY", offset: 0 });
    }
    activeCommand.value = null;
  }


  // ------------------------------------------------------------------ édition d'esquisse

  /** Point de reprise pour l'undo, utilisé avant un glissement (sans mutation). */
  function beginEdit(label: string): void {
    snapshot(label);
  }

  /** Applique la valeur d'une cote puis laisse le solveur repositionner la géométrie. */
  function setDimensionValue(dimensionId: string, value: number): void {
    const feature = activeSketchFeature.value;
    if (!feature) return;
    const dimension = feature.sketch.dimensions.find((d) => d.id === dimensionId);
    if (!dimension || !Number.isFinite(value)) return;
    snapshot("modification de cote");
    dimension.value = value;
    void solveSketchNow();
  }

  function addConstraintToSelection(kind: "horizontal" | "vertical"): void {
    const feature = activeSketchFeature.value;
    if (!feature) return;
    const lineId = sketchSession.selectedIds.find((id) => id.startsWith("l_"));
    if (!lineId) {
      solverDetail.value = "Sélectionnez d'abord une ligne.";
      return;
    }
    snapshot(`contrainte ${kind}`);
    feature.sketch.constraints.push({ id: newId("k"), kind, lines: [lineId] });
    void solveSketchNow();
  }

  const restartingKernel = ref(false);

  /**
   * Libère la mémoire du noyau : on tue le worker (toute la mémoire OpenCascade est rendue
   * au système d'un coup) et on relance un noyau neuf, puis on reconstruit le document.
   * C'est l'action « anti-plantage » : elle est toujours disponible, jamais destructive.
   */
  async function releaseMemory(): Promise<void> {
    if (restartingKernel.value) return;
    restartingKernel.value = true;
    try {
      await kernel.restart();
      memory.value = { heapBytes: null, jsBytes: jsHeapBytes(), peakJsBytes: 0 };
      await rebuildNow();
    } finally {
      restartingKernel.value = false;
    }
  }

  /**
   * Force un nouveau téléchargement du noyau (le cache local est ignoré). Utile après une mise
   * à jour de l'application, ou si le stockage du navigateur a gardé une version incohérente.
   */
  async function redownloadKernel(): Promise<void> {
    if (restartingKernel.value) return;
    restartingKernel.value = true;
    try {
      await kernel.restart(true);
      kernelInfo.value = kernel.diagnostics();
      await rebuildNow();
    } finally {
      restartingKernel.value = false;
    }
  }

  /** Signale un glissement d'esquisse en cours (active la reconstruction d'aperçu). */
  function setSketchDragging(value: boolean): void {
    draggingSketch = value;
    if (!value) scheduleRebuild("final");
  }

  function setSketchTool(tool: SketchSession["tool"]): void {
    sketchSession.tool = tool;
    if (tool !== "select") sketchSession.selectedDimensionId = null;
  }

  /** Supprime l'élément sélectionné (entité, point ou cote) — touche Suppr. */
  function deleteSelection(): void {
    const feature = activeSketchFeature.value;
    if (!feature || sketchSession.selectedIds.length === 0) return;
    snapshot("suppression d'entité");
    const ids = new Set(sketchSession.selectedIds);
    const data = feature.sketch;
    const removedEntityIds = data.entities.filter((e) => ids.has(e.id)).map((e) => e.id);
    const removedPointIds = data.points.filter((p) => ids.has(p.id) && p.id !== data.originId).map((p) => p.id);

    data.entities = data.entities.filter((e) => !ids.has(e.id));
    data.points = data.points.filter((p) => !(ids.has(p.id) && p.id !== data.originId));
    data.constraints = data.constraints.filter(
      (c) => !removedEntityIds.includes(c.id) && !(c.lines ?? []).some((l) => removedEntityIds.includes(l)),
    );
    data.dimensions = data.dimensions.filter(
      (d) =>
        !ids.has(d.id) &&
        !(d.circle && removedEntityIds.includes(d.circle)) &&
        !(d.line && removedEntityIds.includes(d.line)) &&
        !(d.points ?? []).some((pid) => removedPointIds.includes(pid)),
    );
    sketchSession.selectedIds = [];
    void solveSketchNow();
  }

  /**
   * Pièce de démonstration : une esquisse entièrement contrainte (rectangle 80 × 50 centré)
   * et son bossage de 20 mm. Sert de premier contact — tout est modifiable et annulable.
   */
  function loadDemoPart(): void {
    snapshot("pièce de démonstration");
    const doc = createDocument("Démonstration");
    const sketchFeature = createSketchFeature("Esquisse1");
    addRectangleCentered(sketchFeature.sketch, { x: 0, y: 0 }, 80, 50);
    const extrudeFeature = createExtrudeFeature(sketchFeature.id, "Bossage1");
    doc.features.push(sketchFeature, extrudeFeature);
    document.value = doc;
    sketchSession.featureId = "";
    sketchSession.selectedIds = [];
    sketchSession.selectedDimensionId = null;
    selection.value = { kind: "feature", id: extrudeFeature.id, label: extrudeFeature.name };
    scheduleRebuild("final", 0);
  }

  function newDocument(): void {
    snapshot("nouveau document");
    document.value = createDocument(`Pièce${newId("").length % 90 + 10}`);
    build.value = null;
    scheduleRebuild("final");
  }

  /** Prépare le stockage local et reprend la session précédente si elle existe. */
  async function initStorage(): Promise<void> {
    storage.available = await isStorageAvailable();
    if (!storage.available) {
      storage.error = "Stockage local indisponible (navigation privée ?). Utilisez les fichiers .cao3.json.";
      return;
    }
    await refreshLocalDocuments();
    const last = await latestDocument();
    if (last && document.value.features.length === 0) {
      const record = await loadDocumentRecord(last.id);
      if (record) {
        document.value = JSON.parse(record.json) as CadDocument;
        storage.lastSavedAt = record.updatedAt;
        build.value = null;
        scheduleRebuild("final", 0);
      }
    }
  }

  async function refreshLocalDocuments(): Promise<void> {
    storage.documents = await listDocuments();
  }

  /** Enregistre le document dans la base du navigateur (aucun envoi réseau). */
  async function saveToLocal(): Promise<boolean> {
    if (!storage.available) return false;
    storage.saving = true;
    try {
      const ok = await saveDocumentRecord({
        id: document.value.id,
        name: document.value.name,
        json: JSON.stringify(document.value),
        features: document.value.features.length,
        volume: build.value?.volume ?? null,
      });
      if (ok) storage.lastSavedAt = Date.now();
      else storage.error = "Enregistrement refusé (quota de stockage atteint ?).";
      await refreshLocalDocuments();
      return ok;
    } finally {
      storage.saving = false;
    }
  }

  async function openLocalDocument(id: string): Promise<void> {
    const record = await loadDocumentRecord(id);
    if (!record) return;
    snapshot("ouverture locale");
    document.value = JSON.parse(record.json) as CadDocument;
    storage.lastSavedAt = record.updatedAt;
    sketchSession.featureId = "";
    selection.value = null;
    scheduleRebuild("final", 0);
  }

  async function removeLocalDocument(id: string): Promise<void> {
    await deleteDocumentRecord(id);
    await refreshLocalDocuments();
  }

  /** Sauvegarde automatique : différée pour ne pas écrire à chaque frappe. */
  let autosaveTimer: number | null = null;
  function scheduleAutosave(delay = 1500): void {
    if (!storage.available) return;
    if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      void saveToLocal();
    }, delay);
  }

  const lastSavedLabel = computed(() => {
    if (!storage.available) return "stockage local indisponible";
    if (!storage.lastSavedAt) return "non enregistré";
    const time = new Date(storage.lastSavedAt);
    return `enregistré à ${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  });

  function loadDocument(json: string): void {
    const parsed = JSON.parse(json) as CadDocument;
    if (!parsed.features) throw new Error("Fichier invalide : clé « features » absente.");
    snapshot("ouverture");
    document.value = parsed;
    scheduleRebuild("final");
  }

  function serializeDocument(): string {
    return JSON.stringify(document.value, null, 2);
  }

  async function exportFile(format: "step" | "stl"): Promise<{ blob: Blob; fileName: string }> {
    await ensureKernel();
    const result = await kernel.exportFile(document.value, format);
    return {
      blob: new Blob([result.data.buffer as ArrayBuffer], { type: "application/octet-stream" }),
      fileName: result.fileName,
    };
  }

  async function solveOnce(sketch: SketchData): Promise<SolveResult> {
    return solverClient.solve(sketch);
  }

  return {
    document,
    features,
    activeSketchFeature,
    sketchSession,
    kernelStatus,
    kernelDetail,
    kernelInfo,
    solverDetail,
    build,
    buildError,
    rebuilding,
    selection,
    activeCommand,
    viewStyle,
    view,
    showGrid,
    lastBuildMs,
    warnings,
    errors,
    kernelReady,
    loadProgress,
    memory,
    memoryPressure,
    memoryLabel,
    triangles,
    refreshMemory,
    storage,
    lastSavedLabel,
    initStorage,
    saveToLocal,
    openLocalDocument,
    removeLocalDocument,
    refreshLocalDocuments,
    restartingKernel,
    releaseMemory,
    redownloadKernel,
    setSketchDragging,
    undoStackSize: computed(() => undoStack.length),
    redoStackSize: computed(() => redoStack.length),
    ensureKernel,
    rebuildNow,
    scheduleRebuild,
    undo,
    redo,
    startSketch,
    openSketch,
    closeSketch,
    mutateSketch,
    scheduleSolve,
    solveSketchNow,
    solveOnce,
    beginEdit,
    setDimensionValue,
    addConstraintToSelection,
    setSketchTool,
    deleteSelection,
    addExtrudeFromSketch,
    updateFeature,
    renameFeature,
    deleteFeature,
    toggleSuppress,
    selectFeature,
    startCommand,
    cancelCommand,
    commitCommand,
    newDocument,
    loadDemoPart,
    loadDocument,
    serializeDocument,
    exportFile,
    setSelection(info: SelectionInfo | null) {
      selection.value = info;
    },
  };
});
