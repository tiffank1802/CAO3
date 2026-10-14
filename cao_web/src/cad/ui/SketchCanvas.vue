<script setup lang="ts">
/**
 * Canvas d'esquisse 2D (Konva).
 *
 * Comportements calqués sur SolidWorks :
 *  - création par glisser (rectangle par centre / par 2 coins, cercle, ligne) ;
 *  - accrochage à la grille ET aux points existants (réutilisation du point ⇒ contrainte de coïncidence) ;
 *  - glisser un point ou un rayon ⇒ le solveur reprend la main en direct ;
 *  - clic sur une cote ⇒ saisie de la valeur (le solveur met la géométrie à jour) ;
 *  - couleur des entités : bleu = sous-contraint, blanc = entièrement contraint (convention SW).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Konva from "konva";
import { useCadStore } from "../core/documentStore";
import {
  addCircleAt,
  addDimension,
  addLineEntity,
  addRectangleCentered,
  addRectangleFromCorners,
  findPointNear,
  sketchBounds,
} from "../sketch/model";
import type { SketchData, Vec2 } from "../core/types";

const store = useCadStore();
const container = ref<HTMLDivElement | null>(null);
const scale = ref(5);
const center = ref<Vec2>({ x: 0, y: 0 });
const size = ref({ width: 900, height: 620 });
const hint = ref("");
const dimEditor = ref<{ id: string; value: number; left: number; top: number } | null>(null);

let stage: Konva.Stage | null = null;
let gridLayer: Konva.Layer;
let geoLayer: Konva.Layer;
let overlayLayer: Konva.Layer;

let dragging: { kind: "point" | "radius" | "pan"; id: string; last: Vec2 } | null = null;
let draft: { a: Vec2; b: Vec2; tool: string; existingId: string | null } | null = null;
let hover: Vec2 | null = null;

const sketch = computed<SketchData | null>(() => store.activeSketchFeature?.sketch ?? null);
const fullyConstrained = computed(() => store.sketchSession.dof === 0 && store.sketchSession.conflicts.length === 0);
const entityColor = computed(() => (fullyConstrained.value ? "#e6ebf2" : "#4aa3ff"));

function toScreen(p: Vec2): Vec2 {
  return {
    x: (p.x - center.value.x) * scale.value + size.value.width / 2,
    y: size.value.height / 2 - (p.y - center.value.y) * scale.value,
  };
}

function toModel(p: Vec2): Vec2 {
  return {
    x: (p.x - size.value.width / 2) / scale.value + center.value.x,
    y: (size.value.height / 2 - p.y) / scale.value + center.value.y,
  };
}

function gridStepMm(): number {
  const base = sketch.value?.gridStep ?? 1;
  let step = base;
  while (step * scale.value < 14) step *= 5;
  while (step * scale.value > 160) step /= 5;
  return step;
}

function snap(position: Vec2, reusePoints: boolean, tolerancePx = 9): { point: Vec2; existingId: string | null } {
  const data = sketch.value;
  if (!data) return { point: position, existingId: null };
  const existingId = reusePoints ? findPointNear(data, position, tolerancePx / scale.value) : null;
  if (existingId) {
    const point = data.points.find((p) => p.id === existingId)!;
    return { point: { x: point.x, y: point.y }, existingId };
  }
  const step = gridStepMm();
  return { point: { x: Math.round(position.x / step) * step, y: Math.round(position.y / step) * step }, existingId: null };
}

function drawGrid(): void {
  gridLayer.destroyChildren();
  const step = gridStepMm();
  const topLeft = toModel({ x: 0, y: 0 });
  const bottomRight = toModel({ x: size.value.width, y: size.value.height });
  const firstX = Math.floor(topLeft.x / step) * step;
  const firstY = Math.floor(bottomRight.y / step) * step;
  for (let x = firstX; x <= bottomRight.x; x += step) {
    const from = toScreen({ x, y: bottomRight.y });
    const to = toScreen({ x, y: topLeft.y });
    gridLayer.add(new Konva.Line({ points: [from.x, from.y, to.x, to.y], stroke: "#2a313b", strokeWidth: 1, listening: false }));
  }
  for (let y = firstY; y <= topLeft.y; y += step) {
    const from = toScreen({ x: topLeft.x, y });
    const to = toScreen({ x: bottomRight.x, y });
    gridLayer.add(new Konva.Line({ points: [from.x, from.y, to.x, to.y], stroke: "#2a313b", strokeWidth: 1, listening: false }));
  }
  // Axes de l'esquisse
  const origin = toScreen({ x: 0, y: 0 });
  gridLayer.add(new Konva.Line({ points: [0, origin.y, size.value.width, origin.y], stroke: "#5c3b3f", strokeWidth: 1.2, listening: false }));
  gridLayer.add(new Konva.Line({ points: [origin.x, 0, origin.x, size.value.height], stroke: "#3b5340", strokeWidth: 1.2, listening: false }));
  gridLayer.add(
    new Konva.Text({ x: origin.x + 6, y: origin.y + 4, text: `${step} mm`, fill: "#5b6675", fontSize: 11, listening: false }),
  );
}

function drawGeometry(): void {
  geoLayer.destroyChildren();
  const data = sketch.value;
  if (!data) return;
  const selected = new Set(store.sketchSession.selectedIds);
  const conflicts = new Set(store.sketchSession.conflicts);

  for (const entity of data.entities) {
    if (entity.kind === "line") {
      const p1 = data.points.find((p) => p.id === entity.p1);
      const p2 = data.points.find((p) => p.id === entity.p2);
      if (!p1 || !p2) continue;
      const a = toScreen(p1);
      const b = toScreen(p2);
      const isSelected = selected.has(entity.id);
      geoLayer.add(
        new Konva.Line({
          points: [a.x, a.y, b.x, b.y],
          stroke: isSelected ? "#39d353" : entityColor.value,
          strokeWidth: isSelected ? 2.6 : 2,
          hitStrokeWidth: 10,
          id: `entity:${entity.id}`,
        }),
      );
      // Badges de contraintes implicites (H / V / =)
      const badges = data.constraints
        .filter((c) => c.lines?.includes(entity.id))
        .map((c) => (c.kind === "horizontal" ? "H" : c.kind === "vertical" ? "V" : c.kind === "equal" ? "=" : ""))
        .filter(Boolean)
        .join(" ");
      if (badges) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        geoLayer.add(
          new Konva.Text({ x: mid.x + 5, y: mid.y - 14, text: badges, fill: "#7d8b9e", fontSize: 11, listening: false }),
        );
      }
    } else {
      const centerPoint = data.points.find((p) => p.id === entity.center);
      if (!centerPoint) continue;
      const c = toScreen(centerPoint);
      const isSelected = selected.has(entity.id);
      geoLayer.add(
        new Konva.Circle({
          x: c.x,
          y: c.y,
          radius: entity.radius * scale.value,
          stroke: isSelected ? "#39d353" : entityColor.value,
          strokeWidth: isSelected ? 2.6 : 2,
          hitStrokeWidth: 10,
          id: `entity:${entity.id}`,
        }),
      );
    }
  }

  // Points (poignées)
  for (const point of data.points) {
    const p = toScreen(point);
    const isOrigin = point.id === data.originId;
    const isSelected = selected.has(point.id);
    if (isOrigin) {
      geoLayer.add(new Konva.Line({ points: [p.x - 7, p.y, p.x + 7, p.y], stroke: "#ff6b6b", strokeWidth: 1.4, listening: false }));
      geoLayer.add(new Konva.Line({ points: [p.x, p.y - 7, p.x, p.y + 7], stroke: "#69db7c", strokeWidth: 1.4, listening: false }));
    }
    geoLayer.add(
      new Konva.Rect({
        x: p.x - 3.5,
        y: p.y - 3.5,
        width: 7,
        height: 7,
        fill: isSelected ? "#39d353" : point.fixed ? "#9aa7b8" : "#ffffff",
        stroke: "#141821",
        strokeWidth: 1,
        id: `point:${point.id}`,
      }),
    );
  }

  // Cotes
  for (const dimension of data.dimensions) {
    const isConflict = conflicts.has(dimension.id);
    let anchor: Vec2 | null = null;
    let label = "";
    if (dimension.kind === "radius" || dimension.kind === "diameter") {
      const entity = data.entities.find((e) => e.id === dimension.circle && e.kind === "circle");
      if (entity && entity.kind === "circle") {
        const c = data.points.find((p) => p.id === entity.center);
        if (!c) continue;
        anchor = toScreen({ x: c.x + entity.radius, y: c.y });
        label = `${dimension.kind === "radius" ? "R" : "Ø"}${dimension.value.toFixed(1)}`;
      }
    } else if (dimension.points && dimension.points.length === 2) {
      const p1 = data.points.find((p) => p.id === dimension.points![0]);
      const p2 = data.points.find((p) => p.id === dimension.points![1]);
      if (!p1 || !p2) continue;
      const a = toScreen(p1);
      const b = toScreen(p2);
      anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      geoLayer.add(
        new Konva.Line({
          points: [a.x, a.y, b.x, b.y],
          stroke: isConflict ? "#f85149" : "#8b98a9",
          strokeWidth: 1,
          dash: [4, 3],
          listening: false,
        }),
      );
      label = `${dimension.value.toFixed(1)}`;
    }
    if (!anchor) continue;
    const text = new Konva.Text({ text: label, fontSize: 12, fill: isConflict ? "#ffb3ae" : "#dfe6ef", padding: 3 });
    const group = new Konva.Group({ x: anchor.x, y: anchor.y - 18, id: `dimension:${dimension.id}` });
    group.add(
      new Konva.Rect({
        width: text.width() + 6,
        height: text.height() + 2,
        fill: isConflict ? "#5a1f1c" : "#2b3441",
        stroke: isConflict ? "#f85149" : "#48566a",
        cornerRadius: 3,
      }),
    );
    text.position({ x: 3, y: 1 });
    group.add(text);
    group.on("pointerdown", (event) => {
      event.cancelBubble = true;
      openDimensionEditor(dimension.id, dimension.value, group);
    });
    geoLayer.add(group);
  }
}

function drawOverlay(): void {
  overlayLayer.destroyChildren();
  if (draft) {
    const a = toScreen(draft.a);
    const b = toScreen(draft.b);
    const stroke = "#ffa726";
    if (draft.tool === "circle") {
      overlayLayer.add(
        new Konva.Circle({ x: a.x, y: a.y, radius: Math.hypot(b.x - a.x, b.y - a.y), stroke, strokeWidth: 1.6, dash: [6, 4], listening: false }),
      );
      const radiusMm = Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y);
      overlayLayer.add(new Konva.Text({ x: b.x + 8, y: b.y - 8, text: `R ${radiusMm.toFixed(1)} mm`, fill: stroke, fontSize: 12, listening: false }));
    } else if (draft.tool === "rectangle-center") {
      const w = Math.abs(draft.b.x - draft.a.x) * 2;
      const h = Math.abs(draft.b.y - draft.a.y) * 2;
      overlayLayer.add(
        new Konva.Rect({
          x: a.x - (w / 2) * scale.value,
          y: a.y - (h / 2) * scale.value,
          width: w * scale.value,
          height: h * scale.value,
          stroke,
          strokeWidth: 1.6,
          dash: [6, 4],
          listening: false,
        }),
      );
      overlayLayer.add(new Konva.Text({ x: b.x + 8, y: b.y - 8, text: `${w.toFixed(1)} × ${h.toFixed(1)} mm`, fill: stroke, fontSize: 12, listening: false }));
    } else if (draft.tool === "rectangle-corners") {
      overlayLayer.add(
        new Konva.Rect({
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
          stroke,
          strokeWidth: 1.6,
          dash: [6, 4],
          listening: false,
        }),
      );
    } else if (draft.tool === "line") {
      overlayLayer.add(new Konva.Line({ points: [a.x, a.y, b.x, b.y], stroke, strokeWidth: 1.6, dash: [6, 4], listening: false }));
    }
  }
  if (hover) {
    const h = toScreen(hover);
    overlayLayer.add(new Konva.Rect({ x: h.x - 4, y: h.y - 4, width: 8, height: 8, stroke: "#ffa726", strokeWidth: 1, listening: false }));
  }
}

function redraw(): void {
  if (!stage) return;
  drawGrid();
  drawGeometry();
  drawOverlay();
  gridLayer.batchDraw();
  geoLayer.batchDraw();
  overlayLayer.batchDraw();
}

// ---------------------------------------------------------------- interactions

function pointerModel(pointer: Konva.Vector2d): Vec2 {
  return toModel({ x: pointer.x, y: pointer.y });
}

function onPointerDown(event: Konva.KonvaEventObject<PointerEvent>): void {
  if (!sketch.value) return;
  const evt = event.evt;
  const target = event.target;
  const targetId = target?.id?.() ?? "";

  if (evt.button === 1 || evt.button === 2 || evt.altKey) {
    dragging = { kind: "pan", id: "", last: pointerModel(stage!.getPointerPosition()!) };
    return;
  }

  const tool = store.sketchSession.tool;
  const position = pointerModel(stage!.getPointerPosition()!);

  if (tool === "select") {
    if (targetId.startsWith("point:")) {
      const id = targetId.slice("point:".length);
      store.beginEdit("déplacement de point");
      store.sketchSession.selectedIds = [id];
      dragging = { kind: "point", id, last: position };
      return;
    }
    if (targetId.startsWith("entity:")) {
      const id = targetId.slice("entity:".length);
      const entity = sketch.value.entities.find((e) => e.id === id);
      store.sketchSession.selectedIds = [id];
      if (entity && entity.kind === "circle") {
        const centerPoint = sketch.value.points.find((p) => p.id === entity.center);
        if (centerPoint && Math.hypot(position.x - centerPoint.x, position.y - centerPoint.y) > entity.radius * 0.85) {
          store.beginEdit("modification du rayon");
          dragging = { kind: "radius", id, last: position };
        }
      }
      redraw();
      return;
    }
    store.sketchSession.selectedIds = [];
    redraw();
    return;
  }

  if (tool === "dimension") {
    applyDimensionTool(targetId);
    return;
  }

  const snapped = snap(position, true);
  draft = { a: snapped.point, b: snapped.point, tool, existingId: snapped.existingId };
  redraw();
}

function onPointerMove(event: Konva.KonvaEventObject<PointerEvent>): void {
  if (!stage) return;
  const position = pointerModel(stage.getPointerPosition()!);
  hover = position;

  if (dragging?.kind === "pan") {
    const delta = { x: position.x - dragging.last.x, y: position.y - dragging.last.y };
    center.value = { x: center.value.x - delta.x, y: center.value.y - delta.y };
    dragging.last = position;
    redraw();
    return;
  }

  if (dragging?.kind === "point" && sketch.value) {
    const data = sketch.value;
    const point = data.points.find((p) => p.id === dragging!.id);
    if (point && !point.fixed) {
      const snapped = snap(position, false);
      point.x = snapped.point.x;
      point.y = snapped.point.y;
      store.scheduleSolve(30);
      redraw();
    }
    return;
  }

  if (dragging?.kind === "radius" && sketch.value) {
    const data = sketch.value;
    const entity = data.entities.find((e) => e.id === dragging!.id);
    if (entity && entity.kind === "circle") {
      const centerPoint = data.points.find((p) => p.id === entity.center);
      if (centerPoint) {
        const radius = Math.max(0.5, Math.hypot(position.x - centerPoint.x, position.y - centerPoint.y));
        entity.radius = Math.round(radius * 100) / 100;
        store.scheduleSolve(30);
        redraw();
      }
    }
    return;
  }

  if (draft) {
    const snapped = snap(position, true);
    draft.b = snapped.point;
  }
  redraw();
}

function onPointerUp(): void {
  if (!sketch.value) {
    dragging = null;
    return;
  }
  if (dragging?.kind === "point" || dragging?.kind === "radius") {
    dragging = null;
    void store.solveSketchNow();
    return;
  }
  if (dragging?.kind === "pan") {
    dragging = null;
    return;
  }
  if (!draft) return;

  const { a, b, tool, existingId } = draft;
  draft = null;
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const minimum = (sketch.value.gridStep || 1) * 0.9;

  if (tool === "circle" && distance >= minimum) {
    const snappedCenter = snap(a, true);
    store.mutateSketch("cercle", (data) => addCircleAt(data, snappedCenter.point, Math.round(distance * 100) / 100, snappedCenter.existingId));
    hint.value = `Cercle R${distance.toFixed(1)} créé (cote de rayon ajoutée)`;
  } else if (tool === "rectangle-center" && width >= minimum && height >= minimum) {
    const snappedCenter = snap(a, true);
    store.mutateSketch("rectangle par centre", (data) =>
      addRectangleCentered(data, snappedCenter.point, Math.round(width * 2 * 100) / 100, Math.round(height * 2 * 100) / 100),
    );
    hint.value = `Rectangle ${(width * 2).toFixed(1)} × ${(height * 2).toFixed(1)} créé avec cotes et symétrie`;
  } else if (tool === "rectangle-corners" && width >= minimum && height >= minimum) {
    const snappedA = snap(a, true);
    const snappedB = snap(b, true);
    store.mutateSketch("rectangle 2 coins", (data) =>
      addRectangleFromCorners(data, snappedA.point, snappedB.point, snappedA.existingId),
    );
    hint.value = `Rectangle ${width.toFixed(1)} × ${height.toFixed(1)} créé`;
  } else if (tool === "line" && distance >= minimum) {
    const snappedA = snap(a, true);
    const snappedB = snap(b, true);
    store.mutateSketch("ligne", (data) =>
      addLineEntity(data, snappedA.point, snappedB.point, snappedA.existingId, snappedB.existingId),
    );
    hint.value = "Ligne créée (contraintes horizontale/verticale inférées si pertinent)";
  } else {
    hint.value = "Entité trop petite ou non fermée : aucune création.";
  }
  void existingId;
  redraw();
}

/** Cotation intelligente : clic sur une arête, un cercle, ou deux points. */
function applyDimensionTool(targetId: string): void {
  const data = sketch.value;
  if (!data) return;
  if (targetId.startsWith("entity:")) {
    const id = targetId.slice("entity:".length);
    const entity = data.entities.find((e) => e.id === id);
    if (!entity) return;
    store.mutateSketch("cotation", (draftSketch) => {
      const target = draftSketch.entities.find((e) => e.id === id);
      if (!target) return;
      if (target.kind === "circle") {
        addDimension(draftSketch, "radius", { circle: id }, Math.round(target.radius * 100) / 100);
      } else {
        const p1 = draftSketch.points.find((p) => p.id === target.p1);
        const p2 = draftSketch.points.find((p) => p.id === target.p2);
        const length = p1 && p2 ? Math.hypot(p2.x - p1.x, p2.y - p1.y) : 10;
        addDimension(draftSketch, "length", { points: [target.p1, target.p2] }, Math.round(length * 100) / 100);
      }
    });
    hint.value = "Cote ajoutée — cliquez dessus pour saisir la valeur";
    return;
  }
  if (targetId.startsWith("point:")) {
    const id = targetId.slice("point:".length);
    const selected = store.sketchSession.selectedIds;
    if (selected.length === 0 || !selected[0].startsWith("p_")) {
      store.sketchSession.selectedIds = [id];
      hint.value = "Premier point sélectionné — cliquez un second point pour coter une distance";
      return;
    }
    const first = selected[0];
    const p1 = data.points.find((p) => p.id === first);
    const p2 = data.points.find((p) => p.id === id);
    if (!p1 || !p2 || first === id) return;
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    store.mutateSketch("cotation de distance", (draftSketch) => {
      addDimension(draftSketch, "distance", { points: [first, id] }, Math.round(distance * 100) / 100);
    });
    store.sketchSession.selectedIds = [];
    hint.value = "Cote de distance ajoutée";
  }
  redraw();
}

function onWheel(event: Konva.KonvaEventObject<WheelEvent>): void {
  event.evt.preventDefault();
  const pointer = stage!.getPointerPosition();
  if (!pointer) return;
  const before = toModel({ x: pointer.x, y: pointer.y });
  const factor = event.evt.deltaY < 0 ? 1.12 : 1 / 1.12;
  scale.value = Math.min(80, Math.max(0.4, scale.value * factor));
  const after = toModel({ x: pointer.x, y: pointer.y });
  center.value = { x: center.value.x + (before.x - after.x), y: center.value.y + (before.y - after.y) };
  redraw();
}

// ---------------------------------------------------------------- cotation (édition)

function openDimensionEditor(dimensionId: string, value: number, node: Konva.Group): void {
  const box = node.getClientRect();
  dimEditor.value = { id: dimensionId, value, left: box.x, top: box.y - 6 };
}

function commitDimension(): void {
  const editor = dimEditor.value;
  if (!editor) return;
  store.setDimensionValue(editor.id, Number(editor.value));
  dimEditor.value = null;
  hint.value = "Cote mise à jour — le solveur a repositionné la géométrie";
}

function fitView(): void {
  const data = sketch.value;
  if (!data || data.points.length === 0 || !container.value) return;
  const bounds = sketchBounds(data);
  const width = Math.max(bounds.max.x - bounds.min.x, 10);
  const height = Math.max(bounds.max.y - bounds.min.y, 10);
  center.value = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
  scale.value = Math.min(size.value.width / (width * 1.6), size.value.height / (height * 1.6));
  scale.value = Math.min(60, Math.max(0.5, scale.value));
  redraw();
}

defineExpose({ fitView });

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!container.value) return;
  const width = container.value.clientWidth;
  const height = container.value.clientHeight;
  size.value = { width, height };
  stage = new Konva.Stage({ container: container.value, width, height });
  gridLayer = new Konva.Layer({ listening: false });
  geoLayer = new Konva.Layer();
  overlayLayer = new Konva.Layer({ listening: false });
  stage.add(gridLayer, geoLayer, overlayLayer);

  stage.on("pointerdown", onPointerDown);
  stage.on("pointermove", onPointerMove);
  stage.on("pointerup", onPointerUp);
  stage.on("wheel", onWheel);
  stage.container().addEventListener("contextmenu", (event) => event.preventDefault());

  resizeObserver = new ResizeObserver(() => {
    if (!container.value || !stage) return;
    size.value = { width: container.value.clientWidth, height: container.value.clientHeight };
    stage.size(size.value);
    redraw();
  });
  resizeObserver.observe(container.value);
  fitView();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  stage?.destroy();
  stage = null;
});

watch(
  () => JSON.stringify(store.activeSketchFeature?.sketch ?? {}),
  () => redraw(),
);
watch(
  () => store.sketchSession.tool,
  () => {
    hint.value = "";
    redraw();
  },
);

</script>

<template>
  <div class="sketch-wrap">
    <div ref="container" class="sketch-canvas" />
    <div v-if="dimEditor" class="dim-editor" :style="{ left: `${dimEditor.left}px`, top: `${dimEditor.top}px` }">
      <input
        v-model.number="dimEditor.value"
        type="number"
        step="0.5"
        autofocus
        @keydown.enter.stop="commitDimension"
        @keydown.esc.stop="dimEditor = null"
        @blur="commitDimension"
      />
    </div>
    <div class="sketch-hud">
      <span class="hud-chip">{{ fullyConstrained ? "Esquisse entièrement contrainte" : `${store.sketchSession.dof} degré(s) de liberté` }}</span>
      <span class="hud-chip">Outil : {{ store.sketchSession.tool }}</span>
      <span class="hud-chip">Échelle {{ scale.toFixed(1) }} px/mm</span>
      <span v-if="store.sketchSession.conflicts.length" class="hud-chip error">Conflit : {{ store.sketchSession.conflicts.join(", ") }}</span>
      <span v-if="hint" class="hud-chip hint">{{ hint }}</span>
    </div>
  </div>
</template>

<style scoped>
.sketch-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  background: #191d24;
}

.sketch-canvas {
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.dim-editor {
  position: absolute;
  width: 90px;
  transform: translate(-50%, -100%);
  z-index: 5;
}

.sketch-hud {
  position: absolute;
  left: 12px;
  bottom: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  pointer-events: none;
}

.hud-chip {
  background: #232a34;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 3px 9px;
  font-size: 11px;
  color: var(--text-dim);
}

.hud-chip.error {
  border-color: var(--error);
  color: #ffb3ae;
}

.hud-chip.hint {
  color: #cbd5e1;
}
</style>
