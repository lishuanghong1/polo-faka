<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div
    class="mb-4 md:mb-5 gap-3 md:gap-4 flex flex-col sm:flex-row sm:items-end sm:justify-between"
  >
    <div class="min-w-0">
      <h1 class="text-lg md:text-xl font-semibold text-ink-900 truncate">{{ title }}</h1>
      <p v-if="subtitle" class="text-xs text-ink-500 mt-0.5">{{ subtitle }}</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <slot name="actions" />
    </div>
  </div>
</template>
