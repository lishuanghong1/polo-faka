<script setup lang="ts">
import { computed } from 'vue';
import type { UsageInfo } from '../types';
import { resolveUsageTotalSummary } from '../utils/cursorUsage';

const props = defineProps<{
  usage: UsageInfo;
  /** 账号库列表用紧凑一行 */
  compact?: boolean;
}>();

const total = computed(() => resolveUsageTotalSummary(props.usage));

function fmtMoney(v: number) {
  return `$${v.toFixed(2)}`;
}
</script>

<template>
  <div v-if="total">
    <div
      v-if="compact"
      class="text-[11px] text-ink-400 flex flex-wrap items-center gap-x-2 gap-y-0.5"
    >
      <span class="text-ink-300 font-medium">总计 {{ fmtMoney(total.total) }}</span>
      <span class="text-ink-600">=</span>
      <span>API <span class="text-ink-200">{{ fmtMoney(total.api) }}</span></span>
      <span>+ 超额 <span class="text-ink-200">{{ fmtMoney(total.overage) }}</span></span>
      <span>+ 奖励 <span class="text-ink-200">{{ fmtMoney(total.bonus) }}</span></span>
    </div>

    <div
      v-else
      class="rounded-lg bg-brand-50 border border-brand-200 px-3 py-2.5"
    >
      <div class="flex items-baseline justify-between mb-2">
        <div class="text-xs font-medium text-brand-700">总计（高级模型）</div>
        <div class="text-lg font-semibold text-ink-100">{{ fmtMoney(total.total) }}</div>
      </div>
      <div class="text-[11px] text-ink-500 mb-2">API + 超额 + 奖励</div>
      <div class="grid grid-cols-3 gap-2 text-xs">
        <div class="rounded-md bg-ink-900/50 border border-ink-700 px-2.5 py-2">
          <div class="text-ink-500">API</div>
          <div class="text-sm font-medium text-ink-100 mt-0.5">{{ fmtMoney(total.api) }}</div>
        </div>
        <div class="rounded-md bg-ink-900/50 border border-ink-700 px-2.5 py-2">
          <div class="text-ink-500">超额</div>
          <div class="text-sm font-medium text-ink-100 mt-0.5">{{ fmtMoney(total.overage) }}</div>
        </div>
        <div class="rounded-md bg-ink-900/50 border border-ink-700 px-2.5 py-2">
          <div class="text-ink-500">奖励</div>
          <div class="text-sm font-medium text-ink-100 mt-0.5">{{ fmtMoney(total.bonus) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
