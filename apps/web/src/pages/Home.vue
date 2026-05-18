<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import api from '@/api';
import { useSiteStore } from '@/stores/site';
import ProductCard from '@/components/ProductCard.vue';

const site = useSiteStore();
const cats = ref<any[]>([]);
const activeCat = ref<number | undefined>(undefined);
const products = ref<any[]>([]);
const loading = ref(false);

async function loadCats() {
  cats.value = await api.categories();
}

async function loadProducts() {
  loading.value = true;
  try {
    const r = await api.products({ categoryId: activeCat.value, pageSize: 60 });
    products.value = r.items;
  } finally {
    loading.value = false;
  }
}

watch(activeCat, () => loadProducts());

onMounted(async () => {
  await loadCats();
  await loadProducts();
});

const banner = computed(() => ({
  title: site.settings.site_name || 'Polo AI 小铺',
  tagline: site.settings.site_tagline || '源头好货 · Cursor / GPT / Codex / WindSurf 账号服务',
}));
</script>

<template>
  <!-- Hero -->
  <section class="border-b border-ink-100 bg-white">
    <div class="max-w-7xl mx-auto px-4 py-10 md:py-12 flex items-end justify-between gap-6 flex-wrap">
      <div>
        <div class="inline-flex items-center gap-2 text-xs text-ink-500 mb-3">
          <span class="w-1.5 h-1.5 rounded-full bg-brand-600"></span>
          源头好货 · 自动发货
        </div>
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight text-ink-900">
          {{ banner.title }}
        </h1>
        <p class="mt-2 text-sm text-ink-500 max-w-2xl">{{ banner.tagline }}</p>
      </div>
      <div class="flex flex-wrap gap-2 text-xs text-ink-600">
        <span class="px-2.5 py-1 border border-ink-200 rounded-full bg-ink-50">⚡ 自动发货</span>
        <span class="px-2.5 py-1 border border-ink-200 rounded-full bg-ink-50">🛡️ 售后质保</span>
        <span class="px-2.5 py-1 border border-ink-200 rounded-full bg-ink-50">💬 在线客服</span>
      </div>
    </div>
  </section>

  <!-- Categories -->
  <section class="max-w-7xl mx-auto px-4 mt-6">
    <div class="flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1">
      <button
        class="px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors"
        :class="activeCat === undefined
          ? 'bg-ink-900 text-white'
          : 'bg-white text-ink-600 border border-ink-200 hover:border-ink-400'"
        @click="activeCat = undefined"
      >
        全部
      </button>
      <button
        v-for="c in cats.filter(c => c.slug !== 'all')"
        :key="c.id"
        class="px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors"
        :class="activeCat === c.id
          ? 'bg-ink-900 text-white'
          : 'bg-white text-ink-600 border border-ink-200 hover:border-ink-400'"
        @click="activeCat = c.id"
      >
        {{ c.name }}
      </button>
    </div>
  </section>

  <!-- Products grid -->
  <section class="max-w-7xl mx-auto px-4 mt-4 pb-12">
    <div v-if="loading" class="text-center py-20 text-gray-400">加载中...</div>
    <div v-else-if="!products.length" class="text-center py-20 text-gray-400">暂无商品</div>
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <ProductCard v-for="p in products" :key="p.id" :product="p" />
    </div>
  </section>
</template>
