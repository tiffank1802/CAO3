// @vitest-environment jsdom
/**
 * Test de fumée de l'interface (Lot 0/1).
 *
 * Le noyau, le solveur, le rendu three.js et le canvas Konva sont remplacés par des doublures :
 * on vérifie ici ce que `vue-tsc` ne peut pas voir — le câblage réel des rubans, du store,
 * des raccourcis clavier et des panneaux — et surtout que **chaque commande livrée est traitée**
 * par le registre de commandes d'`App.vue` (aucune commande « non disponible »).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --------------------------------------------------------------------------- doublures

/** État observable des doublures : c'est ce que les tests vérifient. */
const kernelCalls = vi.hoisted(() => ({
  initCalls: 0,
  rebuildQualities: [] as string[],
  restarts: 0,
}));

type AnyNode = Record<string, unknown> & { children: AnyNode[] };

function konvaNode(attrs: Record<string, unknown> = {}): AnyNode {
  const target: AnyNode = {
    attrs,
    children: [] as AnyNode[],
    add(...nodes: AnyNode[]) {
      target.children.push(...nodes);
      return target;
    },
    destroyChildren() {
      target.children.length = 0;
      return target;
    },
    destroy() {},
    batchDraw() {},
    on() {
      return target;
    },
    off() {
      return target;
    },
    setAttrs() {
      return target;
    },
    getPointerPosition() {
      return { x: 0, y: 0 };
    },
    container() {
      return { addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
    },
    width() {
      return 900;
    },
    height() {
      return 620;
    },
    size() {},
    x() {
      return 0;
    },
    y() {
      return 0;
    },
    scaleX() {
      return 1;
    },
    scaleY() {
      return 1;
    },
    destroyNode() {},
  };
  return new Proxy(target, {
    get(node, prop) {
      if (prop in node) return node[prop as string];
      // Toute méthode Konva non simulée devient un no-op chaînable : les tests ne portent
      // pas sur le rendu Konva mais sur la logique d'esquisse et le câblage de l'écran.
      return () => node;
    },
  });
}

vi.mock("konva", () => {
  const node = (attrs: Record<string, unknown> = {}) => konvaNode(attrs);
  class Shape {
    constructor(attrs: Record<string, unknown> = {}) {
      return node(attrs) as unknown as Shape;
    }
  }
  return {
    default: {
      Stage: Shape,
      Layer: Shape,
      Group: Shape,
      Rect: Shape,
      Line: Shape,
      Circle: Shape,
      Text: Shape,
      Arrow: Shape,
      Util: { haveIntersection: () => false },
    },
  };
});

vi.mock("@/cad/view/viewer", () => ({
  CadViewer: class {
    mesh: unknown = null;
    style = "shaded-edges";
    view = "iso";
    grid = true;
    frameAll(): void {}
    setMesh(mesh: unknown): void {
      this.mesh = mesh;
    }
    setStyle(style: string): void {
      this.style = style;
    }
    setView(view: string): void {
      this.view = view;
    }
    setGridVisible(visible: boolean): void {
      this.grid = visible;
    }
    capturePng(): string {
      return "data:image/png;base64,";
    }
    dispose(): void {}
  },
}));

vi.mock("@/cad/kernel/client", () => ({
  jsHeapBytes: () => 42 * 1024 * 1024,
  KernelClient: class {
    private listeners = new Set<(status: string) => void>();
    status = "ready";
    rebuildCalls = 0;
    onStatus(listener: (status: string) => void): () => void {
      this.listeners.add(listener);
      listener(this.status);
      return () => this.listeners.delete(listener);
    }
    onProgress(): () => void {
      return () => undefined;
    }
    async init(): Promise<void> {
      kernelCalls.initCalls += 1;
      this.status = "ready";
      for (const listener of this.listeners) listener("ready");
    }
    async rebuild(_document: unknown, quality: "preview" | "final") {
      this.rebuildCalls += 1;
      kernelCalls.rebuildQualities.push(quality);
      return {
        revision: this.rebuildCalls,
        mesh: null,
        states: [],
        totalMs: 12,
        volume: 80000,
        messages: [],
        heapBytes: 100 * 1024 * 1024,
        quality,
      };
    }
    async exportFile(_document: unknown, format: "step" | "stl") {
      return {
        format,
        data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        fileName: `Piece_test.${format}`,
        byteLength: 8,
      };
    }
    async restart(): Promise<void> {
      kernelCalls.restarts += 1;
    }
  },
}));

vi.mock("@/cad/kernel/solverClient", () => ({
  SolverClient: class {
    solveCalls = 0;
    async solve(): Promise<unknown> {
      this.solveCalls += 1;
      return { points: {}, radii: {}, status: 0, dof: 0, conflicts: [], redundant: [], ms: 1 };
    }
    terminate(): void {}
  },
}));

vi.mock("@/cad/io/storage", () => ({
  isStorageAvailable: vi.fn(async () => true),
  listDocuments: vi.fn(async () => [
    { id: "doc_local_1", name: "Support moteur", updatedAt: 1_760_000_000_000, features: 3, bytes: 2048, volume: 42100 },
  ]),
  latestDocument: vi.fn(async () => null),
  loadDocumentRecord: vi.fn(async () => ({
    id: "doc_local_1",
    name: "Support moteur",
    updatedAt: 1_760_000_000_000,
    features: 1,
    bytes: 512,
    volume: 100,
    json: JSON.stringify({
      schema: "cao3/document@1",
      id: "doc_local_1",
      name: "Support moteur",
      units: { length: "mm", decimals: 2 },
      features: [],
    }),
  })),
  saveDocumentRecord: vi.fn(async () => true),
  deleteDocumentRecord: vi.fn(async () => true),
}));

vi.mock("@/cad/io/download", () => ({
  downloadBlob: vi.fn(),
  downloadText: vi.fn(),
  openLocalFile: vi.fn(async () => null),
}));

// --------------------------------------------------------------------------- imports

import { beforeAll } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import App from "@/App.vue";
import { useCadStore } from "@/cad/core/documentStore";
import { isSketchFeature } from "@/cad/core/types";
import { RIBBON_TABS } from "@/cad/ui/ribbonDefs";
import { downloadText } from "@/cad/io/download";

beforeAll(() => {
  // jsdom ne fournit pas ResizeObserver (utilisé par le canvas d'esquisse).
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  kernelCalls.initCalls = 0;
  kernelCalls.rebuildQualities = [];
  kernelCalls.restarts = 0;
});

async function mountApp(): Promise<VueWrapper> {
  const wrapper = mount(App, { global: { plugins: [createPinia()] } });
  await settle();
  return wrapper;
}

/**
 * L'application diffère le démarrage du noyau jusqu'à la première image affichée
 * (`requestAnimationFrame`) : les tests doivent laisser passer deux images, sinon le noyau
 * n'est jamais initialisé. `flushPromises()` seul ne suffit pas (il ne vide que les micro-tâches).
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
  await flushPromises();
}

function tabByTitle(wrapper: VueWrapper, title: string) {
  const tab = wrapper.findAll(".ribbon-tab").find((t) => t.text() === title);
  if (!tab) throw new Error(`onglet « ${title} » introuvable`);
  return tab;
}

async function openTab(wrapper: VueWrapper, title: string): Promise<void> {
  await tabByTitle(wrapper, title).trigger("click");
  await flushPromises();
}

function commandByLabel(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll(".ribbon-command").find((b) => b.text().includes(label));
  if (!button) throw new Error(`commande « ${label} » introuvable`);
  return button;
}

async function clickCommand(wrapper: VueWrapper, label: string): Promise<void> {
  await commandByLabel(wrapper, label).trigger("click");
  await flushPromises();
}

/** Raccourci clavier global. `trigger()` de VTU ne renseigne pas `event.key` : on émet un vrai événement. */
async function press(key: string, options: KeyboardEventInit = {}): Promise<void> {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
  await flushPromises();
}

// --------------------------------------------------------------------------- tests

describe("Écran principal", () => {
  it("affiche les 8 onglets du ruban et les panneaux SolidWorks", async () => {
    const wrapper = await mountApp();
    expect(wrapper.findAll(".ribbon-tab").map((t) => t.text())).toEqual([
      "Fichier",
      "Esquisse",
      "Fonctions",
      "Assemblage",
      "Mise en plan",
      "Évaluation",
      "Affichage",
      "Outils",
    ]);
    expect(wrapper.find(".tree").exists()).toBe(true);
    expect(wrapper.find(".pm").exists()).toBe(true);
    expect(wrapper.find(".status").exists()).toBe(true);
    expect(wrapper.text()).toContain("OpenCascade");
  });

  it("respecte la convention « visible mais désactivé » pour les commandes des lots suivants", async () => {
    const wrapper = await mountApp();
    await openTab(wrapper, "Fichier");
    const importStep = commandByLabel(wrapper, "Importer STEP");
    expect(importStep.classes()).toContain("disabled");
    expect(importStep.attributes("title")).toContain("lot 3");

    const store = useCadStore();
    await importStep.trigger("click");
    expect(store.activeCommand).toBeNull();
    expect(wrapper.find(".toast").exists()).toBe(false);
  });

  it("démarre une esquisse, change d'outil et revient par Échap", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();

    await clickCommand(wrapper, "Nouvelle esquisse");
    // Convention SW : la commande s'ouvre dans le PropertyManager, la validation crée l'esquisse.
    expect(store.activeCommand?.id).toBe("sketch");
    await press("Enter");
    expect(store.sketchSession.featureId).toBeTruthy();
    expect(store.activeSketchFeature).not.toBeNull();
    // Le PropertyManager devient le « command manager » de l'esquisse.
    expect(wrapper.text()).toContain("Quitter l'esquisse");
    expect(wrapper.text()).toContain("Esquisse entièrement contrainte");

    await clickCommand(wrapper, "Cercle");
    expect(store.sketchSession.tool).toBe("circle");
    await clickCommand(wrapper, "Rectangle par centre");
    expect(store.sketchSession.tool).toBe("rectangle-center");

    // Raccourcis d'esquisse
    await press("l");
    expect(store.sketchSession.tool).toBe("line");
    await press("s");
    expect(store.sketchSession.tool).toBe("select");

    // Échap ne doit pas quitter l'esquisse mais revenir à l'outil de sélection
    await clickCommand(wrapper, "Cercle");
    expect(store.sketchSession.tool).toBe("circle");
    await press("Escape");
    expect(store.activeSketchFeature).not.toBeNull();
    expect(store.sketchSession.tool).toBe("select");

    await clickCommand(wrapper, "Quitter l'esquisse");
    expect(store.activeSketchFeature).toBeNull();
  });

  it("câble la commande Bossage : ouverture, validation par Entrée, annulation, historique", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();

    // Une esquisse vide suffit : le bossage est une simple fonction de l'arbre.
    store.startSketch();
    store.closeSketch();
    await flushPromises();

    await openTab(wrapper, "Fonctions");
    await clickCommand(wrapper, "Bossage extrudé");
    expect(store.activeCommand?.id).toBe("extrude");
    expect(wrapper.text()).toContain("Profondeur");

    await press("Enter");
    expect(store.features.filter((f) => f.type === "extrude")).toHaveLength(1);

    // Annuler la fonction via l'historique (Ctrl+Z)
    await press("z", { ctrlKey: true });
    expect(store.features.filter((f) => f.type === "extrude")).toHaveLength(0);

    // Rétablir (Ctrl+Y)
    await press("y", { ctrlKey: true });
    expect(store.features.filter((f) => f.type === "extrude")).toHaveLength(1);
  });

  it("enregistre le document en JSON et change de style de vue", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();

    await openTab(wrapper, "Fichier");
    await clickCommand(wrapper, "Document (.cao3.json)");
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [json, fileName] = (downloadText as unknown as { mock: { calls: string[][] } }).mock.calls[0];
    expect(fileName).toMatch(/\.cao3\.json$/);
    expect(JSON.parse(json).schema).toBe("cao3/document@1");

    await openTab(wrapper, "Affichage");
    await clickCommand(wrapper, "Filaire");
    expect(store.viewStyle).toBe("wireframe");
    await clickCommand(wrapper, "Dessus");
    expect(store.view).toBe("top");
  });

  it("charge la pièce de démonstration : esquisse entièrement contrainte + bossage", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();
    expect(wrapper.text()).toContain("Charger la pièce de démonstration");

    await openTab(wrapper, "Fichier");
    await clickCommand(wrapper, "Pièce de démonstration");

    expect(store.features.map((f) => f.type)).toEqual(["sketch", "extrude"]);
    expect(store.document.name).toBe("Démonstration");

    const sketch = store.features.find(isSketchFeature);
    expect(sketch).toBeDefined();
    // origine + 4 coins, 4 lignes, 4 contraintes H/V + 1 symétrie, 2 cotes
    expect(sketch!.sketch.points).toHaveLength(5);
    expect(sketch!.sketch.entities).toHaveLength(4);
    expect(sketch!.sketch.constraints).toHaveLength(5);
    expect(sketch!.sketch.dimensions.map((d) => d.value).sort((a, b) => a - b)).toEqual([50, 80]);

    // La reconstruction a été déclenchée par la nouvelle pièce
    expect(store.lastBuildMs).toBeGreaterThanOrEqual(0);
    expect(wrapper.text()).toContain("Bossage1");
  });

  it("affiche la progression réelle du téléchargement du noyau (chargement progressif)", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();

    store.kernelStatus = "loading";
    store.loadProgress = { phase: "téléchargement du noyau", loaded: 5 * 1048576, total: 10 * 1048576, fraction: 0.5 };
    await flushPromises();

    const loader = wrapper.find(".loader");
    expect(loader.exists()).toBe(true);
    expect(loader.text()).toContain("50 %");
    expect(loader.text()).toContain("5.0 Mo / 10.0 Mo");
    expect(wrapper.find(".loader-bar i").attributes("style")).toContain("50%");
  });

  it("prévient avant la saturation mémoire et sait libérer la mémoire du noyau", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();

    expect(wrapper.find(".memory-banner").exists()).toBe(false);

    // 1,1 Go de tas WASM : au-delà du seuil d'alerte.
    store.memory.heapBytes = 1_100 * 1024 * 1024;
    await flushPromises();
    expect(store.memoryPressure).toBe("noyau");
    const banner = wrapper.find(".memory-banner");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Libérer la mémoire");

    await banner.find("button").trigger("click");
    await flushPromises();
    // Le worker fautif est tué : c'est la seule façon de récupérer le tas WASM.
    expect(kernelCalls.restarts).toBe(1);
    expect(store.memory.heapBytes).not.toBe(1_100 * 1024 * 1024);
    expect(wrapper.find(".memory-banner").exists()).toBe(false);
  });

  it("allège la tessellation automatiquement au-delà du budget de triangles", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();

    // Maillage au-delà du budget : la qualité « finale » est rétrogradée en « aperçu ».
    store.build = {
      revision: 1,
      mesh: { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), faceIds: new Uint32Array(0), edgeLines: new Float32Array(0), edgeIds: new Uint32Array(0), triangleCount: 900_000 },
      states: [],
      totalMs: 20,
      volume: 1000,
      messages: [],
      heapBytes: 100 * 1024 * 1024,
    } as never;
    await flushPromises();
    expect(wrapper.find(".status").text()).toContain("900");

    kernelCalls.rebuildQualities = [];
    await store.rebuildNow();
    // La qualité « finale » est rétrogradée en « aperçu » : le navigateur garde un maillage gérable.
    expect(kernelCalls.rebuildQualities).toContain("preview");
    expect(kernelCalls.rebuildQualities).not.toContain("final");
  });

  it("conserve le document dans le navigateur (IndexedDB) et sait le rouvrir", async () => {
    const wrapper = await mountApp();
    const store = useCadStore();

    // Sauvegarde explicite depuis le ruban
    await openTab(wrapper, "Fichier");
    await clickCommand(wrapper, "Enregistrer en local");
    expect(store.storage.available).toBe(true);
    expect(store.storage.lastSavedAt).toBeGreaterThan(0);
    expect(store.lastSavedLabel).toMatch(/^enregistré à \d{2}:\d{2}$/);

    // Liste des documents locaux → reprise d'une pièce
    await clickCommand(wrapper, "Documents locaux");
    const modal = wrapper.findAll(".modal").find((m) => m.text().includes("Documents locaux"));
    expect(modal).toBeDefined();
    expect(modal!.text()).toContain("Support moteur");
    expect(modal!.text()).toContain("IndexedDB");

    await modal!.find(".doc-name").trigger("click");
    await flushPromises();
    expect(store.document.name).toBe("Support moteur");
    expect(wrapper.findAll(".modal").find((m) => m.text().includes("Documents locaux"))).toBeUndefined();
  });

  it("traite TOUTES les commandes livrées du ruban (aucune commande non câblée)", async () => {
    const wrapper = await mountApp();
    const unhandled: string[] = [];

    for (const tab of RIBBON_TABS) {
      await openTab(wrapper, tab.title);
      for (const group of tab.groups) {
        for (const command of group.commands) {
          if (command.disabled) continue;
          // On repart d'un état propre : certaines commandes ouvrent une esquisse ou une fonction.
          const store = useCadStore();
          store.cancelCommand();
          store.closeSketch();
          await commandByLabel(wrapper, command.label).trigger("click");
          await flushPromises();
          if (wrapper.text().includes("non disponible dans cette version")) unhandled.push(command.id);
          if (wrapper.find(".toast").exists()) {
            if (wrapper.find(".toast").text().includes("non disponible dans cette version")) unhandled.push(command.id);
          }
        }
      }
    }

    expect(unhandled).toEqual([]);
  });
});
