<script setup lang="ts">
import { ref, watch } from "vue";
import Icon from "./Icon.vue";
import { RIBBON_TABS } from "./ribbonDefs";
import { useCadStore } from "../core/documentStore";

const emit = defineEmits<{ command: [id: string]; tooltip: [text: string] }>();
const store = useCadStore();
const activeTab = ref("esquisse");

// En mode esquisse, on bascule automatiquement sur l'onglet Esquisse (comme SW).
watch(
  () => store.sketchSession.featureId,
  (id) => {
    if (id) activeTab.value = "esquisse";
  },
);

function isActiveTool(id: string): boolean {
  const tool = store.sketchSession.tool;
  return (
    (id === "sketch.rectangle-center" && tool === "rectangle-center") ||
    (id === "sketch.rectangle-corners" && tool === "rectangle-corners") ||
    (id === "sketch.circle" && tool === "circle") ||
    (id === "sketch.line" && tool === "line") ||
    (id === "sketch.select" && tool === "select")
  );
}
</script>

<template>
  <div class="ribbon glass">
    <div class="ribbon-tabs">
      <button
        v-for="tab in RIBBON_TABS"
        :key="tab.id"
        class="ribbon-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.title }}
      </button>
      <div class="ribbon-spacer" />
      <span class="ribbon-brand">CAO3 Web · noyau OpenCascade</span>
    </div>

    <div class="ribbon-body">
      <template v-for="tab in RIBBON_TABS.filter((t) => t.id === activeTab)" :key="tab.id">
        <div v-for="group in tab.groups" :key="group.title" class="ribbon-group">
          <div class="ribbon-commands">
            <button
              v-for="command in group.commands"
              :key="command.id"
              class="ribbon-command"
              :class="{ big: command.big, disabled: command.disabled, active: isActiveTool(command.id) }"
              :title="command.disabled ? `${command.label} — ${command.disabledReason}` : command.shortcut ? `${command.label} (${command.shortcut})` : command.label"
              @mouseenter="emit('tooltip', command.disabled ? command.disabledReason ?? '' : command.label)"
              @mouseleave="emit('tooltip', '')"
              @click="!command.disabled && emit('command', command.id)"
            >
              <Icon :name="command.icon" :size="command.big ? 24 : 20" />
              <span>{{ command.label }}</span>
            </button>
          </div>
          <div class="ribbon-group-title">{{ group.title }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ribbon.glass {
  background: var(--bg-ribbon);
  border: none;
  border-bottom: 1px solid var(--glass-line);
  border-radius: 0;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9), 0 8px 22px rgba(23, 37, 63, 0.07);
  user-select: none;
}

.ribbon-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  background: var(--bg-panel-alt);
  border-bottom: 1px solid var(--glass-line);
}

.ribbon-tab {
  padding: 6px 14px;
  color: var(--text-dim);
  border-bottom: 2px solid transparent;
}

.ribbon-tab {
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
}

.ribbon-tab:hover {
  color: var(--text);
  background: var(--hover);
}

.ribbon-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  background: rgba(255, 255, 255, 0.9);
  font-weight: 600;
}

.ribbon-spacer {
  flex: 1;
}

.ribbon-brand {
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.4px;
}

.ribbon-body {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 4px 6px 2px;
  min-height: 78px;
  overflow-x: auto;
}

.ribbon-group {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border-right: 1px solid var(--border);
  padding: 0 8px 2px;
}

.ribbon-commands {
  display: flex;
  align-items: flex-start;
  gap: 2px;
}

.ribbon-command {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 5px 7px;
  border-radius: 4px;
  color: var(--text);
  max-width: 96px;
  text-align: center;
  line-height: 1.15;
  font-size: 11px;
}

.ribbon-command.big {
  min-width: 64px;
}

.ribbon-command:hover:not(.disabled) {
  background: var(--hover);
  box-shadow: var(--glass-shadow-sm);
}

.ribbon-command.active {
  background: var(--accent-soft);
  outline: 1px solid var(--accent-line);
  box-shadow: var(--glass-highlight);
}

.ribbon-command.disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ribbon-group-title {
  text-align: center;
  font-size: 10px;
  color: var(--text-dim);
  padding-top: 2px;
}
</style>
