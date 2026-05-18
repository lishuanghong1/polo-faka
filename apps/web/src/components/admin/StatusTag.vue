<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

const map: Record<string, { text: string; cls: string }> = {
  // Order
  PENDING: { text: '待支付', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAID: { text: '已支付', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  DELIVERED: { text: '已发货', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  CANCELLED: { text: '已取消', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  EXPIRED: { text: '已超时', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  REFUNDED: { text: '已退款', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  // Card Key
  AVAILABLE: { text: '可售', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  LOCKED: { text: '锁定', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  SOLD: { text: '已售', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  // Product
  ON_SALE: { text: '在售', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  OFF_SHELF: { text: '下架', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  DRAFT: { text: '草稿', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
  // User
  ACTIVE: { text: '正常', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  BANNED: { text: '禁用', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  USER: { text: '用户', cls: 'bg-ink-100 text-ink-600 border-ink-200' },
  ADMIN: { text: '管理员', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  // Pool
  HEALTHY: { text: '健康', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  LOW_QUOTA: { text: '余量低', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  EXHAUSTED: { text: '耗尽', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  UNKNOWN: { text: '未知', cls: 'bg-ink-100 text-ink-500 border-ink-200' },
};

const cfg = computed(() => map[props.status] || { text: props.status, cls: 'bg-ink-100 text-ink-500 border-ink-200' });
</script>

<template>
  <span class="inline-flex px-2 py-0.5 rounded-md text-[11px] border whitespace-nowrap" :class="cfg.cls">
    {{ cfg.text }}
  </span>
</template>
