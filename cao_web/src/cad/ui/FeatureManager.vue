<script setup lang="ts">
/** Arbre de construction (FeatureManager) : état, édition, compression, suppression. */
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { useCadStore } from "../core/documentStore";
import { isSketchFeature } from "../core/types";

const store = useCadStore();
const renamingId = ref<string | null>(null);
const renameValue = ref("");

const states = computed(() => new Map((store.build?.states ?? []).map((s) => [s.featureId, s])));

function stateIcon(featureId: string): { icon: string; color: string; title: string } {
  const state = states.value.get(featureId);
  if (!state) return { icon: "info", color: "var(--text-dim)", title: "non reconstruit" };
  if (state.status === "ok") return { icon: "info", color: "var(--ok)", title: `OK · ${state.ms.toFixed(0)} ms` };
  if (state.status === "error") return { icon: "info", color: "var(--error)", title: state.message };
  return { icon: "info", color: "var(--warn)", title: state.warnings.join(" · ") };
}

function startRename(id: string, current: string): void {
  renamingId.value = id;
  renameValue.value = current;
}

function commitRename(): void {
  if (renamingId.value) store.renameFeature(renamingId.value, renameValue.value || "Fonction");
  renamingId.value = null;
}
</script>

<template>
  <aside class="tree">
    <header class="tree-head">
      <span>{{ store.document.name }}</span>
      <span class="tree-count">{{ store.features.length }} fonction(s)</span>
    </header>

    <div class="tree-actions">
      <button title="Nouvelle esquisse (S)" @click="store.startCommand('sketch', { plane: { kind: 'base', name: 'XY', offset: 0 } })">
        <Icon name="sketch" :size="16" /> Esquisse
      </button>
      <button
        title="Créer un bossage à partir de l'esquisse sélectionnée"
        :disabled="!store.features.some((f) => isSketchFeature(f))"
        @click="store.startCommand('extrude', { profileId: store.features.filter((f) => isSketchFeature(f)).at(-1)?.id ?? '', depth: 20 })"
      >
        <Icon name="extrude" :size="16" /> Bossage
      </button>
    </div>

    <ul class="tree-list">
      <li
        v-for="feature in store.features"
        :key="feature.id"
        class="tree-item"
        :class="{
          active: store.selection?.id === feature.id,
          editing: store.sketchSession.featureId === feature.id,
          suppressed: feature.suppressed,
        }"
        @click="store.selectFeature(feature.id)"
        @dblclick="startRename(feature.id, feature.name)"
      >
        <span class="state-dot" :style="{ background: stateIcon(feature.id).color }" :title="stateIcon(feature.id).title" />
        <Icon :name="feature.type === 'sketch' ? 'sketch' : 'extrude'" :size="16" />
        <input
          v-if="renamingId === feature.id"
          v-model="renameValue"
          class="rename-input"
          @keydown.enter="commitRename"
          @keydown.esc="renamingId = null"
          @blur="commitRename"
          @click.stop
        />
        <span v-else class="tree-label">{{ feature.name }}</span>
        <span class="tree-actions-inline">
          <button title="Compresser / réactiver" @click.stop="store.toggleSuppress(feature.id)">⊘</button>
          <button title="Supprimer" @click.stop="store.deleteFeature(feature.id)">✕</button>
        </span>
      </li>
      <li v-if="store.features.length === 0" class="tree-empty">
        Aucune fonction. Créez une <strong>esquisse</strong> puis un <strong>bossage</strong>.
      </li>
    </ul>

    <footer class="tree-foot">
      <div v-if="store.errors.length" class="tree-error">
        <strong>Erreur :</strong> {{ store.errors[0].message }}
      </div>
      <div v-if="store.warnings.length" class="tree-warn">
        <strong>Avertissement :</strong> {{ store.warnings[0] }}
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  min-width: 236px;
  max-width: 236px;
}

.tree-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.tree-count {
  font-weight: 400;
  color: var(--text-dim);
  font-size: 11px;
}

.tree-actions {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.tree-actions button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel-alt);
  font-size: 11px;
}

.tree-actions button:hover:not(:disabled) {
  border-color: var(--accent);
}

.tree-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tree-list {
  list-style: none;
  margin: 0;
  padding: 6px 0;
  flex: 1;
  overflow-y: auto;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  cursor: pointer;
  border-left: 2px solid transparent;
}

.tree-item:hover {
  background: #242b35;
}

.tree-item.active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
}

.tree-item.editing {
  border-left-color: var(--ok);
}

.tree-item.suppressed {
  opacity: 0.5;
  text-decoration: line-through;
}

.tree-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rename-input {
  flex: 1;
  padding: 2px 4px;
}

.state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.tree-actions-inline {
  display: none;
  gap: 4px;
}

.tree-item:hover .tree-actions-inline {
  display: flex;
}

.tree-actions-inline button {
  color: var(--text-dim);
  font-size: 12px;
}

.tree-actions-inline button:hover {
  color: var(--text);
}

.tree-empty {
  padding: 14px 12px;
  color: var(--text-dim);
  line-height: 1.5;
  font-size: 12px;
}

.tree-foot {
  border-top: 1px solid var(--border);
  padding: 6px 10px;
  font-size: 11px;
}

.tree-error {
  color: #ffb3ae;
}

.tree-warn {
  color: #f0d08a;
}
</style>
