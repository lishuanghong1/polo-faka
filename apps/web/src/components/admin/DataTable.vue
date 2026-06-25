<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  empty?: string;
  loading?: boolean;
  isEmpty?: boolean;
  minWidth?: string;
  maxHeight?: string;
  dense?: boolean;
}>(), {
  minWidth: '960px',
  maxHeight: 'calc(100vh - 280px)',
  dense: true,
});

const scrollStyle = computed(() => ({
  maxHeight: props.maxHeight,
}));

const tableStyle = computed(() => ({
  minWidth: props.minWidth,
}));
</script>

<template>
  <div class="card overflow-hidden">
    <!-- 加载：骨架行 -->
    <div v-if="loading" class="p-3 space-y-2.5">
      <div v-for="i in 7" :key="i" class="skeleton h-9 rounded-lg" :style="{ opacity: 1 - i * 0.08 }" />
    </div>
    <!-- 空态：图标 + 文案 -->
    <div v-else-if="isEmpty" class="py-16 flex flex-col items-center justify-center text-center">
      <div class="w-12 h-12 rounded-2xl bg-ink-50 text-ink-300 flex items-center justify-center mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-6 h-6">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div class="text-sm text-ink-400">{{ empty || '暂无数据' }}</div>
    </div>
    <div v-else class="data-table-scroll overflow-auto" :style="scrollStyle">
      <table class="w-full text-sm table-auto" :style="tableStyle" :class="{ 'is-dense': dense }">
        <slot />
      </table>
    </div>
  </div>
</template>

<style scoped>
:deep(thead tr) {
  background: #fafaf9;
}
:deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fafaf9;
  text-align: left;
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #78716c;
  padding: 9px 12px;
  border-bottom: 1px solid #e7e5e4;
  white-space: nowrap;
}
:deep(tbody td) {
  padding: 10px 12px;
  border-top: 1px solid #f5f5f4;
  color: #292524;
  vertical-align: middle;
  white-space: nowrap;
}
:deep(table.is-dense tbody td) {
  padding-top: 8px;
  padding-bottom: 8px;
}
:deep(tbody tr:first-child td) {
  border-top: none;
}
:deep(tbody tr:hover) {
  background: #fafaf9;
}
.data-table-scroll {
  min-height: 180px;
  overscroll-behavior: contain;
}
.data-table-scroll::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.data-table-scroll::-webkit-scrollbar-thumb {
  background: #d6d3d1;
  border-radius: 999px;
  border: 2px solid #fff;
}
.data-table-scroll::-webkit-scrollbar-track {
  background: #fafaf9;
}
</style>
