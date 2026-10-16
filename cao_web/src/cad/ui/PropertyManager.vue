<script setup lang="ts">
/**
 * PropertyManager : panneau de commande contextuel (à gauche des commandes, comme SolidWorks).
 * Chaque commande validée par ✔ devient UNE transaction annulable.
 */
import { computed, reactive, watch } from "vue";
import Icon from "./Icon.vue";
import { useCadStore } from "../core/documentStore";
import { isExtrudeFeature, isSketchFeature } from "../core/types";

const store = useCadStore();

const extrudeParams = reactive({ profileId: "", depth: 20, operation: "newBody" as "newBody" | "cut" });
const sketchParams = reactive({ plane: "XY" as "XY" | "XZ" | "YZ", offset: 0 });

const openSketches = computed(() => store.features.filter(isSketchFeature));
const selectedFeature = computed(() => store.features.find((f) => f.id === store.selection?.id));
const selectedExtrude = computed(() => {
  const feature = selectedFeature.value;
  return isExtrudeFeature(feature) ? feature : null;
});

watch(
  () => store.activeCommand,
  (command) => {
    if (!command) return;
    if (command.id === "extrude" || command.id === "cut") {
      extrudeParams.profileId = String(command.params.profileId ?? openSketches.value.at(-1)?.id ?? "");
      extrudeParams.depth = Number(command.params.depth ?? 20);
      extrudeParams.operation = command.id === "cut" ? "cut" : "newBody";
    }
    if (command.id === "sketch") {
      sketchParams.plane = "XY";
      sketchParams.offset = 0;
    }
  },
  { immediate: true },
);

function validate(): void {
  const command = store.activeCommand;
  if (!command) return;
  if (command.id === "extrude" || command.id === "cut") {
    if (!extrudeParams.profileId) {
      store.setSelection(null);
      return;
    }
    store.addExtrudeFromSketch(extrudeParams.profileId, { depth: extrudeParams.depth, operation: extrudeParams.operation });
    store.cancelCommand();
    return;
  }
  if (command.id === "sketch") {
    store.startSketch({ kind: "base", name: sketchParams.plane, offset: sketchParams.offset });
    store.cancelCommand();
  }
}

function applySelectedExtrude(patch: { depth?: number; operation?: "newBody" | "fuse" | "cut" }): void {
  const feature = selectedExtrude.value;
  if (!feature) return;
  store.beginEdit("modification de fonction");
  if (patch.depth !== undefined) feature.end.depth = patch.depth;
  if (patch.operation !== undefined) feature.operation = patch.operation;
  store.scheduleRebuild("preview", 40);
  store.scheduleRebuild("final", 300);
}

const sketchStats = computed(() => {
  const feature = store.activeSketchFeature;
  if (!feature) return null;
  const selectedDimension = feature.sketch.dimensions.find((d) => d.id === store.sketchSession.selectedDimensionId);
  return {
    entities: feature.sketch.entities.length,
    points: feature.sketch.points.length,
    constraints: feature.sketch.constraints.length,
    dimensions: feature.sketch.dimensions.length,
    dimensionsList: feature.sketch.dimensions,
    selectedDimension,
  };
});

function setSketchPlane(plane: "XY" | "XZ" | "YZ"): void {
  const feature = store.activeSketchFeature;
  if (!feature) return;
  store.beginEdit("plan d'esquisse");
  feature.sketch.plane.name = plane;
  store.scheduleRebuild("final", 120);
}
</script>

<template>
  <aside class="pm glass">
    <!-- Commande en cours -->
    <template v-if="store.activeCommand">
      <header class="pm-head">
        <Icon :name="store.activeCommand.id === 'sketch' ? 'sketch' : 'extrude'" :size="18" />
        <span>{{ store.activeCommand.id === 'sketch' ? 'Nouvelle esquisse' : store.activeCommand.id === 'cut' ? 'Enlèvement de matière' : 'Bossage extrudé' }}</span>
      </header>

      <div v-if="store.activeCommand.id === 'sketch'" class="pm-body">
        <label class="pm-field">
          <span>Plan de base</span>
          <div class="pm-radio">
            <button v-for="plane in ['XY', 'XZ', 'YZ'] as const" :key="plane" :class="{ on: sketchParams.plane === plane }" @click="sketchParams.plane = plane">
              {{ plane }}
            </button>
          </div>
        </label>
        <label class="pm-field">
          <span>Décalage (mm)</span>
          <input v-model.number="sketchParams.offset" type="number" step="1" />
        </label>
      </div>

      <div v-else class="pm-body">
        <label class="pm-field">
          <span>Profil (esquisse)</span>
          <select v-model="extrudeParams.profileId">
            <option value="" disabled>— sélectionner une esquisse —</option>
            <option v-for="sketch in openSketches" :key="sketch.id" :value="sketch.id">{{ sketch.name }}</option>
          </select>
        </label>
        <label class="pm-field">
          <span>Opération</span>
          <select v-model="extrudeParams.operation">
            <option value="newBody">Corps (base)</option>
            <option value="cut">Enlever la matière</option>
          </select>
        </label>
        <label class="pm-field">
          <span>Profondeur : {{ extrudeParams.depth }} mm</span>
          <input v-model.number="extrudeParams.depth" type="range" min="1" max="120" step="1" />
        </label>
        <label class="pm-field">
          <span>Profondeur (mm)</span>
          <input v-model.number="extrudeParams.depth" type="number" min="0.1" step="1" />
        </label>
      </div>

      <div class="pm-actions">
        <button class="ok" title="Valider (Entrée)" @click="validate">✔ Valider</button>
        <button class="cancel" title="Annuler (Échap)" @click="store.cancelCommand()">✗ Annuler</button>
      </div>
    </template>

    <!-- Esquisse en cours d'édition -->
    <template v-else-if="store.activeSketchFeature && sketchStats">
      <header class="pm-head">
        <Icon name="sketch" :size="18" />
        <span>{{ store.activeSketchFeature.name }}</span>
      </header>
      <div class="pm-body">
        <label class="pm-field">
          <span>Plan d'esquisse</span>
          <div class="pm-radio">
            <button v-for="plane in ['XY', 'XZ', 'YZ'] as const" :key="plane" :class="{ on: store.activeSketchFeature.sketch.plane.name === plane }" @click="setSketchPlane(plane)">
              {{ plane }}
            </button>
          </div>
        </label>
        <div class="pm-stats">
          <div><span>Entités</span><strong>{{ sketchStats.entities }}</strong></div>
          <div><span>Contraintes</span><strong>{{ sketchStats.constraints }}</strong></div>
          <div><span>Cotes</span><strong>{{ sketchStats.dimensions }}</strong></div>
          <div><span>Ddl restants</span><strong>{{ store.sketchSession.dof }}</strong></div>
        </div>
        <div class="pm-section">Cotes (cliquer pour éditer)</div>
        <ul class="pm-dims">
          <li
            v-for="dimension in sketchStats.dimensionsList"
            :key="dimension.id"
            :class="{ conflict: store.sketchSession.conflicts.includes(dimension.id) }"
          >
            <select
              :value="store.sketchSession.selectedDimensionId ?? ''"
              style="display: none"
            />
            <span>{{ dimension.kind }}</span>
            <input
              type="number"
              step="0.5"
              :value="dimension.value"
              @change="store.setDimensionValue(dimension.id, Number(($event.target as HTMLInputElement).value))"
            />
          </li>
          <li v-if="sketchStats.dimensionsList.length === 0" class="empty">Aucune cote — utilisez l'outil Cotation (D).</li>
        </ul>
        <div class="pm-actions col">
          <button @click="store.addConstraintToSelection('horizontal')">Contrainte horizontale</button>
          <button @click="store.addConstraintToSelection('vertical')">Contrainte verticale</button>
          <button class="ok" @click="store.closeSketch()">Quitter l'esquisse</button>
        </div>
      </div>
    </template>

    <!-- Aucune commande : propriétés de la sélection -->
    <template v-else>
      <header class="pm-head">
        <Icon name="settings" :size="18" />
        <span>Propriétés</span>
      </header>
      <div class="pm-body">
        <label class="pm-field">
          <span>Nom du document</span>
          <input :value="store.document.name" @change="store.document.name = ($event.target as HTMLInputElement).value" />
        </label>
        <div class="pm-stats">
          <div><span>Volume</span><strong>{{ store.build?.volume ? `${(store.build.volume / 1000).toFixed(2)} cm³` : "—" }}</strong></div>
          <div><span>Reconstruction</span><strong>{{ store.lastBuildMs.toFixed(0) }} ms</strong></div>
          <div><span>Fonctions</span><strong>{{ store.features.length }}</strong></div>
          <div><span>Warnings</span><strong>{{ store.warnings.length }}</strong></div>
        </div>

        <template v-if="selectedExtrude">
          <div class="pm-section">{{ selectedExtrude.name }}</div>
          <label class="pm-field">
            <span>Profondeur (mm)</span>
            <input type="number" :value="selectedExtrude.end.depth" min="0.1" step="1" @change="applySelectedExtrude({ depth: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label class="pm-field">
            <span>Opération</span>
            <select :value="selectedExtrude.operation" @change="applySelectedExtrude({ operation: ($event.target as HTMLSelectElement).value as 'newBody' | 'cut' })">
              <option value="newBody">Corps (base)</option>
              <option value="fuse">Fusionner</option>
              <option value="cut">Enlever la matière</option>
              <option value="intersect">Intersection</option>
            </select>
          </label>
          <p class="pm-help">La modification est appliquée immédiatement (aperçu puis reconstruction finale).</p>
        </template>
        <p v-else class="pm-help">
          Sélectionnez une fonction dans l'arbre pour l'éditer, ou lancez une commande depuis le ruban. Les commandes grisées correspondent aux lots suivants du plan.
        </p>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.pm.glass {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.66);
  min-width: 272px;
  max-width: 272px;
  overflow-y: auto;
}

.pm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  background: var(--bg-panel-alt);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.pm-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pm-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
}

.pm-radio {
  display: flex;
  gap: 6px;
}

.pm-radio button {
  flex: 1;
  padding: 5px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--glass-strong);
  color: var(--text-dim);
}

.pm-radio button.on {
  border-color: var(--accent);
  color: var(--text);
  background: var(--accent-soft);
}

.pm-actions {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}

.pm-actions.col {
  flex-direction: column;
  border-top: none;
  padding: 0;
}

.pm-actions button {
  flex: 1;
  padding: 7px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel-alt);
}

.pm-actions button.ok {
  border-color: #2ea043;
  background: var(--ok-soft);
  color: var(--ok);
}

.pm-actions button.cancel {
  border-color: #7d3b39;
  background: var(--error-soft);
  color: var(--error);
}

.pm-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.pm-stats div {
  display: flex;
  justify-content: space-between;
  padding: 5px 7px;
  background: var(--glass-strong);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.pm-stats strong {
  color: var(--text);
}

.pm-section {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}

.pm-dims {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pm-dims li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pm-dims li span {
  flex: 1;
  font-size: 11px;
  color: var(--text-dim);
}

.pm-dims li.conflict input {
  border-color: var(--error);
}

.pm-dims li.empty {
  color: var(--text-dim);
  font-size: 11px;
}

.pm-help {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
  margin: 0;
}
</style>
