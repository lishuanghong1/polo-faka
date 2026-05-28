<script setup lang="ts">
interface Props {
  icon?: 'box' | 'inbox' | 'search' | 'receipt' | 'wallet' | 'shop';
  title?: string;
  hint?: string;
  compact?: boolean;
}

withDefaults(defineProps<Props>(), {
  icon: 'inbox',
  title: '暂无数据',
  hint: '',
  compact: false,
});
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center"
    :class="compact ? 'py-8' : 'py-14'"
  >
    <div
      class="rounded-2xl bg-ink-50 text-ink-300 flex items-center justify-center mb-3"
      :class="compact ? 'w-12 h-12' : 'w-16 h-16'"
    >
      <!-- 收件箱 -->
      <svg v-if="icon === 'inbox'" viewBox="0 0 24 24" fill="none" :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
      <!-- 包裹 -->
      <svg v-else-if="icon === 'box'" viewBox="0 0 24 24" fill="none" :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
      <!-- 搜索 -->
      <svg v-else-if="icon === 'search'" viewBox="0 0 24 24" fill="none" :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <!-- 订单/单据 -->
      <svg v-else-if="icon === 'receipt'" viewBox="0 0 24 24" fill="none" :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 2v20l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V2l-2 2-2-2-2 2-2-2-2 2-2-2-2 2z" />
        <line x1="8" y1="8" x2="16" y2="8" />
        <line x1="8" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="12" y2="16" />
      </svg>
      <!-- 钱包 -->
      <svg v-else-if="icon === 'wallet'" viewBox="0 0 24 24" fill="none" :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" />
        <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
        <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
      </svg>
      <!-- 商店 -->
      <svg v-else viewBox="0 0 24 24" fill="none" :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9 4 5h16l1 4" />
        <path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
        <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      </svg>
    </div>
    <div
      class="font-medium text-ink-700"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      {{ title }}
    </div>
    <div v-if="hint" class="text-xs text-ink-400 mt-1 max-w-xs leading-relaxed">
      {{ hint }}
    </div>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
