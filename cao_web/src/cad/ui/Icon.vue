<script setup lang="ts">
import { computed } from "vue";
import { ICONS } from "./icons";

const props = defineProps<{ name: string; size?: number }>();
const path = computed(() => ICONS[props.name] ?? ICONS.info);
</script>

<template>
  <svg
    class="cad-icon"
    :width="props.size ?? 22"
    :height="props.size ?? 22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="path" />
  </svg>
</template>

<style scoped>
.cad-icon {
  display: block;
  flex: none;
}
</style>
