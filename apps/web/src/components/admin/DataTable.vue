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
    <div v-if="loading" class="py-16 text-center text-sm text-ink-400">加载中...</div>
    <div v-else-if="isEmpty" class="py-16 text-center text-sm text-ink-400">
      {{ empty || '暂无数据' }}
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
