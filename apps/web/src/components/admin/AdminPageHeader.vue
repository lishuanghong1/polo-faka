<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="flex items-end justify-between mb-5 gap-4">
    <div>
      <h1 class="text-xl font-semibold text-ink-900">{{ title }}</h1>
      <p v-if="subtitle" class="text-xs text-ink-500 mt-0.5">{{ subtitle }}</p>
    </div>
    <div class="flex items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
