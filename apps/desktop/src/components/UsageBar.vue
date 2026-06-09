<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  percent: number | null;
  /** 显示在右上角的小字（如 "$62.22 / $400"） */
  rightLabel?: string;
  /** 给左上角加 label 的话填这里 */
  leftLabel?: string;
  size?: 'sm' | 'md';
}>();

const color = computed(() => {
  if (props.percent === null || props.percent === undefined) return 'bg-ink-600';
  if (props.percent < 60) return 'bg-emerald-500';
  if (props.percent < 85) return 'bg-amber-500';
  return 'bg-rose-500';
});

const widthPct = computed(() => {
  if (props.percent === null || props.percent === undefined) return 0;
  return Math.min(100, Math.max(0, props.percent));
});

const heightCls = computed(() => (props.size === 'sm' ? 'h-1.5' : 'h-2'));
</script>

<template>
  <div>
    <div v-if="leftLabel || rightLabel" class="flex items-baseline justify-between mb-1 text-xs">
      <span class="text-ink-400">{{ leftLabel }}</span>
      <span class="text-ink-200 font-medium">{{ rightLabel }}</span>
    </div>
    <div :class="['rounded-full bg-ink-800 overflow-hidden', heightCls]">
      <div
        :class="['h-full transition-all duration-300', color]"
        :style="{ width: `${widthPct}%` }"
      ></div>
    </div>
  </div>
</template>
