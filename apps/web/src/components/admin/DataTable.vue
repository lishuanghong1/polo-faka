<script setup lang="ts">
defineProps<{
  empty?: string;
  loading?: boolean;
  isEmpty?: boolean;
}>();
</script>

<template>
  <div class="card overflow-hidden">
    <div v-if="loading" class="py-16 text-center text-sm text-ink-400">加载中...</div>
    <div v-else-if="isEmpty" class="py-16 text-center text-sm text-ink-400">
      {{ empty || '暂无数据' }}
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
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
  text-align: left;
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #78716c;
  padding: 10px 16px;
  border-bottom: 1px solid #e7e5e4;
}
:deep(tbody td) {
  padding: 12px 16px;
  border-top: 1px solid #f5f5f4;
  color: #292524;
  vertical-align: middle;
}
:deep(tbody tr:first-child td) {
  border-top: none;
}
:deep(tbody tr:hover) {
  background: #fafaf9;
}
</style>
