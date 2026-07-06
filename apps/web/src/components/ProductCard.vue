<script setup lang="ts">
import { computed } from 'vue';

interface UnifiedProduct {
  source: 'local' | 'forge' | 'quota';
  key: string;
  typeName: string;
  typeKey: string;
  displayPrice: number;
  stock: number;
  warrantyHours?: number | null;
  categoryKey: string;
  categoryName: string;
  emailCodeEnabled?: boolean;
  fromPrice?: boolean;
  subtitle?: string | null;
  coverImage?: string | null;
}

const props = defineProps<{ product: UnifiedProduct }>();
defineEmits<{ (e: 'click'): void }>();

const stockClass = computed(() => {
  const p = props.product;
  if (p.stock >= 9999) return []; // AIZHP 无限库存，不显示
  return [
    'text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded',
    p.stock <= 0
      ? p.source === 'local'
        ? 'text-amber-700 bg-amber-50'
        : 'text-rose-600 bg-rose-50'
      : p.stock <= 5
        ? 'text-amber-700 bg-amber-50'
        : 'text-ink-500 bg-ink-50',
  ];
});

const stockTitle = computed(() => {
  const p = props.product;
  if (p.stock >= 9999) return '';
  return p.stock <= 0
    ? p.source === 'local'
      ? '可下单付款，由客服人工发货'
      : '暂时缺货，请稍后再来'
    : `当前库存 ${p.stock} 件`;
});

const stockText = computed(() => {
  const p = props.product;
  if (p.stock >= 9999) return '';
  return p.stock <= 0
    ? p.source === 'local'
      ? '缺货 · 可代发'
      : '暂时缺货'
    : `库存 ${p.stock}`;
});

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img) img.style.display = 'none';
}
</script>

<template>
  <button
    class="card p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition bg-white border border-ink-100 group"
    @click="$emit('click')"
  >
    <div class="flex items-start justify-between gap-2 mb-3">
      <div class="flex items-start gap-3 min-w-0">
        <div
          class="w-12 h-12 rounded-lg overflow-hidden bg-ink-50 shrink-0 relative"
        >
          <span class="absolute inset-0 flex items-center justify-center font-bold text-ink-400 text-lg select-none">
            {{ product.typeName.slice(0, 1) }}
          </span>
          <img
            v-if="product.coverImage"
            :src="product.coverImage"
            alt=""
            referrerpolicy="no-referrer"
            loading="lazy"
            class="w-full h-full object-cover relative"
            @error="onImgError"
          />
        </div>
        <div class="min-w-0">
          <div
            class="font-semibold text-ink-900 group-hover:text-brand-600 transition leading-snug line-clamp-2 break-words"
            :title="product.typeName"
          >
            {{ product.typeName }}
          </div>
          <div v-if="product.subtitle" class="text-xs text-ink-500 mt-0.5 line-clamp-2">{{ product.subtitle }}</div>
          <div
            v-else-if="product.source === 'forge'"
            class="text-[11px] text-ink-400 font-mono mt-0.5 truncate"
          >{{ product.typeKey }}</div>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1 shrink-0">
        <span
          v-if="product.emailCodeEnabled"
          class="px-1.5 py-0.5 text-[10px] bg-brand-50 text-brand-700 rounded"
          title="支持在线接验证码"
        >可接码</span>
      </div>
    </div>

    <div class="flex items-end justify-between mt-2">
      <div>
        <div class="text-2xl font-bold text-rose-600">
          <span v-if="product.fromPrice" class="text-xs font-normal text-ink-400 mr-0.5">起</span>¥{{ product.displayPrice.toFixed(2) }}
        </div>
        <div v-if="product.warrantyHours" class="text-[11px] text-ink-400 mt-1">质保 {{ product.warrantyHours }} 小时</div>
      </div>
      <div v-if="product.stock < 9999" class="text-right">
        <div :class="stockClass" :title="stockTitle">
          <span
            v-if="product.stock <= 0"
            class="w-1.5 h-1.5 rounded-full"
            :class="product.source === 'local' ? 'bg-amber-500' : 'bg-rose-500'"
          ></span>
          {{ stockText }}
        </div>
      </div>
    </div>

    <div class="mt-4 pt-3 border-t border-ink-100 text-xs text-ink-500 group-hover:text-brand-600 transition flex items-center justify-between">
      <span>查看详情 / 下单</span>
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
  </button>
</template>
