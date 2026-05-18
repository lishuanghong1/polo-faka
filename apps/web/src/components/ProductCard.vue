<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const props = defineProps<{ product: any }>();

const totalStock = computed(() => props.product.totalStock ?? 0);
const tags = computed<string[]>(() => {
  const t = props.product.tags;
  if (Array.isArray(t)) return t;
  try { return JSON.parse(t || '[]'); } catch { return []; }
});

// 强调类标签使用 accent 样式（热销/新品/限时等）
const accentTags = new Set(['热榜', '热销', '新品', '限时', '推荐', '特价']);
function tagClass(t: string) {
  return accentTags.has(t) ? 'tag-chip tag-chip-accent' : 'tag-chip';
}

function go() {
  router.push(`/product/${props.product.id}`);
}
</script>

<template>
  <article
    class="card p-5 cursor-pointer hover:-translate-y-0.5 hover:shadow-card transition-all flex flex-col"
    @click="go"
  >
    <div class="flex items-center gap-2 flex-wrap mb-2 min-h-[22px]">
      <span v-for="t in tags" :key="t" :class="tagClass(t)">{{ t }}</span>
    </div>
    <h3 class="font-medium text-[15px] text-ink-900 leading-snug line-clamp-2 min-h-[2.6em]">
      {{ product.title }}
    </h3>
    <p class="text-xs text-ink-500 mt-1.5 line-clamp-2 min-h-[2.2em]">
      {{ product.subtitle || product.description }}
    </p>

    <div class="mt-3 flex items-center text-[12px] text-ink-400 gap-3">
      <span>已售 {{ product.sales }}</span>
      <span class="w-1 h-1 rounded-full bg-ink-300"></span>
      <span>库存 {{ totalStock }}</span>
    </div>

    <div class="mt-4 flex items-end justify-between border-t border-ink-100 pt-3">
      <div class="flex items-baseline gap-1">
        <span class="text-xs text-price">¥</span>
        <span class="text-2xl font-semibold text-price tracking-tight">{{ product.basePrice }}</span>
        <span class="text-xs text-ink-400 ml-0.5">起</span>
      </div>
      <button class="px-3 py-1.5 rounded-lg bg-ink-900 hover:bg-ink-800 text-white text-xs font-medium transition-colors">
        立即购买
      </button>
    </div>
  </article>
</template>
