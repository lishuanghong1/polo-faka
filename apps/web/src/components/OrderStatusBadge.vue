<script setup lang="ts">
import { computed } from 'vue';
import { statusOf } from '@/utils/order-status';

interface Props {
  status?: string | null;
  size?: 'sm' | 'md';
  bordered?: boolean;
  dot?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  status: '',
  size: 'sm',
  bordered: true,
  dot: false,
});

const info = computed(() => statusOf(props.status));

const dotColor = computed(() => {
  const s = (props.status || '').toUpperCase();
  switch (s) {
    case 'PENDING':   return 'bg-amber-500';
    case 'PAID':      return 'bg-sky-500 animate-pulse';
    case 'DELIVERED': return 'bg-emerald-500';
    case 'FAILED':    return 'bg-rose-500';
    case 'REFUNDED':  return 'bg-rose-400';
    case 'CANCELLED':
    case 'EXPIRED':   return 'bg-ink-400';
    default:          return 'bg-ink-400';
  }
});

const sizeCls = computed(() =>
  props.size === 'md'
    ? 'h-7 px-2.5 text-xs'
    : 'h-6 px-2 text-[11px]'
);
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap"
    :class="[
      sizeCls,
      bordered ? info.borderCls : info.cls,
    ]"
  >
    <span v-if="dot" class="w-1.5 h-1.5 rounded-full" :class="dotColor" />
    {{ info.text }}
  </span>
</template>
