<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { useSiteStore } from '@/stores/site';

const site = useSiteStore();
const router = useRouter();

interface UnifiedProduct {
  source: 'local' | 'forge';
  /** 卡片 key */
  key: string;
  /** 显示名 */
  typeName: string;
  /** 主标识：本地 id 字符串 / 三方 typeKey */
  typeKey: string;
  displayPrice: number;
  stock: number;
  warrantyHours?: number | null;
  categoryKey: string;
  categoryName: string;
  emailCodeEnabled?: boolean;
  /** 本地商品才有，多 SKU 时是最低价 */
  fromPrice?: boolean;
}

const products = ref<UnifiedProduct[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const lastError = ref('');

const banner = computed(() => ({
  title: site.settings.site_name || 'Polo AI 小铺',
  tagline: site.settings.site_tagline || 'Cursor · Codex · WindSurf 账号即时发货',
}));

const grouped = computed(() => {
  const map = new Map<string, { categoryName: string; items: UnifiedProduct[] }>();
  for (const p of products.value) {
    const key = p.categoryKey;
    if (!map.has(key)) map.set(key, { categoryName: p.categoryName, items: [] });
    map.get(key)!.items.push(p);
  }
  return Array.from(map.values());
});

function normalizeLocal(p: any): UnifiedProduct {
  const prices = (p.skus || [])
    .map((s: any) => Number(s.price))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  return {
    source: 'local',
    key: `local:${p.id}`,
    typeKey: String(p.id),
    typeName: p.title,
    displayPrice: minPrice,
    fromPrice: prices.length > 1,
    stock: Number(p.totalStock || 0),
    warrantyHours: p.warrantyHours ?? null,
    categoryKey: p.category?.slug || `cat-${p.category?.id || 'others'}`,
    categoryName: p.category?.name || '其它',
    emailCodeEnabled: false,
  };
}

function normalizeForge(p: any): UnifiedProduct {
  return {
    source: 'forge',
    key: `forge:${p.typeKey}`,
    typeKey: p.typeKey,
    typeName: p.typeName,
    displayPrice: Number(p.displayPrice),
    stock: Number(p.stock || 0),
    warrantyHours: p.warrantyHours ?? null,
    categoryKey: p.categoryKey || 'forge-others',
    categoryName: p.categoryName || '其它',
    emailCodeEnabled: !!p.emailCodeEnabled,
  };
}

async function load(showRefreshing = false) {
  if (showRefreshing) refreshing.value = true;
  else loading.value = true;
  lastError.value = '';

  // 并发拉两边，任意一边失败都不影响另一边
  const [localRes, forgeRes] = await Promise.allSettled([
    api.products({ pageSize: 100 }),
    api.forge.listProducts(),
  ]);

  const merged: UnifiedProduct[] = [];

  if (localRes.status === 'fulfilled') {
    const items = (localRes.value as any).items || [];
    for (const it of items) merged.push(normalizeLocal(it));
  }

  if (forgeRes.status === 'fulfilled') {
    for (const it of forgeRes.value as any[]) merged.push(normalizeForge(it));
  }

  // 两个都失败才报错
  if (localRes.status === 'rejected' && forgeRes.status === 'rejected') {
    const e: any = forgeRes.reason || localRes.reason;
    lastError.value = e?.response?.data?.error?.message || e?.message || '加载商品失败';
  }

  products.value = merged;
  loading.value = false;
  refreshing.value = false;
}

function gotoDetail(p: UnifiedProduct) {
  if (p.source === 'local') {
    router.push(`/product/${encodeURIComponent(p.typeKey)}`);
  } else {
    router.push(`/forge-product/${encodeURIComponent(p.typeKey)}`);
  }
}

async function refresh() {
  await load(true);
  ElMessage.success('已刷新');
}

onMounted(() => load(false));
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
        <span class="px-2.5 py-1 border border-ink-200 rounded-full bg-ink-50">⚡ 即时发货</span>
        <span class="px-2.5 py-1 border border-ink-200 rounded-full bg-ink-50">🛡️ 售后质保</span>
        <span class="px-2.5 py-1 border border-ink-200 rounded-full bg-ink-50">📧 在线接码</span>
      </div>
    </div>
  </section>

  <!-- 入口卡片：接验证码 + 兑换码 -->
  <section class="max-w-7xl mx-auto px-4 mt-6">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <button
        class="card p-5 text-left hover:shadow-md transition flex items-center gap-4 bg-white border border-ink-100"
        @click="router.push('/email-code')"
      >
        <div class="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8l9 6 9-6M3 8v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8M3 8l9-6 9 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="min-w-0">
          <div class="font-semibold text-ink-900">在线接验证码</div>
          <div class="text-xs text-ink-500 mt-1 truncate">输入账号邮箱即可实时接收验证码</div>
        </div>
      </button>

      <button
        class="card p-5 text-left hover:shadow-md transition flex items-center gap-4 bg-white border border-ink-100"
        @click="router.push('/forge-redeem')"
      >
        <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4M20 7v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7M20 7l-2-2H6L4 7M9 11l3 3 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="min-w-0">
          <div class="font-semibold text-ink-900">兑换码下单</div>
          <div class="text-xs text-ink-500 mt-1 truncate">已有兑换码？这里直接使用</div>
        </div>
      </button>
    </div>
  </section>

  <!-- 商品列表 -->
  <section class="max-w-7xl mx-auto px-4 mt-8 pb-12">
    <div class="flex items-center justify-between mb-4 gap-3 flex-wrap">
      <h2 class="text-lg font-semibold text-ink-900">商品列表</h2>
      <button
        class="text-xs text-ink-500 hover:text-brand-600 inline-flex items-center gap-1.5 disabled:opacity-50"
        :disabled="refreshing"
        @click="refresh"
      >
        <svg class="w-4 h-4" :class="refreshing ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9c2.5 0 4.8 1 6.5 2.7M21 4v5h-5M3 20v-5h5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ refreshing ? '刷新中…' : '刷新库存' }}
      </button>
    </div>

    <div v-if="loading" class="text-center py-20 text-ink-400">加载中...</div>
    <div v-else-if="lastError" class="card p-6 bg-amber-50/60 border border-amber-200 text-amber-800 text-sm">
      {{ lastError }}
    </div>
    <div v-else-if="!products.length" class="card p-10 text-center text-ink-400 text-sm">
      暂无商品，请稍后再试。
    </div>

    <template v-else>
      <div v-for="g in grouped" :key="g.categoryName" class="mb-7">
        <div class="text-xs font-semibold tracking-widest uppercase text-ink-500 mb-2.5">
          {{ g.categoryName }}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <button
            v-for="p in g.items"
            :key="p.key"
            class="card p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition bg-white border border-ink-100 group"
            @click="gotoDetail(p)"
          >
            <div class="flex items-start justify-between gap-2 mb-3">
              <div class="min-w-0">
                <div class="font-semibold text-ink-900 group-hover:text-brand-600 transition truncate">
                  {{ p.typeName }}
                </div>
                <div v-if="p.source === 'forge'" class="text-[11px] text-ink-400 font-mono mt-0.5 truncate">{{ p.typeKey }}</div>
              </div>
              <div class="flex flex-col items-end gap-1 shrink-0">
                <span
                  v-if="p.emailCodeEnabled"
                  class="px-1.5 py-0.5 text-[10px] bg-brand-50 text-brand-700 rounded"
                  title="支持在线接验证码"
                >可接码</span>
              </div>
            </div>

            <div class="flex items-end justify-between mt-2">
              <div>
                <div class="text-2xl font-bold text-rose-600">
                  <span v-if="p.fromPrice" class="text-xs font-normal text-ink-400 mr-0.5">起</span>¥{{ p.displayPrice.toFixed(2) }}
                </div>
                <div v-if="p.warrantyHours" class="text-[11px] text-ink-400 mt-1">质保 {{ p.warrantyHours }} 小时</div>
              </div>
              <div class="text-right">
                <div
                  :class="[
                    'text-xs',
                    p.stock <= 0 ? 'text-rose-500' : p.stock <= 5 ? 'text-amber-600' : 'text-ink-400',
                  ]"
                >
                  {{ p.stock <= 0 ? '缺货' : `库存 ${p.stock}` }}
                </div>
              </div>
            </div>

            <div class="mt-4 pt-3 border-t border-ink-100 text-xs text-ink-500 group-hover:text-brand-600 transition flex items-center justify-between">
              <span>查看详情 / 下单</span>
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
