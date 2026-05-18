<script setup lang="ts">
import { computed } from 'vue';
import { useSiteStore } from '@/stores/site';
import { ElDialog } from 'element-plus';

const site = useSiteStore();
const current = computed(() => site.announcements[site.dialogIdx] || null);

function next() {
  if (site.dialogIdx < site.announcements.length - 1) {
    site.dialogIdx++;
  } else {
    site.closeDialog();
  }
}
</script>

<template>
  <el-dialog
    v-model="site.dialogOpen"
    :show-close="false"
    width="520px"
    align-center
    @close="site.closeDialog"
  >
    <template #header>
      <div class="text-lg font-semibold">{{ current?.title }}</div>
    </template>
    <div v-if="current" class="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700">
      {{ current.content }}
    </div>
    <template #footer>
      <div class="flex justify-between items-center">
        <span class="text-xs text-gray-400">
          {{ site.dialogIdx + 1 }} / {{ site.announcements.length }}
        </span>
        <button
          class="px-4 py-1.5 rounded-lg brand-gradient text-white text-sm"
          @click="next"
        >
          {{ site.dialogIdx < site.announcements.length - 1 ? '下一条' : '我知道了' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>
